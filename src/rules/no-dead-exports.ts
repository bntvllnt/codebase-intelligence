import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

/** Report exported symbols that are never imported (per-file dead exports). */
export const noDeadExports: Rule = {
  id: "no-dead-exports",
  meta: { description: "Report exported symbols that are never imported.", category: "cleanup", fixable: false },
  defaultSeverity: "warn",
  run(ctx: RuleContext): ReportedFinding[] {
    const findings: ReportedFinding[] = [];
    for (const [file, metrics] of ctx.graph.fileMetrics) {
      for (const name of metrics.deadExports) {
        findings.push({ file, line: 1, column: 1, message: `Unused export: ${name}` });
      }
    }
    return findings;
  },
};
