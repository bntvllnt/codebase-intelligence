import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CodebaseGraph } from "../types/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
import { getHintsForOperation } from "./hints.js";
import { getIndexedHead, getRoot } from "../server/graph-store.js";
import { runCheck } from "../rules/check.js";
import { formatJson } from "../rules/format.js";
import {
  operationList,
  operations,
  parseOperationInput,
  runOperation,
  type Operation,
} from "../operations/index.js";

interface OperationToolOptions<TResult> {
  successPayload?: (data: TResult) => unknown;
  errorNextSteps?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonToolResult(payload: unknown, isError = false): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, isError ? undefined : 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

function withNextSteps<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  payload: unknown,
): unknown {
  if (!isRecord(payload)) return payload;
  return { ...payload, nextSteps: getHintsForOperation(operation.name) };
}

function errorPayload(
  result: { ok: false; error: string; data?: unknown },
  nextSteps?: string[],
): Record<string, unknown> {
  const payload = isRecord(result.data) && typeof result.data.error === "string"
    ? result.data
    : { error: result.error };
  return nextSteps ? { ...payload, nextSteps } : payload;
}

function mcpInputSchema<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
): z.ZodType<Record<string, unknown>> {
  const shape: z.ZodRawShape = {};
  for (const [key, schema] of Object.entries(operation.inputShape)) {
    shape[key] = schema.catch((context: { input: unknown }) => context.input);
  }
  return z.object(shape).passthrough();
}

function registerOperationTool<TInput extends object, TResult>(
  server: McpServer,
  graph: CodebaseGraph,
  operation: Operation<TInput, TResult>,
  options: OperationToolOptions<TResult> = {},
): void {
  server.registerTool(
    operation.mcpTool,
    {
      description: operation.description,
      inputSchema: mcpInputSchema(operation),
    },
    async (rawInput) => {
      const parsed = parseOperationInput(operation, rawInput);
      if (!parsed.ok) {
        return jsonToolResult({ error: parsed.error }, true);
      }

      const result = runOperation(operation, graph, parsed.data, { rootDir: getRoot() });
      if (!result.ok) {
        return jsonToolResult(errorPayload(result, options.errorNextSteps), true);
      }

      const payload = options.successPayload ? options.successPayload(result.data) : result.data;
      return jsonToolResult(withNextSteps(operation, payload));
    },
  );
}

/** Register all MCP tools on a server instance. Shared by stdio and HTTP transports. */
export function registerTools(server: McpServer, graph: CodebaseGraph): void {
  registerOperationTool(server, graph, operations.overview);
  registerOperationTool(server, graph, operations.fileContext);
  registerOperationTool(server, graph, operations.dependents);
  registerOperationTool(server, graph, operations.hotspots);
  registerOperationTool(server, graph, operations.moduleStructure);
  registerOperationTool(server, graph, operations.forces);
  registerOperationTool(server, graph, operations.deadExports);
  registerOperationTool(server, graph, operations.opportunities);
  registerOperationTool(server, graph, operations.duplication);
  registerOperationTool(server, graph, operations.groups, {
    successPayload: (computed) => computed.groups.length === 0 ? { message: "No groups found." } : computed,
  });
  registerOperationTool(server, graph, operations.symbolContext);
  registerOperationTool(server, graph, operations.search);
  registerOperationTool(server, graph, operations.changes, {
    errorNextSteps: ["Ensure you are in a git repository"],
  });
  registerOperationTool(server, graph, operations.impact);
  registerOperationTool(server, graph, operations.rename);
  registerOperationTool(server, graph, operations.processes);
  registerOperationTool(server, graph, operations.clusters);

  // MCP Prompts
  server.prompt(
    "detect_impact",
    "Analyze the impact of changing a symbol — who calls it, what breaks, what needs testing",
    { symbol: z.string().describe("Symbol to analyze") },
    ({ symbol }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analyze the impact of changing the symbol "${symbol}" in this codebase.\n\nUse the impact_analysis tool with symbol="${symbol}" to get depth-grouped affected callers.\nThen use file_context on the most impacted files to understand coupling.\nFinally, summarize:\n1. What will definitely break (depth 1)\n2. What will likely need changes (depth 2)\n3. What may need testing (depth 3+)\n4. Recommended order to update files`,
        },
      }],
    })
  );

  server.prompt(
    "generate_map",
    "Generate a mental map of the codebase structure for onboarding",
    {},
    () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: "Generate a visual mental map of this codebase.\n\nUse codebase_overview to get the high-level structure.\nThen use get_module_structure to understand cross-module dependencies.\nUse find_hotspots with metric='pagerank' to identify key files.\nFinally, produce an ASCII diagram showing:\n1. Module boundaries and their responsibilities\n2. Key data flows between modules\n3. Critical hotspot files marked with [!]\n4. Entry points marked with [>>]",
        },
      }],
    })
  );

  // MCP Resources
  server.resource(
    "clusters",
    "codebase://clusters",
    { description: "Community-detected clusters of related files" },
    async () => ({
      contents: [{
        uri: "codebase://clusters",
        text: JSON.stringify(graph.clusters, null, 2),
        mimeType: "application/json",
      }],
    })
  );

  server.resource(
    "processes",
    "codebase://processes",
    { description: "Execution flow traces from entry points through call graph" },
    async () => ({
      contents: [{
        uri: "codebase://processes",
        text: JSON.stringify(graph.processes, null, 2),
        mimeType: "application/json",
      }],
    })
  );

  server.resource(
    "setup",
    "codebase://setup",
    { description: "Onboarding guide for AI agents connecting to this codebase" },
    async () => {
      const indexedHead = getIndexedHead();
      const setup = {
        project: "codebase-intelligence",
        totalFiles: graph.stats.totalFiles,
        totalFunctions: graph.stats.totalFunctions,
        modules: [...graph.moduleMetrics.keys()],
        availableTools: [...operationList.map((operation) => operation.mcpTool), "check"],
        indexedHead,
        gettingStarted: [
          "Call codebase_overview for a high-level map",
          "Use find_opportunities for a ranked improvement plan",
          "Use search to find specific files or symbols",
          "Use symbol_context to understand function call chains",
          "Use detect_changes to see what's changed since last index",
        ],
      };
      return {
        contents: [{
          uri: "codebase://setup",
          text: JSON.stringify(setup, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // Tool: check — run the configurable rules engine and gate
  server.tool(
    "check",
    "Run the configured rules engine and return findings with a pass/warn/fail verdict (rules + severities come from codebase-intelligence.json). Use when: linting a codebase or enforcing CI gates. Not for: architecture metrics (use analyze_forces)",
    {},
    async () => {
      try {
        const result = runCheck(graph, getRoot());
        return { content: [{ type: "text" as const, text: formatJson(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );
}

export async function startMcpServer(graph: CodebaseGraph): Promise<void> {
  const server = new McpServer({
    name: "codebase-intelligence",
    version: pkg.version,
  });

  registerTools(server, graph);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
