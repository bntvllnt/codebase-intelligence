import fs from "fs";
import path from "path";
import type { CheckResult, CodebaseGraph, Finding, OutputFormat, Verdict } from "../types/index.js";
import { computeChanges } from "../core/index.js";
import { computeHealth, type HealthResult } from "../health/index.js";
import { runCheck } from "../rules/check.js";
import { formatCompact, formatMarkdown, formatResult, formatSummaryLine } from "../rules/format.js";
import { computeWorkspaces, type WorkspacesResult } from "../workspaces/index.js";

export type CiFormat = OutputFormat;
export type CiExitCode = 0 | 1;

export interface CiOptions {
  configPath?: string;
  base?: string;
  newOnly?: boolean;
  failOn?: "error" | "warn" | "never";
  minScore?: number;
  maxNew?: number;
  baseline?: string;
  format?: CiFormat;
  output?: string;
  summary?: boolean;
  production?: boolean;
  changedSince?: string;
  diffFile?: string;
  changedWorkspaces?: boolean;
}

export interface CiGate {
  name: string;
  verdict: Verdict;
  summary: string;
}

export interface CiResult {
  verdict: "pass" | "fail";
  exitCode: CiExitCode;
  base: string;
  newOnly: boolean;
  summary: string;
  gates: CiGate[];
  check: CheckResult;
  health: HealthResult;
  changes: ReturnType<typeof computeChanges>;
  workspaces?: WorkspacesResult;
  baseline: {
    path?: string;
    ignoredFindings: number;
  };
}

function summarize(findings: Finding[], source: CheckResult): CheckResult["summary"] {
  const rules: Record<string, number> = {};
  let error = 0;
  let warn = 0;
  for (const finding of findings) {
    rules[finding.ruleId] = (rules[finding.ruleId] ?? 0) + 1;
    if (finding.severity === "error") error += 1;
    else warn += 1;
  }
  return {
    error,
    warn,
    suppressed: source.summary.suppressed,
    staleSuppressions: source.summary.staleSuppressions,
    rules,
  };
}

function verdictFor(summary: CheckResult["summary"], failOn: CiOptions["failOn"]): Verdict {
  if (summary.error + summary.warn === 0) return "pass";
  if (failOn === "never") return "warn";
  if (failOn === "warn") return "fail";
  return summary.error > 0 ? "fail" : "warn";
}

function baselineFingerprints(rootDir: string, baselinePath: string | undefined): Set<string> {
  if (!baselinePath) return new Set<string>();
  const resolved = path.resolve(rootDir, baselinePath);
  if (!fs.existsSync(resolved)) return new Set<string>();
  const parsed: unknown = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  if (Array.isArray(parsed)) return new Set(parsed.filter((item): item is string => typeof item === "string"));
  if (parsed && typeof parsed === "object" && "findings" in parsed) {
    const findings = (parsed as { findings?: unknown }).findings;
    if (Array.isArray(findings)) {
      return new Set(
        findings
          .map((item) => item && typeof item === "object" && "fingerprint" in item ? (item as { fingerprint?: unknown }).fingerprint : undefined)
          .filter((item): item is string => typeof item === "string"),
      );
    }
  }
  if (parsed && typeof parsed === "object" && "fingerprints" in parsed) {
    const fingerprints = (parsed as { fingerprints?: unknown }).fingerprints;
    if (Array.isArray(fingerprints)) return new Set(fingerprints.filter((item): item is string => typeof item === "string"));
  }
  return new Set<string>();
}

function applyBaseline(result: CheckResult, rootDir: string, baselinePath: string | undefined, failOn: CiOptions["failOn"]): { result: CheckResult; ignored: number } {
  const fingerprints = baselineFingerprints(rootDir, baselinePath);
  if (fingerprints.size === 0) return { result, ignored: 0 };
  const findings = result.findings.filter((finding) => !fingerprints.has(finding.fingerprint));
  const ignored = result.findings.length - findings.length;
  const summary = summarize(findings, result);
  return {
    result: {
      ...result,
      findings,
      summary,
      verdict: verdictFor(summary, failOn),
    },
    ignored,
  };
}

