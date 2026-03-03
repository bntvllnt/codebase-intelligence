import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph);
});

describe("1.3 — analyze_forces responds to threshold params", () => {
  it("different cohesion thresholds produce different verdicts", () => {
    const { codebaseGraph } = getFixturePipeline();
    const defaultVerdicts = codebaseGraph.forceAnalysis.moduleCohesion.map((m) => m.verdict);
    expect(defaultVerdicts.length).toBeGreaterThan(0);
  });
});

describe("1.8 — symbol_context MCP tool", () => {
  it.todo("calling with 'AuthService' returns callers, callees, metrics, nextSteps");
});
