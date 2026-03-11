import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { registerTools } from "../src/mcp/index.js";
import { setGraph, setIndexedHead } from "../src/server/graph-store.js";
import type { CodebaseGraph } from "../src/types/index.js";

let client: Client;
let graph: CodebaseGraph;

beforeAll(async () => {
  const pipeline = getFixturePipeline();
  graph = pipeline.codebaseGraph;
  setGraph(graph);
  setIndexedHead("abc123-test");

  const server = new McpServer({ name: "test", version: "0.1.0" });
  registerTools(server, graph);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);
});

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe("Tool 1: codebase_overview", () => {
  it("returns totalFiles, modules, topDependedFiles, metrics, nextSteps", async () => {
    const r = await callTool("codebase_overview");
    expect(r).toHaveProperty("totalFiles");
    expect(r).toHaveProperty("totalFunctions");
    expect(r).toHaveProperty("totalDependencies");
    expect(r).toHaveProperty("modules");
    expect(r).toHaveProperty("topDependedFiles");
    expect(r).toHaveProperty("metrics");
    expect(r).toHaveProperty("nextSteps");
    expect((r.modules as unknown[]).length).toBeGreaterThan(0);
    expect((r.topDependedFiles as unknown[]).length).toBeGreaterThan(0);
    const metrics = r.metrics as Record<string, unknown>;
    expect(metrics).toHaveProperty("avgLOC");
    expect(metrics).toHaveProperty("maxDepth");
    expect(metrics).toHaveProperty("circularDeps");
  });
});

describe("Tool 2: file_context", () => {
  it("returns file details for a valid file", async () => {
    const files = graph.nodes.filter((n) => n.type === "file");
    const filePath = files[0].id;
    const r = await callTool("file_context", { filePath });
    expect(r).toHaveProperty("path", filePath);
    expect(r).toHaveProperty("exports");
    expect(r).toHaveProperty("imports");
    expect(r).toHaveProperty("dependents");
    expect(r).toHaveProperty("metrics");
    expect(r).toHaveProperty("nextSteps");
    const m = r.metrics as Record<string, unknown>;
    expect(m).toHaveProperty("pageRank");
    expect(m).toHaveProperty("fanIn");
    expect(m).toHaveProperty("churn");
    expect(m).toHaveProperty("blastRadius");
  });

  it("returns error for unknown file", async () => {
    const result = await client.callTool({ name: "file_context", arguments: { filePath: "nonexistent.ts" } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("File not found");
  });
});

describe("Tool 3: get_dependents", () => {
  it("returns dependents for a file with importers", async () => {
    const fileWithDependents = [...graph.fileMetrics.entries()]
      .find(([, m]) => m.fanIn > 0)?.[0];
    if (!fileWithDependents) return;

    const r = await callTool("get_dependents", { filePath: fileWithDependents });
    expect(r).toHaveProperty("directDependents");
    expect(r).toHaveProperty("transitiveDependents");
    expect(r).toHaveProperty("totalAffected");
    expect(r).toHaveProperty("riskLevel");
    expect(r).toHaveProperty("nextSteps");
    expect((r.directDependents as unknown[]).length).toBeGreaterThan(0);
  });

  it("returns error for unknown file", async () => {
    const result = await client.callTool({ name: "get_dependents", arguments: { filePath: "nonexistent.ts" } });
    expect(result.isError).toBe(true);
  });
});

describe("Tool 4: find_hotspots", () => {
  const metrics = [
    "coupling", "pagerank", "fan_in", "fan_out", "betweenness",
    "tension", "churn", "complexity", "blast_radius", "coverage",
  ] as const;

  for (const metric of metrics) {
    it(`ranks files by ${metric}`, async () => {
      const r = await callTool("find_hotspots", { metric, limit: 3 });
      expect(r).toHaveProperty("metric", metric);
      expect(r).toHaveProperty("hotspots");
      expect(r).toHaveProperty("summary");
      expect(r).toHaveProperty("nextSteps");
      const hotspots = r.hotspots as Array<{ path: string; score: number; reason: string }>;
      expect(hotspots.length).toBeGreaterThan(0);
      expect(hotspots.length).toBeLessThanOrEqual(3);
      expect(hotspots[0]).toHaveProperty("path");
      expect(hotspots[0]).toHaveProperty("score");
      expect(hotspots[0]).toHaveProperty("reason");
    });
  }

  it("ranks modules by escape_velocity", async () => {
    const r = await callTool("find_hotspots", { metric: "escape_velocity" });
    expect(r).toHaveProperty("metric", "escape_velocity");
    const hotspots = r.hotspots as unknown[];
    expect(hotspots.length).toBeGreaterThan(0);
  });
});

describe("Tool 5: get_module_structure", () => {
  it("returns modules with cross-deps and circular deps", async () => {
    const r = await callTool("get_module_structure");
    expect(r).toHaveProperty("modules");
    expect(r).toHaveProperty("crossModuleDeps");
    expect(r).toHaveProperty("circularDeps");
    expect(r).toHaveProperty("nextSteps");
    const modules = r.modules as Array<Record<string, unknown>>;
    expect(modules.length).toBeGreaterThan(0);
    expect(modules[0]).toHaveProperty("path");
    expect(modules[0]).toHaveProperty("cohesion");
    expect(modules[0]).toHaveProperty("escapeVelocity");
  });
});

describe("Tool 6: analyze_forces", () => {
  it("returns cohesion, tension, bridges, extraction candidates", async () => {
    const r = await callTool("analyze_forces");
    expect(r).toHaveProperty("moduleCohesion");
    expect(r).toHaveProperty("tensionFiles");
    expect(r).toHaveProperty("bridgeFiles");
    expect(r).toHaveProperty("extractionCandidates");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("nextSteps");
    const cohesion = r.moduleCohesion as Array<Record<string, unknown>>;
    expect(cohesion.length).toBeGreaterThan(0);
    expect(cohesion[0]).toHaveProperty("verdict");
  });

  it("respects custom thresholds", async () => {
    const r = await callTool("analyze_forces", {
      cohesionThreshold: 0.9,
      tensionThreshold: 0.0,
      escapeThreshold: 0.0,
    });
    const cohesion = r.moduleCohesion as Array<{ verdict: string }>;
    expect(cohesion.some((m) => m.verdict !== "COHESIVE")).toBe(true);
  });
});

describe("Tool 7: find_dead_exports", () => {
  it("returns dead exports across codebase", async () => {
    const r = await callTool("find_dead_exports");
    expect(r).toHaveProperty("totalDeadExports");
    expect(r).toHaveProperty("files");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("nextSteps");
  });

  it("filters by module", async () => {
    const moduleName = [...graph.moduleMetrics.keys()][0];
    const r = await callTool("find_dead_exports", { module: moduleName });
    expect(r).toHaveProperty("files");
  });
});

describe("Tool 8: get_groups", () => {
  it("returns ranked directory groups", async () => {
    const r = await callTool("get_groups");
    expect(r).toHaveProperty("groups");
    expect(r).toHaveProperty("nextSteps");
    const groups = r.groups as Array<Record<string, unknown>>;
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]).toHaveProperty("rank");
    expect(groups[0]).toHaveProperty("name");
    expect(groups[0]).toHaveProperty("files");
    expect(groups[0]).toHaveProperty("loc");
    expect(groups[0]).toHaveProperty("importance");
    expect(groups[0]).toHaveProperty("coupling");
  });
});

