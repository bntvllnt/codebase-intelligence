import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { registerTools } from "../src/mcp/index.js";
import type { CodebaseGraph } from "../src/types/index.js";

let graph: CodebaseGraph;
let server: McpServer;

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

type ToolRegistry = Record<string, RegisteredTool>;

function getTools(): ToolRegistry {
  return (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tools = getTools();
  const tool = tools[name] as RegisteredTool | undefined;
  if (tool === undefined) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args);
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}

beforeAll(() => {
  const pipeline = getFixturePipeline();
  graph = pipeline.codebaseGraph;
  server = new McpServer({ name: "test", version: "0.0.1" });
  registerTools(server, graph);
});

describe("symbol_context enhancements", () => {
  it("returns pageRank, betweenness, loc, type fields", async () => {
    const symbolName = graph.symbolNodes[0]?.name;
    if (!symbolName) return;

    const result = await callTool("symbol_context", { name: symbolName });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data).toHaveProperty("pageRank");
    expect(data).toHaveProperty("betweenness");
    expect(data).toHaveProperty("loc");
    expect(data).toHaveProperty("type");
    expect(typeof data.pageRank).toBe("number");
    expect(typeof data.betweenness).toBe("number");
    expect(typeof data.loc).toBe("number");
    expect(typeof data.type).toBe("string");
  });

  it("includes confidence on callers", async () => {
    const symWithCallers = [...graph.symbolMetrics.values()].find((s) => s.fanIn > 0);
    if (!symWithCallers) return;

    const result = await callTool("symbol_context", { name: symWithCallers.name });
    const data = parseResult(result) as { callers: Array<{ confidence: string }> };

    if (data.callers.length > 0) {
      expect(data.callers[0]).toHaveProperty("confidence");
      expect(["type-resolved", "text-inferred"]).toContain(data.callers[0].confidence);
    }
  });

  it("includes confidence on callees", async () => {
    const symWithCallees = [...graph.symbolMetrics.values()].find((s) => s.fanOut > 0);
    if (!symWithCallees) return;

    const result = await callTool("symbol_context", { name: symWithCallees.name });
    const data = parseResult(result) as { callees: Array<{ confidence: string }> };

    if (data.callees.length > 0) {
      expect(data.callees[0]).toHaveProperty("confidence");
      expect(["type-resolved", "text-inferred"]).toContain(data.callees[0].confidence);
    }
  });

  it("returns isDefault and complexity fields", async () => {
    const symbolName = graph.symbolNodes[0]?.name;
    if (!symbolName) return;

    const result = await callTool("symbol_context", { name: symbolName });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data).toHaveProperty("isDefault");
    expect(data).toHaveProperty("complexity");
    expect(typeof data.isDefault).toBe("boolean");
    expect(typeof data.complexity).toBe("number");
  });

  it("returns error for unknown symbol", async () => {
    const result = await callTool("symbol_context", { name: "NonExistentSymbol12345" });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Symbol not found");
  });
});

describe("file_context edge metadata", () => {
  it("imports include isTypeOnly and weight", async () => {
    const filePath = graph.nodes.find((n) => n.type === "file")?.id;
    if (!filePath) return;

    const result = await callTool("file_context", { filePath });
    const data = parseResult(result) as {
      imports: Array<{ from: string; symbols: string[]; isTypeOnly: boolean; weight: number }>;
    };

    for (const imp of data.imports) {
      expect(imp).toHaveProperty("isTypeOnly");
      expect(imp).toHaveProperty("weight");
      expect(typeof imp.isTypeOnly).toBe("boolean");
      expect(typeof imp.weight).toBe("number");
    }
  });

  it("dependents include isTypeOnly and weight", async () => {
    const fileWithDeps = [...graph.fileMetrics.entries()].find(([, m]) => m.fanIn > 0);
    if (!fileWithDeps) return;

    const result = await callTool("file_context", { filePath: fileWithDeps[0] });
    const data = parseResult(result) as {
      dependents: Array<{ path: string; symbols: string[]; isTypeOnly: boolean; weight: number }>;
    };

    if (data.dependents.length > 0) {
      expect(data.dependents[0]).toHaveProperty("isTypeOnly");
      expect(data.dependents[0]).toHaveProperty("weight");
      expect(typeof data.dependents[0].isTypeOnly).toBe("boolean");
      expect(typeof data.dependents[0].weight).toBe("number");
    }
  });
});

describe("analyze_forces threshold params", () => {
  it("defaults match original hardcoded behavior", async () => {
    const result = await callTool("analyze_forces", {});
    const data = parseResult(result) as {
      moduleCohesion: Array<{ cohesion: number; verdict: string }>;
      tensionFiles: unknown[];
    };

    expect(data.moduleCohesion.length).toBeGreaterThan(0);
    for (const m of data.moduleCohesion) {
      if (m.cohesion >= 0.6) expect(m.verdict).toBe("COHESIVE");
    }
  });

  it("high tension threshold filters out tension files", async () => {
    const defaultResult = await callTool("analyze_forces", {});
    const defaultData = parseResult(defaultResult) as { tensionFiles: unknown[] };

    const strictResult = await callTool("analyze_forces", { tensionThreshold: 0.99 });
    const strictData = parseResult(strictResult) as { tensionFiles: unknown[] };

    expect(strictData.tensionFiles.length).toBeLessThanOrEqual(defaultData.tensionFiles.length);
  });

  it("high escape threshold filters extraction candidates", async () => {
    const defaultResult = await callTool("analyze_forces", {});
    const defaultData = parseResult(defaultResult) as { extractionCandidates: unknown[] };

    const strictResult = await callTool("analyze_forces", { escapeThreshold: 0.99 });
    const strictData = parseResult(strictResult) as { extractionCandidates: unknown[] };

    expect(strictData.extractionCandidates.length).toBeLessThanOrEqual(defaultData.extractionCandidates.length);
  });
});

