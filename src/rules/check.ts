import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type {
  CheckResult,
  CheckSummary,
  CheckSuppression,
  CodebaseGraph,
  CodebaseIntelligenceConfig,
  Finding,
  FindingAction,
  Verdict,
} from "../types/index.js";
import { loadConfig, type ConfigOverrides } from "../config/index.js";
import { runEngineWithSuppressions, type RuleContext } from "./engine.js";
import { ALL_RULES } from "./registry.js";

function summarize(findings: Finding[], suppressions: CheckSuppression[]): CheckSummary {
  const rules: Record<string, number> = {};
  let error = 0;
  let warn = 0;
  let suppressed = 0;
  let staleSuppressions = 0;
  for (const f of findings) {
    rules[f.ruleId] = (rules[f.ruleId] ?? 0) + 1;
    if (f.severity === "error") error++;
    else warn++;
  }
  for (const suppression of suppressions) {
    if (suppression.status === "active") suppressed += suppression.suppressed;
    else staleSuppressions += 1;
  }
  return { error, warn, suppressed, staleSuppressions, rules };
}

function computeVerdict(summary: CheckSummary, config: CodebaseIntelligenceConfig): Verdict {
  const failOn = config.ci?.failOn ?? "error";
  const maxWarnings = config.ci?.maxWarnings ?? -1;
  if (summary.error + summary.warn === 0) return "pass";

  let failing = false;
  if (failOn === "error") failing = summary.error > 0;
  else if (failOn === "warn") failing = summary.error > 0 || summary.warn > 0;
  // maxWarnings is an independent count gate, but failOn:"never" disables all gating.
  if (failOn !== "never" && maxWarnings >= 0 && summary.warn > maxWarnings) failing = true;

  return failing ? "fail" : "warn";
}

/**
 * Files changed since baseRef, relative to rootDir (git --relative, so a check target
 * that is a subdirectory of the repo still matches finding paths). Forward-slash
 * normalized. null when git/base is unavailable.
 */
function changedFilesSince(rootDir: string, baseRef: string): Set<string> | null {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--relative", `${baseRef}...HEAD`], {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

interface ChangedRange {
  start: number;
  end: number;
}

type ChangedRanges = Map<string, ChangedRange[]>;

function emptyRanges(): ChangedRanges {
  return new Map<string, ChangedRange[]>();
}

function addRange(ranges: ChangedRanges, file: string, start: number, count: number): void {
  if (count <= 0) return;
  const normalized = toPosix(file);
  const list = ranges.get(normalized) ?? [];
  const end = start + count - 1;
  list.push({ start, end });
  ranges.set(normalized, list);
}

function parseUnifiedDiff(diff: string): ChangedRanges {
  const ranges = emptyRanges();
  let currentFile: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length).trim();
      continue;
    }
    if (line.startsWith("+++ ")) {
      const candidate = line.slice("+++ ".length).trim();
      currentFile = candidate === "/dev/null" ? null : candidate.replace(/^b\//, "");
      continue;
    }
    if (!currentFile || !line.startsWith("@@")) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) continue;
    const parsedCount = Number.parseInt(match[2], 10);
    const count = Number.isNaN(parsedCount) ? 1 : parsedCount;
    addRange(ranges, currentFile, Number.parseInt(match[1], 10), count);
  }
  return ranges;
}

