import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

/** Report every circular dependency cycle detected in the file graph. */
export const noCircularDeps: Rule = {
  id: "no-circular-deps",
  meta: { description: "Forbid circular dependencies between files.", category: "architecture", fixable: false },
  defaultSeverity: "error",
  run(ctx: RuleContext): ReportedFinding[] {
    return ctx.graph.stats.circularDeps
      .filter((cycle) => cycle.length > 0)
      .map((cycle) => ({
        file: cycle[0],
        line: 1,
        column: 1,
        message: `Circular dependency: ${cycle.join(" -> ")}`,
      }));
  },
};
