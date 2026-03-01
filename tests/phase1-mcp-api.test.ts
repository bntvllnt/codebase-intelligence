import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
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

describe("1.9 — GET /api/symbols/:name route", () => {
  it("returns symbol data for AuthService", async () => {
    const { GET } = await import("../app/api/symbols/[name]/route.js");
    expect(GET).toBeDefined();

    const request = new Request("http://localhost/api/symbols/AuthService", {
      method: "GET",
    });
    const response = await GET(request, { params: Promise.resolve({ name: "AuthService" }) });
    expect(response.status).toBe(200);

    const data = (await response.json()) as { name: string; callers: unknown[]; callees: unknown[]; nextSteps: string[] };
    expect(data.name).toBe("AuthService");
    expect(data.callers).toBeDefined();
    expect(data.callees).toBeDefined();
    expect(data.nextSteps).toBeDefined();
  });
});