function changedRangesSince(rootDir: string, baseRef: string): ChangedRanges | null {
  try {
    const out = execFileSync("git", ["diff", "--unified=0", "--relative", `${baseRef}...HEAD`], {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseUnifiedDiff(out);
  } catch {
    return null;
  }
}

function changedRangesFromDiffFile(rootDir: string, diffFile: string): ChangedRanges | null {
  try {
    const resolved = path.resolve(rootDir, diffFile);
    return parseUnifiedDiff(fs.readFileSync(resolved, "utf-8"));
  } catch {
    return null;
  }
}

/** Normalize a finding path to forward slashes for comparison with git output. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isTestOrDevPath(file: string): boolean {
  const normalized = toPosix(file);
  return normalized.includes("__tests__/")
    || normalized.includes("/tests/")
    || normalized.startsWith("tests/")
    || /\.(?:test|spec|stories)\.[cm]?[tj]sx?$/.test(normalized)
    || normalized.endsWith(".d.ts");
}

function findingInRanges(finding: Finding, ranges: ChangedRanges): boolean {
  const list = ranges.get(toPosix(finding.file));
  if (!list) return false;
  const start = finding.line;
  const end = finding.endLine ?? finding.line;
  return list.some((range) => start <= range.end && end >= range.start);
}

function suppressionsInRanges(suppression: CheckSuppression, ranges: ChangedRanges): boolean {
  const list = ranges.get(toPosix(suppression.file));
  if (!list) return false;
  const line = suppression.targetLine ?? suppression.line;
  return list.some((range) => line >= range.start && line <= range.end);
}

function defaultActionFor(finding: Finding): FindingAction {
  return {
    kind: "inspect-file",
    auto_fixable: false,
    command: `codebase-intelligence file . ${finding.file}`,
    reason: `${finding.ruleId} at ${finding.file}:${String(finding.line)}`,
  };
}

function withActions(findings: Finding[]): Finding[] {
  return findings.map((finding) => {
    if (finding.actions && finding.actions.length > 0) return finding;
    return { ...finding, actions: [defaultActionFor(finding)] };
  });
}

/**
 * Run the rules engine against an analyzed graph and return findings + verdict.
 * Loads config (discovery or overrides.configPath) — throws ConfigError on bad config.
 *
 * When config.ci.gate is "new-only", findings are filtered to files changed since
 * config.ci.base (file-level new-vs-base gating; assumes rootDir is the repo root).
 * Source reads are confined to rootDir (symlinks resolving outside are dropped).
 */
export function runCheck(
  graph: CodebaseGraph,
  rootDir: string,
  overrides?: ConfigOverrides,
): CheckResult {
  const { config, configPath } = loadConfig(rootDir, overrides);
  const resolvedRoot = path.resolve(rootDir);
  let realRoot = resolvedRoot;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
  } catch {
    /* root not resolvable — keep the lexical path */
  }

  const fileRelPaths = graph.nodes.filter((n) => n.type === "file").map((n) => n.id);
  const cache = new Map<string, string | null>();
  const sourceOf = (rel: string): string | null => {
    if (cache.has(rel)) return cache.get(rel) ?? null;
    let text: string | null = null;
    try {
      const real = fs.realpathSync(path.resolve(realRoot, rel));
      // Confinement: never read a path (or symlink target) outside the project root.
      if (real === realRoot || real.startsWith(realRoot + path.sep)) {
        text = fs.readFileSync(real, "utf-8");
      }
    } catch {
      text = null;
    }
    cache.set(rel, text);
    return text;
  };

  const ctx: RuleContext = { graph, rootDir: resolvedRoot, config, fileRelPaths, sourceOf };
  const engineResult = runEngineWithSuppressions(ctx, ALL_RULES, config);
  let findings = engineResult.findings;
  let suppressions = engineResult.suppressions;

  if (config.ci?.gate === "new-only") {
    const base = config.ci.base;
    if (!base) {
      process.stderr.write("Warning: gate 'new-only' requires a base ref (--base); running full check.\n");
    } else {
      const changed = changedFilesSince(resolvedRoot, base);
      if (changed === null) {
        process.stderr.write(`Warning: could not diff against '${base}'; running full check.\n`);
      } else {
        findings = findings.filter((f) => changed.has(toPosix(f.file)));
        suppressions = suppressions.filter((suppression) => changed.has(toPosix(suppression.file)));
      }
    }
  }

  const diffRanges = overrides?.diffFile
    ? changedRangesFromDiffFile(resolvedRoot, overrides.diffFile)
    : overrides?.changedSince
      ? changedRangesSince(resolvedRoot, overrides.changedSince)
      : null;
  if (overrides?.diffFile && diffRanges === null) {
    process.stderr.write(`Warning: could not read diff file '${overrides.diffFile}'; running full check.\n`);
  }
  if (overrides?.changedSince && diffRanges === null) {
    process.stderr.write(`Warning: could not diff against '${overrides.changedSince}'; running full check.\n`);
  }
  if (diffRanges) {
    findings = findings.filter((f) => findingInRanges(f, diffRanges));
    suppressions = suppressions.filter((suppression) => suppressionsInRanges(suppression, diffRanges));
  }

  if (config.ci?.production === true) {
    findings = findings.filter((f) => !isTestOrDevPath(f.file));
    suppressions = suppressions.filter((suppression) => !isTestOrDevPath(suppression.file));
  }

  findings = withActions(findings);
  const summary = summarize(findings, suppressions);
  const verdict = computeVerdict(summary, config);
  return { findings, suppressions, summary, verdict, configPath };
}

/** Process exit code for a check result: 1 on fail, 0 otherwise. (Config errors → 2, handled by the CLI.) */
export function exitCodeFor(result: CheckResult): number {
  return result.verdict === "fail" ? 1 : 0;
}