function gateVerdict(check: CheckResult, health: HealthResult, options: CiOptions): "pass" | "fail" {
  if (check.verdict === "fail") return "fail";
  if (health.verdict === "fail") return "fail";
  if (options.maxNew !== undefined && check.findings.length > options.maxNew) return "fail";
  return "pass";
}

export function runCi(graph: CodebaseGraph, rootDir: string, options: CiOptions = {}): CiResult {
  const base = options.base ?? "origin/main";
  const newOnly = options.newOnly !== false;
  const rawCheck = runCheck(graph, rootDir, {
    configPath: options.configPath,
    failOn: options.failOn,
    gate: newOnly ? "new-only" : "all",
    base,
    production: options.production,
    changedSince: options.changedSince,
    diffFile: options.diffFile,
  });
  const baseline = applyBaseline(rawCheck, rootDir, options.baseline, options.failOn);
  const minScore = options.minScore ?? 0;
  const health = computeHealth(graph, { minScore }, { rootDir });
  const changes = computeChanges(graph, "all", rootDir);
  const workspaces = options.changedWorkspaces ? computeWorkspaces(graph, rootDir, { base, changedOnly: true }) : undefined;
  const verdict = gateVerdict(baseline.result, health, options);
  const gates: CiGate[] = [
    { name: "check", verdict: baseline.result.verdict, summary: formatSummaryLine(baseline.result) },
    { name: "health", verdict: health.verdict, summary: health.summary },
  ];
  if (options.maxNew !== undefined) {
    gates.push({
      name: "max-new",
      verdict: baseline.result.findings.length <= options.maxNew ? "pass" : "fail",
      summary: `${String(baseline.result.findings.length)} finding(s) <= ${String(options.maxNew)} allowed`,
    });
  }

  return {
    verdict,
    exitCode: verdict === "pass" ? 0 : 1,
    base,
    newOnly,
    summary: `CI ${verdict.toUpperCase()}: ${formatSummaryLine(baseline.result)}; health ${health.score.toFixed(2)}/${health.minScore}.${workspaces ? ` ${workspaces.summary}` : ""}`,
    gates,
    check: baseline.result,
    health,
    changes,
    workspaces,
    baseline: { path: options.baseline, ignoredFindings: baseline.ignored },
  };
}

export function formatCiResult(result: CiResult, format: CiFormat = "compact", summary = false): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "sarif") return formatResult(result.check, "sarif");
  if (format === "markdown" || format === "pr-comment-github" || format === "pr-comment-gitlab") {
    return [
      "## Codebase Intelligence CI",
      "",
      `**Verdict:** ${result.verdict.toUpperCase()}`,
      `**Base:** \`${result.base}\``,
      `**Mode:** ${result.newOnly ? "new-only" : "all findings"}`,
      result.workspaces ? `**Changed workspaces:** ${result.workspaces.summary}` : "",
      "",
      "| Gate | Verdict | Summary |",
      "|---|---|---|",
      ...result.gates.map((gate) => `| ${gate.name} | ${gate.verdict} | ${gate.summary.replaceAll("|", "\\|")} |`),
      "",
      formatMarkdown(result.check),
      format === "pr-comment-github" ? "<!-- codebase-intelligence:ci-pr-comment-github -->" : "",
      format === "pr-comment-gitlab" ? "<!-- codebase-intelligence:ci-pr-comment-gitlab -->" : "",
    ].filter(Boolean).join("\n");
  }
  if (format === "annotations") return formatResult(result.check, "annotations");
  if (format === "badge") return formatResult(result.check, "badge");
  if (format === "codeclimate") return formatResult(result.check, "codeclimate");
  if (summary) return result.summary;
  return format === "compact" ? `${result.summary}\n${formatCompact(result.check)}` : formatResult(result.check, "text");
}