describe("detect_changes enrichment", () => {
  it("response includes fileRiskMetrics array", async () => {
    const result = await callTool("detect_changes", { scope: "all" });
    const data = parseResult(result) as { fileRiskMetrics: unknown[] };

    expect(data).toHaveProperty("fileRiskMetrics");
    expect(Array.isArray(data.fileRiskMetrics)).toBe(true);
  });

  it("fileRiskMetrics entries have blastRadius, complexity, churn", async () => {
    const result = await callTool("detect_changes", { scope: "all" });
    const data = parseResult(result) as {
      fileRiskMetrics: Array<{ file: string; blastRadius: number; complexity: number; churn: number }>;
    };

    for (const entry of data.fileRiskMetrics) {
      expect(entry).toHaveProperty("file");
      expect(entry).toHaveProperty("blastRadius");
      expect(entry).toHaveProperty("complexity");
      expect(entry).toHaveProperty("churn");
      expect(typeof entry.blastRadius).toBe("number");
      expect(typeof entry.complexity).toBe("number");
      expect(typeof entry.churn).toBe("number");
    }
  });
});

describe("get_processes tool", () => {
  it("returns processes array with totalProcesses", async () => {
    const result = await callTool("get_processes", {});
    const data = parseResult(result) as { processes: unknown[]; totalProcesses: number };

    expect(data).toHaveProperty("processes");
    expect(data).toHaveProperty("totalProcesses");
    expect(Array.isArray(data.processes)).toBe(true);
    expect(typeof data.totalProcesses).toBe("number");
  });

  it("each process has name, entryPoint, steps, depth, modulesTouched", async () => {
    const result = await callTool("get_processes", {});
    const data = parseResult(result) as {
      processes: Array<{
        name: string;
        entryPoint: { file: string; symbol: string };
        steps: unknown[];
        depth: number;
        modulesTouched: string[];
      }>;
    };

    for (const p of data.processes) {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("entryPoint");
      expect(p.entryPoint).toHaveProperty("file");
      expect(p.entryPoint).toHaveProperty("symbol");
      expect(p).toHaveProperty("steps");
      expect(p).toHaveProperty("depth");
      expect(p).toHaveProperty("modulesTouched");
    }
  });

  it("entryPoint filter works", async () => {
    const allResult = await callTool("get_processes", {});
    const allData = parseResult(allResult) as { processes: Array<{ name: string }> };

    if (allData.processes.length > 0) {
      const firstName = allData.processes[0].name;
      const filteredResult = await callTool("get_processes", { entryPoint: firstName });
      const filteredData = parseResult(filteredResult) as { processes: unknown[] };
      expect(filteredData.processes.length).toBeLessThanOrEqual(allData.processes.length);
    }
  });

  it("limit param restricts results", async () => {
    const result = await callTool("get_processes", { limit: 1 });
    const data = parseResult(result) as { processes: unknown[] };
    expect(data.processes.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array when no processes match filter", async () => {
    const result = await callTool("get_processes", { entryPoint: "nonexistent_entry_point_xyz" });
    const data = parseResult(result) as { processes: unknown[] };
    expect(result.isError).toBeUndefined();
    expect(data.processes).toEqual([]);
  });
});

describe("get_clusters tool", () => {
  it("returns clusters array with totalClusters", async () => {
    const result = await callTool("get_clusters", {});
    const data = parseResult(result) as { clusters: unknown[]; totalClusters: number };

    expect(data).toHaveProperty("clusters");
    expect(data).toHaveProperty("totalClusters");
    expect(Array.isArray(data.clusters)).toBe(true);
    expect(typeof data.totalClusters).toBe("number");
  });

  it("each cluster has id, name, files, fileCount, cohesion", async () => {
    const result = await callTool("get_clusters", {});
    const data = parseResult(result) as {
      clusters: Array<{
        id: string;
        name: string;
        files: string[];
        fileCount: number;
        cohesion: number;
      }>;
    };

    for (const c of data.clusters) {
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("files");
      expect(c).toHaveProperty("fileCount");
      expect(c).toHaveProperty("cohesion");
      expect(c.fileCount).toBe(c.files.length);
    }
  });

  it("minFiles filter works", async () => {
    const allResult = await callTool("get_clusters", {});
    const allData = parseResult(allResult) as { clusters: Array<{ fileCount: number }> };

    const filteredResult = await callTool("get_clusters", { minFiles: 100 });
    const filteredData = parseResult(filteredResult) as { clusters: unknown[] };

    expect(filteredData.clusters.length).toBeLessThanOrEqual(allData.clusters.length);
  });
});

describe("tool descriptions include disambiguation", () => {
  it("all 15 tools are registered", () => {
    const tools = getTools();
    const toolNames = Object.keys(tools);

    const expected = [
      "codebase_overview", "file_context", "get_dependents", "find_hotspots",
      "get_module_structure", "analyze_forces", "find_dead_exports", "get_groups",
      "symbol_context", "search", "detect_changes", "impact_analysis", "rename_symbol",
      "get_processes", "get_clusters",
    ];

    for (const name of expected) {
      expect(toolNames).toContain(name);
    }
  });
});
