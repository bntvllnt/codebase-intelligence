import { describe, expect, it } from "vitest";
import { computeOverview } from "../src/core/index.js";
import { getHints, getHintsForOperation } from "../src/mcp/hints.js";
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
import { getFixturePipeline } from "./helpers/pipeline.js";

const expectedOperations: Array<{
  name: OperationName;
  cliCommand: string;
  mcpTool: string;
  sampleInput: Record<string, unknown>;
}> = [
  { name: "overview", cliCommand: "overview", mcpTool: "codebase_overview", sampleInput: {} },
  { name: "fileContext", cliCommand: "file", mcpTool: "file_context", sampleInput: { filePath: "index.ts" } },
  { name: "dependents", cliCommand: "dependents", mcpTool: "get_dependents", sampleInput: { filePath: "index.ts", depth: 2 } },
  { name: "hotspots", cliCommand: "hotspots", mcpTool: "find_hotspots", sampleInput: { metric: "coupling", limit: 3 } },
  { name: "moduleStructure", cliCommand: "modules", mcpTool: "get_module_structure", sampleInput: {} },
  { name: "forces", cliCommand: "forces", mcpTool: "analyze_forces", sampleInput: { cohesionThreshold: 0.6 } },
  { name: "deadExports", cliCommand: "dead-exports", mcpTool: "find_dead_exports", sampleInput: { limit: 5 } },
  { name: "opportunities", cliCommand: "opportunities", mcpTool: "find_opportunities", sampleInput: { limit: 5 } },
  { name: "groups", cliCommand: "groups", mcpTool: "get_groups", sampleInput: {} },
  { name: "symbolContext", cliCommand: "symbol", mcpTool: "symbol_context", sampleInput: { name: "getUserById" } },
  { name: "search", cliCommand: "search", mcpTool: "search", sampleInput: { query: "auth", limit: 5 } },
  { name: "changes", cliCommand: "changes", mcpTool: "detect_changes", sampleInput: { scope: "all" } },
  { name: "impact", cliCommand: "impact", mcpTool: "impact_analysis", sampleInput: { symbol: "getUserById" } },
  { name: "rename", cliCommand: "rename", mcpTool: "rename_symbol", sampleInput: { oldName: "getUserById", newName: "findUserById" } },
  { name: "processes", cliCommand: "processes", mcpTool: "get_processes", sampleInput: { entryPoint: "main" } },
  { name: "clusters", cliCommand: "clusters", mcpTool: "get_clusters", sampleInput: { minFiles: 2 } },
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
      expect(operation.inputSchema.safeParse(expected.sampleInput).success).toBe(true);
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
});