describe("Tool 9: symbol_context", () => {
  it("returns callers, callees, metrics for a known symbol", async () => {
    const symbolName = [...graph.symbolMetrics.values()][0].name;
    const r = await callTool("symbol_context", { name: symbolName });
    expect(r).toHaveProperty("name", symbolName);
    expect(r).toHaveProperty("file");
    expect(r).toHaveProperty("type");
    expect(r).toHaveProperty("fanIn");
    expect(r).toHaveProperty("fanOut");
    expect(r).toHaveProperty("pageRank");
    expect(r).toHaveProperty("betweenness");
    expect(r).toHaveProperty("callers");
    expect(r).toHaveProperty("callees");
    expect(r).toHaveProperty("nextSteps");
  });

  it("returns error for unknown symbol", async () => {
    const result = await client.callTool({ name: "symbol_context", arguments: { name: "nonexistent_xyz_123" } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Symbol not found");
  });
});

describe("Tool 10: search", () => {
  it("returns ranked results for a valid query", async () => {
    const r = await callTool("search", { query: "auth" });
    expect(r).toHaveProperty("query", "auth");
    expect(r).toHaveProperty("results");
    expect(r).toHaveProperty("nextSteps");
    const results = r.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("file");
    expect(results[0]).toHaveProperty("score");
    expect(results[0]).toHaveProperty("symbols");
  });

  it("returns suggestions for no-match query", async () => {
    const r = await callTool("search", { query: "zzzznonexistent_xyz" });
    expect(r).toHaveProperty("results");
    expect((r.results as unknown[]).length).toBe(0);
    expect(r).toHaveProperty("suggestions");
  });
});

describe("Tool 11: detect_changes", () => {
  it("handles git not available gracefully", async () => {
    const r = await callTool("detect_changes");
    expect(r).toHaveProperty("scope");
  });
});

describe("Tool 12: impact_analysis", () => {
  it("returns depth-grouped impact for a known symbol", async () => {
    const r = await callTool("impact_analysis", { symbol: "UserService.getUserById" });
    expect(r).toHaveProperty("symbol");
    expect(r).toHaveProperty("levels");
    expect(r).toHaveProperty("totalAffected");
    expect(r).toHaveProperty("nextSteps");
  });

  it("returns isError for unknown symbol", async () => {
    const result = await client.callTool({
      name: "impact_analysis",
      arguments: { symbol: "nonexistent_xyz_123" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Symbol not found");
  });
});

describe("Tool 13: rename_symbol", () => {
  it("returns references for a dry-run rename", async () => {
    const r = await callTool("rename_symbol", { oldName: "getUserById", newName: "findUserById" });
    expect(r).toHaveProperty("dryRun", true);
    expect(r).toHaveProperty("references");
    expect(r).toHaveProperty("nextSteps");
  });
});

describe("Tool 14: get_processes", () => {
  it("returns execution flow traces", async () => {
    const r = await callTool("get_processes");
    expect(r).toHaveProperty("processes");
    expect(r).toHaveProperty("totalProcesses");
    expect(r).toHaveProperty("nextSteps");
    const procs = r.processes as unknown[];
    expect(procs.length).toBeGreaterThan(0);
  });

  it("filters by entry point", async () => {
    const allResult = await callTool("get_processes");
    const procs = allResult.processes as Array<{ name: string }>;
    if (procs.length === 0) return;

    const firstName = procs[0].name;
    const r = await callTool("get_processes", { entryPoint: firstName });
    const filtered = r.processes as unknown[];
    expect(filtered.length).toBeLessThanOrEqual(procs.length);
  });

  it("respects limit", async () => {
    const r = await callTool("get_processes", { limit: 1 });
    const procs = r.processes as unknown[];
    expect(procs.length).toBeLessThanOrEqual(1);
  });
});

describe("Tool 15: get_clusters", () => {
  it("returns community-detected clusters", async () => {
    const r = await callTool("get_clusters");
    expect(r).toHaveProperty("clusters");
    expect(r).toHaveProperty("totalClusters");
    expect(r).toHaveProperty("nextSteps");
    const clusters = r.clusters as Array<Record<string, unknown>>;
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]).toHaveProperty("id");
    expect(clusters[0]).toHaveProperty("name");
    expect(clusters[0]).toHaveProperty("files");
    expect(clusters[0]).toHaveProperty("cohesion");
  });

  it("filters by minFiles", async () => {
    const r = await callTool("get_clusters", { minFiles: 100 });
    const clusters = r.clusters as unknown[];
    expect(clusters.length).toBe(0);
  });
});

describe("MCP Prompts", () => {
  it("detect_impact prompt is registered", async () => {
    const prompts = await client.listPrompts();
    const names = prompts.prompts.map((p) => p.name);
    expect(names).toContain("detect_impact");
    expect(names).toContain("generate_map");
  });

  it("detect_impact returns prompt messages", async () => {
    const result = await client.getPrompt({ name: "detect_impact", arguments: { symbol: "getUserById" } });
    expect(result.messages.length).toBeGreaterThan(0);
    const text = result.messages[0].content as { type: string; text: string };
    expect(text.text).toContain("getUserById");
  });

  it("generate_map returns prompt messages", async () => {
    const result = await client.getPrompt({ name: "generate_map", arguments: {} });
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe("MCP Resources", () => {
  it("lists clusters, processes, and setup resources", async () => {
    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain("codebase://clusters");
    expect(uris).toContain("codebase://processes");
    expect(uris).toContain("codebase://setup");
  });

  it("reads clusters resource", async () => {
    const result = await client.readResource({ uri: "codebase://clusters" });
    const text = (result.contents[0] as { text: string }).text;
    const clusters = JSON.parse(text) as unknown[];
    expect(clusters.length).toBeGreaterThan(0);
  });

  it("reads processes resource", async () => {
    const result = await client.readResource({ uri: "codebase://processes" });
    const text = (result.contents[0] as { text: string }).text;
    const processes = JSON.parse(text) as unknown[];
    expect(processes.length).toBeGreaterThan(0);
  });

  it("reads setup resource with indexedHead", async () => {
    const result = await client.readResource({ uri: "codebase://setup" });
    const text = (result.contents[0] as { text: string }).text;
    const setup = JSON.parse(text) as Record<string, unknown>;
    expect(setup).toHaveProperty("project", "codebase-intelligence");
    expect(setup).toHaveProperty("indexedHead", "abc123-test");
    expect(setup).toHaveProperty("availableTools");
    expect((setup.availableTools as string[]).length).toBe(15);
  });
});
