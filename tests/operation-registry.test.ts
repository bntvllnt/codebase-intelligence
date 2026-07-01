import { describe, expect, it } from "vitest";
import { computeOverview } from "../src/core/index.js";
import { getHints, getHintsForOperation } from "../src/mcp/hints.js";
import { extraMcpTools } from "../src/mcp/index.js";
import {
  getOperation,
  getOperationByCliCommand,
  getOperationByMcpTool,
  operationList,
  operationNames,
  operations,
  parseOperationInput,
  runOperation,
  type OperationName,
} from "../src/operations/index.js";
import { createFixtureMcp } from "./helpers/mcp.js";
import { getFixturePipeline } from "./helpers/pipeline.js";

const expectedOperations: Array<{
  name: OperationName;
  cliCommand: string;
  mcpTool: string;
  inputKeys: string[];
  sampleInput: Record<string, unknown>;
}> = [
  { name: "overview", cliCommand: "overview", mcpTool: "codebase_overview", inputKeys: ["depth"], sampleInput: {} },
  { name: "fileContext", cliCommand: "file", mcpTool: "file_context", inputKeys: ["filePath"], sampleInput: { filePath: "index.ts" } },
  { name: "dependents", cliCommand: "dependents", mcpTool: "get_dependents", inputKeys: ["filePath", "depth"], sampleInput: { filePath: "index.ts", depth: 2 } },
  { name: "hotspots", cliCommand: "hotspots", mcpTool: "find_hotspots", inputKeys: ["metric", "limit"], sampleInput: { metric: "coupling", limit: 3 } },
  { name: "moduleStructure", cliCommand: "modules", mcpTool: "get_module_structure", inputKeys: ["depth"], sampleInput: {} },
  { name: "forces", cliCommand: "forces", mcpTool: "analyze_forces", inputKeys: ["cohesionThreshold", "tensionThreshold", "escapeThreshold"], sampleInput: { cohesionThreshold: 0.6 } },
  { name: "deadExports", cliCommand: "dead-exports", mcpTool: "find_dead_exports", inputKeys: ["module", "limit"], sampleInput: { limit: 5 } },
  { name: "opportunities", cliCommand: "opportunities", mcpTool: "find_opportunities", inputKeys: ["limit"], sampleInput: { limit: 5 } },
  { name: "duplication", cliCommand: "duplicates", mcpTool: "find_duplicates", inputKeys: ["mode", "minTokens", "skipLocal", "trace"], sampleInput: { mode: "mild", minTokens: 30, skipLocal: true } },
  { name: "groups", cliCommand: "groups", mcpTool: "get_groups", inputKeys: [], sampleInput: {} },
  { name: "symbolContext", cliCommand: "symbol", mcpTool: "symbol_context", inputKeys: ["name"], sampleInput: { name: "getUserById" } },
  { name: "search", cliCommand: "search", mcpTool: "search", inputKeys: ["query", "limit"], sampleInput: { query: "auth", limit: 5 } },
  { name: "changes", cliCommand: "changes", mcpTool: "detect_changes", inputKeys: ["scope"], sampleInput: { scope: "all" } },
  { name: "impact", cliCommand: "impact", mcpTool: "impact_analysis", inputKeys: ["symbol"], sampleInput: { symbol: "getUserById" } },
  { name: "rename", cliCommand: "rename", mcpTool: "rename_symbol", inputKeys: ["oldName", "newName", "dryRun"], sampleInput: { oldName: "getUserById", newName: "findUserById" } },
  { name: "processes", cliCommand: "processes", mcpTool: "get_processes", inputKeys: ["entryPoint", "limit"], sampleInput: { entryPoint: "main" } },
  { name: "codebaseMap", cliCommand: "map", mcpTool: "get_codebase_map", inputKeys: ["focus", "scope", "depth", "format", "contextBudget"], sampleInput: { focus: "getUserById", depth: 1, contextBudget: 420 } },
  { name: "contentDrift", cliCommand: "drift", mcpTool: "detect_content_drift", inputKeys: ["focus", "scope", "minScore"], sampleInput: { scope: "users", minScore: 35 } },
  { name: "health", cliCommand: "health", mcpTool: "get_health_score", inputKeys: ["minScore", "score"], sampleInput: { minScore: 0, score: true } },
  { name: "highways", cliCommand: "highways", mcpTool: "analyze_highways", inputKeys: ["operation", "shape", "minRoutes", "propose", "trace"], sampleInput: { operation: "create", minRoutes: 2 } },
  { name: "clusters", cliCommand: "clusters", mcpTool: "get_clusters", inputKeys: ["minFiles"], sampleInput: { minFiles: 2 } },
];

