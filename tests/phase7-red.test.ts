import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
});

describe("7A.1 — GET /api/symbol-graph", () => {
  it("returns symbolNodes[], callEdges[], symbolMetrics[] with correct types (AC-1)", async () => {
    const { GET } = await import("../app/api/symbol-graph/route.js");
    const response = GET();
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      symbolNodes: Array<{
        id: string;
        name: string;
        type: string;
        file: string;
        loc: number;
        pageRank: number;
        betweenness: number;
        fanIn: number;
        fanOut: number;
      }>;
      callEdges: Array<{
        source: string;
        target: string;
        callerSymbol: string;
        calleeSymbol: string;
        confidence: string;
      }>;
      symbolMetrics: Array<{
        symbolId: string;
        name: string;
        pageRank: number;
        betweenness: number;
        fanIn: number;
        fanOut: number;
      }>;
    };

    expect(Array.isArray(data.symbolNodes)).toBe(true);
    expect(Array.isArray(data.callEdges)).toBe(true);
    expect(Array.isArray(data.symbolMetrics)).toBe(true);

    expect(data.symbolNodes.length).toBeGreaterThan(0);
    expect(data.callEdges.length).toBeGreaterThan(0);
    expect(data.symbolMetrics.length).toBeGreaterThan(0);

    const firstNode = data.symbolNodes[0];
    expect(firstNode).toHaveProperty("id");
    expect(firstNode).toHaveProperty("name");
    expect(firstNode).toHaveProperty("type");
    expect(firstNode).toHaveProperty("file");
    expect(firstNode).toHaveProperty("loc");
    expect(firstNode).toHaveProperty("pageRank");
    expect(firstNode).toHaveProperty("betweenness");
    expect(firstNode).toHaveProperty("fanIn");
    expect(firstNode).toHaveProperty("fanOut");

    const firstEdge = data.callEdges[0];
    expect(firstEdge).toHaveProperty("source");
    expect(firstEdge).toHaveProperty("target");
    expect(firstEdge).toHaveProperty("callerSymbol");
    expect(firstEdge).toHaveProperty("calleeSymbol");
    expect(firstEdge).toHaveProperty("confidence");
    expect(["type-resolved", "text-inferred"]).toContain(firstEdge.confidence);
  });

  it("returns 200 with empty arrays when no symbols exist (AC-E1)", async () => {
    const { getGraph } = await import("../src/server/graph-store.js");
    const graph = getGraph();

    const origNodes = graph.symbolNodes;
    const origEdges = graph.callEdges;
    const origMetrics = graph.symbolMetrics;

    graph.symbolNodes = [];
    graph.callEdges = [];
    graph.symbolMetrics = new Map();

    try {
      const { GET } = await import("../app/api/symbol-graph/route.js");
      const response = GET();
      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        symbolNodes: unknown[];
        callEdges: unknown[];
        symbolMetrics: unknown[];
      };

      expect(data.symbolNodes).toEqual([]);
      expect(data.callEdges).toEqual([]);
      expect(data.symbolMetrics).toEqual([]);
    } finally {
      graph.symbolNodes = origNodes;
      graph.callEdges = origEdges;
      graph.symbolMetrics = origMetrics;
    }
  });

  it("symbol nodes include pageRank-based size data", async () => {
    const { GET } = await import("../app/api/symbol-graph/route.js");
    const response = GET();
    const data = (await response.json()) as {
      symbolNodes: Array<{ pageRank: number }>;
    };

    const ranks = data.symbolNodes.map((n) => n.pageRank);
    const allNumbers = ranks.every((r) => typeof r === "number" && r >= 0);
    expect(allNumbers).toBe(true);
  });
});

describe("7A.2 — enriched GET /api/file/[...path]", () => {
  it("functions[] include per-export fanIn, fanOut, pageRank (AC-5)", async () => {
    const { GET } = await import("../app/api/file/[...path]/route.js");
    const request = new Request("http://localhost/api/file/auth/auth-service.ts");
    const response = await GET(request, {
      params: Promise.resolve({ path: ["auth", "auth-service.ts"] }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      functions: Array<{
        name: string;
        loc: number;
        fanIn: number;
        fanOut: number;
        pageRank: number;
      }>;
    };

    expect(data.functions.length).toBeGreaterThan(0);

    for (const fn of data.functions) {
      expect(fn).toHaveProperty("fanIn");
      expect(fn).toHaveProperty("fanOut");
      expect(fn).toHaveProperty("pageRank");
      expect(typeof fn.fanIn).toBe("number");
      expect(typeof fn.fanOut).toBe("number");
      expect(typeof fn.pageRank).toBe("number");
    }
  });
});

describe("7A.3 — enriched GET /api/symbols/[name]", () => {
  it("includes loc, type, pageRank, betweenness fields (AC-7)", async () => {
    const { GET } = await import("../app/api/symbols/[name]/route.js");
    const request = new Request("http://localhost/api/symbols/AuthService");
    const response = await GET(request, {
      params: Promise.resolve({ name: "AuthService" }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      name: string;
      loc: number;
      type: string;
      pageRank: number;
      betweenness: number;
    };

    expect(data).toHaveProperty("loc");
    expect(data).toHaveProperty("type");
    expect(data).toHaveProperty("pageRank");
    expect(data).toHaveProperty("betweenness");
    expect(typeof data.loc).toBe("number");
    expect(typeof data.type).toBe("string");
    expect(typeof data.pageRank).toBe("number");
    expect(typeof data.betweenness).toBe("number");
  });
});
