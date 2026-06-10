import { execFileSync } from "child_process";
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

/** Normalize a finding path to forward slashes for comparison with git output. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
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
  let findings = runEngine(ctx, ALL_RULES, config);

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
      }
    }
  }

  const summary = summarize(findings);
  const verdict = computeVerdict(summary, config);
  return { findings, summary, verdict, configPath };
}

/** Process exit code for a check result: 1 on fail, 0 otherwise. (Config errors → 2, handled by the CLI.) */
export function exitCodeFor(result: CheckResult): number {
  return result.verdict === "fail" ? 1 : 0;
}