describe("operation registry", () => {
  it("declares every analysis operation with unique CLI and MCP surfaces", () => {
    expect(operationNames).toEqual(expectedOperations.map((operation) => operation.name));
    expect(operationList).toHaveLength(expectedOperations.length);
    expect(new Set(operationList.map((operation) => operation.name)).size).toBe(operationList.length);
    expect(new Set(operationList.map((operation) => operation.cliCommand)).size).toBe(operationList.length);
    expect(new Set(operationList.map((operation) => operation.mcpTool)).size).toBe(operationList.length);

    for (const expected of expectedOperations) {
      const operation = getOperation(expected.name);
      expect(operation.cliCommand).toBe(expected.cliCommand);
      expect(operation.mcpTool).toBe(expected.mcpTool);
      expect(Object.keys(operation.inputShape)).toEqual(expected.inputKeys);
      expect(operation.inputSchema.safeParse(expected.sampleInput).success).toBe(true);
      expect(typeof operation.formatText).toBe("function");
      expect(getOperationByCliCommand(expected.cliCommand)).toBe(operation);
      expect(getOperationByMcpTool(expected.mcpTool)).toBe(operation);
    }
  });

  it("runs operation descriptors against the shared graph", () => {
    const { codebaseGraph } = getFixturePipeline();
    const result = runOperation(operations.overview, codebaseGraph, {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(computeOverview(codebaseGraph));
      expect(operations.overview.formatText(result.data)).toContain("Codebase Overview");
    }
  });

  it("wraps shared operation errors without losing the original payload", () => {
    const { codebaseGraph } = getFixturePipeline();
    const result = runOperation(operations.fileContext, codebaseGraph, { filePath: "missing.ts" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("File not found");
      expect(result.data).toHaveProperty("suggestions");
    }
  });

  it("normalizes schema validation failures for adapter reuse", () => {
    const result = parseOperationInput(operations.hotspots, { metric: "not-a-metric" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid enum value");
    }
  });

  it("types next-step hints by operation name and preserves MCP tool lookup", () => {
    expect(getHintsForOperation("overview")).toEqual(getHints("codebase_overview"));
    expect(getHints("unknown_tool")).toEqual([]);
  });

  it("registers MCP tools from the operation registry plus check", async () => {
    const mcp = await createFixtureMcp();
    expect(await mcp.listTools()).toEqual([...operationList.map((operation) => operation.mcpTool), ...extraMcpTools, "check"]);
  });

  it("keeps MCP operation input fields discoverable while registry validation owns errors", async () => {
    const mcp = await createFixtureMcp();
    const tools = await mcp.listToolMetadata();
    const hotspots = tools.find((tool) => tool.name === "find_hotspots");

    expect(hotspots?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        metric: {
          enum: expect.arrayContaining(["coupling", "blast_radius", "risk"]),
        },
        limit: {
          type: "integer",
        },
      },
    });
  });

  it("keeps registry-adapted MCP lookup errors in the existing envelope", async () => {
    const mcp = await createFixtureMcp();
    const result = await mcp.callToolWithMeta("impact_analysis", { symbol: "MissingSymbol" });

    expect(result.isError).toBe(true);
    expect(result.payload).toEqual({ error: "Symbol not found: MissingSymbol" });
  });
});
