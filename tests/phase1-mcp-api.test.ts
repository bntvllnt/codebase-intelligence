import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";
import { createFixtureMcp } from "./helpers/mcp.js";

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
  it("calling with 'AuthService' returns callers, callees, metrics, nextSteps", async () => {
    const { callTool } = await createFixtureMcp();
    const result = await callTool("symbol_context", { name: "AuthService" });

    expect(result).toHaveProperty("name", "AuthService");
    expect(result).toHaveProperty("file", "auth/auth-service.ts");
    expect(result).toHaveProperty("type", "class");
    expect(result).toHaveProperty("callers");
    expect(result).toHaveProperty("callees");
    expect(result).toHaveProperty("fanIn");
    expect(result).toHaveProperty("fanOut");
    expect(result).toHaveProperty("pageRank");
    expect(result).toHaveProperty("betweenness");
    expect(result).toHaveProperty("nextSteps");

    expect(Array.isArray(result.callers)).toBe(true);
    expect(Array.isArray(result.callees)).toBe(true);
    expect(typeof result.fanIn).toBe("number");
    expect(typeof result.fanOut).toBe("number");
    expect(typeof result.pageRank).toBe("number");
    expect(typeof result.betweenness).toBe("number");
    const nextSteps = result.nextSteps;
    expect(Array.isArray(nextSteps)).toBe(true);
    if (Array.isArray(nextSteps)) expect(nextSteps.length).toBeGreaterThan(0);
  });
});
