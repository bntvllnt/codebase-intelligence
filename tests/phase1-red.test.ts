import { describe, it, expect } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import path from "path";
import fs from "fs";

const expectedDir = path.resolve(__dirname, "fixture-codebase/expected");

function loadExpected(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(expectedDir, file), "utf-8")) as unknown;
}

interface ExpectedCallEdge {
  caller: { file: string; symbol: string };
  callee: { file: string; symbol: string };
  confidence: "type-resolved" | "text-inferred";
}

interface ExpectedCallGraph {
  edges: ExpectedCallEdge[];
  stats: {
    totalCallEdges: number;
    highFanIn: Array<{ symbol: string; file: string; fanIn: number }>;
    entryPoints: string[];
  };
}

interface ExpectedSymbol {
  name: string;
  type: string;
  file: string;
  isDefault?: boolean;
}

interface ExpectedSymbolsFile {
  symbols: ExpectedSymbol[];
  stats: {
    totalSymbols: number;
    deadExports: Array<{ name: string; file: string }>;
  };
}

describe("1.1 — parser re-export resolution", () => {
  it("barrel index.ts files expose transitive exports", { timeout: 30_000 }, () => {
    const { parsedFiles } = getFixturePipeline();
    const authIndex = parsedFiles.find((f) => f.relativePath === "auth/index.ts");
    expect(authIndex).toBeDefined();
    if (!authIndex) return;

    const exportNames = authIndex.exports.map((e) => e.name);
    expect(exportNames).toContain("AuthService");
    expect(exportNames).toContain("authenticate");
    expect(exportNames).toContain("requireAuth");
  });

  it("re-exported symbols resolve to their original source file", () => {
    const { builtGraph } = getFixturePipeline();
    const authIndexEdges = builtGraph.edges.filter(
      (e) => e.source === "auth/index.ts"
    );
    expect(authIndexEdges.length).toBeGreaterThan(0);

    const toAuthService = authIndexEdges.find((e) => e.target === "auth/auth-service.ts");
    expect(toAuthService).toBeDefined();
    if (!toAuthService) return;
    expect(toAuthService.symbols).toContain("AuthService");
  });
});

describe("1.2 — file_context returns correct type for classes", () => {
  it("class exports have type 'class' not 'function'", () => {
    const { codebaseGraph } = getFixturePipeline();
    const classNodes = codebaseGraph.nodes.filter(
      (n) => n.type === "class"
    );
    expect(classNodes.length).toBeGreaterThan(0);

    const authServiceNode = classNodes.find((n) => n.label === "AuthService");
    expect(authServiceNode).toBeDefined();
    expect(authServiceNode?.type).toBe("class");
  });
});

describe("1.4 — file graph excludes orphan function nodes from PageRank", () => {
  it("only file nodes exist in the file graph", () => {
    const { builtGraph } = getFixturePipeline();
    const graphNodeTypes = new Set<string>();
    builtGraph.graph.forEachNode((_node: string, attrs: Record<string, unknown>) => {
      graphNodeTypes.add(attrs.type as string);
    });
    expect(graphNodeTypes.has("function")).toBe(false);
    expect(graphNodeTypes.has("class")).toBe(false);
    expect(graphNodeTypes.has("file")).toBe(true);
  });
});

describe("1.5 — parser extracts call sites", () => {
  it("auth-service.ts has call sites to user-service.ts methods", () => {
    const { parsedFiles } = getFixturePipeline();
    const authService = parsedFiles.find((f) =>
      f.relativePath.endsWith("auth-service.ts") && !f.relativePath.includes("index")
    );
    expect(authService).toBeDefined();
    if (!authService) return;

    expect(authService.callSites.length).toBeGreaterThan(0);

    const callToUserService = authService.callSites.find(
      (cs) => cs.calleeFile.endsWith("user-service.ts") || cs.calleeSymbol.includes("listUsers")
    );
    expect(callToUserService).toBeDefined();
    expect(callToUserService?.confidence).toBe("type-resolved");
  });

  it("extracts expected number of call edges from fixture", () => {
    const { parsedFiles } = getFixturePipeline();
    const expected = loadExpected("call-graph.json") as ExpectedCallGraph;
    const totalCallSites = parsedFiles.reduce((sum, f) => sum + f.callSites.length, 0);

    expect(totalCallSites).toBeGreaterThanOrEqual(expected.stats.totalCallEdges * 0.7);
  });
});

describe("1.6 — call graph contains symbol nodes with edges", () => {
  it("call graph has symbol nodes", () => {
    const { builtGraph } = getFixturePipeline();
    expect(builtGraph.symbolNodes.length).toBeGreaterThan(0);
    expect(builtGraph.callGraph.order).toBeGreaterThan(0);
  });

  it("AuthService.validate → UserService.getUserById edge exists", () => {
    const { builtGraph } = getFixturePipeline();
    const edge = builtGraph.callEdges.find(
      (e) =>
        e.callerSymbol.includes("validate") &&
        e.calleeSymbol.includes("getUserById")
    );
    expect(edge).toBeDefined();
    expect(edge?.confidence).toBe("type-resolved");
  });

  it("call edges match ground truth within tolerance", () => {
    const { builtGraph } = getFixturePipeline();
    const expected = loadExpected("call-graph.json") as ExpectedCallGraph;

    expect(builtGraph.callEdges.length).toBeGreaterThanOrEqual(
      expected.stats.totalCallEdges * 0.7
    );
  });
});

describe("1.7 — per-symbol fan-in/fan-out", () => {
  it("logger.log has high fan-in", () => {
    const { codebaseGraph } = getFixturePipeline();
    const logMetrics = Array.from(codebaseGraph.symbolMetrics.values()).find(
      (m) => m.name === "log" && m.file.endsWith("logger.ts")
    );
    expect(logMetrics).toBeDefined();
    if (!logMetrics) return;
    expect(logMetrics.fanIn).toBeGreaterThanOrEqual(5);
  });

  it("symbol metrics exist for all exported symbols", () => {
    const { codebaseGraph } = getFixturePipeline();
    expect(codebaseGraph.symbolMetrics.size).toBeGreaterThan(0);

    const expected = loadExpected("symbols.json") as ExpectedSymbolsFile;
    const functionSymbols = expected.symbols.filter(
      (s) => s.type === "function" || s.type === "class"
    );
    expect(codebaseGraph.symbolMetrics.size).toBeGreaterThanOrEqual(
      functionSymbols.length * 0.7
    );
  });
});

describe("1.10 — hints module", () => {
  it("hints module exports getHints function", async () => {
    const hintsModule = await import("../src/mcp/hints.js");
    expect(hintsModule.getHints).toBeDefined();
    expect(typeof hintsModule.getHints).toBe("function");
  });

  it("returns next-step suggestions for known tools", async () => {
    const { getHints } = await import("../src/mcp/hints.js");
    const hints = getHints("symbol_context");
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.length).toBeGreaterThan(0);
    expect(typeof hints[0]).toBe("string");
  });
});
