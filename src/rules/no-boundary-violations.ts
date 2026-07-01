import { computeBoundaries } from "../boundaries/index.js";
import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

/** Enforce configured architecture boundary zones against file import edges. */
export const noBoundaryViolations: Rule = {
  id: "no-boundary-violations",
  meta: { description: "Forbid imports that cross configured architecture boundaries.", category: "architecture", fixable: false },
  defaultSeverity: "error",
  run(ctx: RuleContext): ReportedFinding[] {
    if (!ctx.config.boundaries) return [];
    const result = computeBoundaries(ctx.graph, { config: ctx.config.boundaries });
    return result.violations.map((violation) => ({
      file: violation.source,
      line: 1,
      column: 1,
      kind: violation.kind,
      confidence: "high",
      message: violation.message,
      evidence: violation.evidence,
      actions: [{ kind: "inspect-boundary", auto_fixable: false }],
    }));
  },
};
