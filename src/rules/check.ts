import fs from "fs";
import path from "path";
import type {
  CheckResult,
  CheckSummary,
  CodebaseGraph,
  CodebaseIntelligenceConfig,
  Finding,
  Verdict,
} from "../types/index.js";
import { loadConfig, type ConfigOverrides } from "../config/index.js";
import { runEngine, type RuleContext } from "./engine.js";
import { ALL_RULES } from "./registry.js";

function summarize(findings: Finding[]): CheckSummary {
  const rules: Record<string, number> = {};
  let error = 0;
  let warn = 0;
  for (const f of findings) {
    rules[f.ruleId] = (rules[f.ruleId] ?? 0) + 1;
    if (f.severity === "error") error++;
    else warn++;
  }
  return { error, warn, rules };
}

function computeVerdict(summary: CheckSummary, config: CodebaseIntelligenceConfig): Verdict {
  const failOn = config.ci?.failOn ?? "error";
  const maxWarnings = config.ci?.maxWarnings ?? -1;
  if (summary.error + summary.warn === 0) return "pass";

  let failing = false;
  if (failOn === "error") failing = summary.error > 0;
  else if (failOn === "warn") failing = summary.error > 0 || summary.warn > 0;
  if (maxWarnings >= 0 && summary.warn > maxWarnings) failing = true;

  return failing ? "fail" : "warn";
}

/**
 * Run the rules engine against an analyzed graph and return findings + verdict.
 * Loads config (discovery or overrides.configPath) — throws ConfigError on bad config.
 */
export function runCheck(
  graph: CodebaseGraph,
  rootDir: string,
  overrides?: ConfigOverrides,
): CheckResult {
  const { config, configPath } = loadConfig(rootDir, overrides);

  const fileRelPaths = graph.nodes.filter((n) => n.type === "file").map((n) => n.id);
  const cache = new Map<string, string | null>();
  const sourceOf = (rel: string): string | null => {
    if (cache.has(rel)) return cache.get(rel) ?? null;
    let text: string | null;
    try {
      text = fs.readFileSync(path.join(rootDir, rel), "utf-8");
    } catch {
      text = null;
    }
    cache.set(rel, text);
    return text;
  };

  const ctx: RuleContext = { graph, rootDir, config, fileRelPaths, sourceOf };
  const findings = runEngine(ctx, ALL_RULES, config);
  const summary = summarize(findings);
  const verdict = computeVerdict(summary, config);
  return { findings, summary, verdict, configPath };
}

/** Process exit code for a check result: 1 on fail, 0 otherwise. (Config errors → 2, handled by the CLI.) */
export function exitCodeFor(result: CheckResult): number {
  return result.verdict === "fail" ? 1 : 0;
}
