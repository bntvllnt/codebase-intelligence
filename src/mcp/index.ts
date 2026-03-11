import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CodebaseGraph } from "../types/index.js";
import { getHints } from "./hints.js";
import { getIndexedHead } from "../server/graph-store.js";
import {
  computeOverview,
  computeFileContext,
  computeHotspots,
  computeSearch,
  computeChanges,
  computeDependents,
  computeModuleStructure,
  computeForces,
  computeDeadExports,
  computeGroups,
  computeSymbolContext,
  computeProcesses,
  computeClusters,
  impactAnalysis,
  renameSymbol,
} from "../core/index.js";

/** Register all MCP tools on a server instance. Shared by stdio and HTTP transports. */
export function registerTools(server: McpServer, graph: CodebaseGraph): void {
  // Tool 1: codebase_overview
  server.tool(
    "codebase_overview",
    "Get a high-level overview of the codebase: total files, modules, top-depended files, and key metrics. Use when: first exploring a codebase, 'what does this project look like'. Not for: module details (use get_module_structure) or data flow (use analyze_forces)",
    { depth: z.number().optional().describe("Module depth (default: 1)") },
    async (_params) => {
      const overview = {
        ...computeOverview(graph),
        nextSteps: getHints("codebase_overview"),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(overview, null, 2) }] };
    }
  );

  // Tool 2: file_context
  server.tool(
    "file_context",
    "Get detailed context for a specific file: exports, imports, dependents, and all metrics. Use when: 'tell me about this file', understanding a file before modifying it. Not for: symbol-level detail (use symbol_context)",
    { filePath: z.string().describe("Relative path to the file") },
    async ({ filePath: rawFilePath }) => {
      const result = computeFileContext(graph, rawFilePath);
      if ("error" in result) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }

      const context = { ...result, nextSteps: getHints("file_context") };
      return { content: [{ type: "text" as const, text: JSON.stringify(context, null, 2) }] };
    }
  );

  // Tool 3: get_dependents
  server.tool(
    "get_dependents",
    "Get all files that import a given file, with transitive dependents. File-level blast radius. Use when: 'what breaks if I change this file'. Not for: symbol-level impact (use impact_analysis)",
    {
      filePath: z.string().describe("Relative path to the file"),
      depth: z.number().optional().describe("Max traversal depth (default: 2)"),
    },
    async ({ filePath, depth }) => {
      const result = computeDependents(graph, filePath, depth);
      if ("error" in result) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...result, nextSteps: getHints("get_dependents") }, null, 2) }],
      };
    }
  );

  // Tool 4: find_hotspots
  server.tool(
    "find_hotspots",
    "Rank files by any metric: coupling, pagerank, fan_in, fan_out, betweenness, tension, escape_velocity, churn, complexity, blast_radius, coverage. Use when: 'what are the riskiest files', 'which files need tests', 'most complex files'. Not for: module-level analysis (use get_module_structure)",
    {
      metric: z
        .enum(["coupling", "pagerank", "fan_in", "fan_out", "betweenness", "tension", "escape_velocity", "churn", "complexity", "blast_radius", "coverage"])
        .describe("Metric to rank by"),
      limit: z.number().optional().describe("Number of results (default: 10)"),
    },
    async ({ metric, limit }) => {
      const result = {
        ...computeHotspots(graph, metric, limit),
        nextSteps: getHints("find_hotspots"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 5: get_module_structure
  server.tool(
    "get_module_structure",
    "Get module/directory structure with cross-module dependencies, cohesion scores, and circular deps. Use when: 'how are modules organized', 'what depends on what module'. Not for: emergent clusters (use get_clusters) or file-level metrics (use find_hotspots)",
    { depth: z.number().optional().describe("Module depth (default: 2)") },
    async (_params) => {
      const result = {
        ...computeModuleStructure(graph),
        nextSteps: getHints("get_module_structure"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 6: analyze_forces
  server.tool(
    "analyze_forces",
    "Analyze module health: find misplaced files (tension), bridge files connecting otherwise-disconnected modules, and extraction candidates. Use when: 'what is architecturally wrong', 'which modules are coupled', 'what files should be moved'. Not for: file-level metrics (use find_hotspots)",
    {
      cohesionThreshold: z.number().optional().describe("Min cohesion to be 'COHESIVE' (default: 0.6)"),
      tensionThreshold: z.number().optional().describe("Min tension to flag (default: 0.3)"),
      escapeThreshold: z.number().optional().describe("Min escape velocity to flag (default: 0.5)"),
    },
    async ({ cohesionThreshold, tensionThreshold, escapeThreshold }) => {
      const result = {
        ...computeForces(graph, cohesionThreshold, tensionThreshold, escapeThreshold),
        nextSteps: getHints("analyze_forces"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 7: find_dead_exports
  server.tool(
    "find_dead_exports",
    "Find unused exports across the codebase — exports that no other file imports. Use when: cleaning up dead code, reducing API surface. Not for: finding used exports (use file_context)",
    {
      module: z.string().optional().describe("Filter by module path (default: all modules)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ module, limit }) => {
      const result = {
        ...computeDeadExports(graph, module, limit),
        nextSteps: getHints("find_dead_exports"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 8: get_groups
  server.tool(
    "get_groups",
    "Get top-level directory groups with aggregate metrics: files, LOC, importance (PageRank), coupling. Use when: 'what are the main areas of this codebase', high-level grouping overview. Not for: detailed module metrics (use get_module_structure)",
    {},
    async () => {
      const computed = computeGroups(graph);
      if (computed.groups.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ message: "No groups found.", nextSteps: getHints("get_groups") }) }] };
      }
      const result = { ...computed, nextSteps: getHints("get_groups") };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 9: symbol_context
  server.tool(
    "symbol_context",
    "Find all callers and callees of a function, class, or method with importance metrics. Use when: 'who calls X', 'trace this function', 'what depends on this symbol'. Not for: text search (use search) or file-level dependencies (use get_dependents)",
    { name: z.string().describe("Symbol name (e.g., 'AuthService', 'getUserById')") },
    async ({ name: symbolName }) => {
      const result = computeSymbolContext(graph, symbolName);
      if ("error" in result) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...result, nextSteps: getHints("symbol_context") }, null, 2) }],
      };
    }
  );

  // Tool 10: search
  server.tool(
    "search",
    "Search files and symbols by keyword. Returns ranked results with symbol locations. Use when: 'find files related to auth', 'where is getUserById defined'. Not for: structured call graph queries (use symbol_context)",
    {
      query: z.string().describe("Search query (supports camelCase, snake_case splitting)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ query, limit }) => {
      const result = {
        ...computeSearch(graph, query, limit),
        nextSteps: getHints("search"),
      };
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // Tool 11: detect_changes
  server.tool(
    "detect_changes",
    "Detect changed files from git diff with risk metrics per file. Use when: starting a review, triaging changes, 'what changed'. Not for: symbol-level impact (use impact_analysis)",
    {
      scope: z.enum(["staged", "unstaged", "all"]).optional().describe("Git diff scope (default: all)"),
    },
    async ({ scope }) => {
      const result = computeChanges(graph, scope);
      if ("error" in result) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              ...result,
              nextSteps: ["Ensure you are in a git repository"],
            }),
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...result,
            nextSteps: getHints("detect_changes"),
          }, null, 2),
        }],
      };
    }
  );

  // Tool 12: impact_analysis
  server.tool(
    "impact_analysis",
    "Analyze blast radius of changing a specific function or class. Symbol-level, depth-grouped, with risk labels (WILL BREAK / LIKELY / MAY NEED TESTING). Use when: 'what breaks if I change getUserById'. Not for: file-level dependencies (use get_dependents)",
    {
      symbol: z.string().describe("Symbol name or qualified name (e.g., 'getUserById' or 'UserService.getUserById')"),
    },
    async ({ symbol }) => {
      const result = impactAnalysis(graph, symbol);
      if (result.notFound) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Symbol not found: ${symbol}` }) }],
          isError: true,
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...result, nextSteps: getHints("impact_analysis") }, null, 2),
        }],
      };
    }
  );

  // Tool 13: rename_symbol
  server.tool(
    "rename_symbol",
    "Read-only: find all reference locations for a symbol across the codebase, with confidence levels. Does not modify files. Use when: planning a rename, finding all usages. Not for: call graph analysis (use symbol_context)",
    {
      oldName: z.string().describe("Current symbol name"),
      newName: z.string().describe("New symbol name"),
      dryRun: z.boolean().optional().describe("If true, only report references without renaming (default: true)"),
    },
    async ({ oldName, newName, dryRun }) => {
      const result = renameSymbol(graph, oldName, newName, dryRun ?? true);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...result, nextSteps: getHints("rename_symbol") }, null, 2),
        }],
      };
    }
  );

  // Tool 14: get_processes
  server.tool(
    "get_processes",
    "Trace execution flows from entry points through the call graph. Returns step-by-step paths showing how requests flow through the codebase. Use when: 'how does this app start', 'trace request flow', 'what are the entry points'. Not for: static file dependencies (use get_dependents)",
    {
      entryPoint: z.string().optional().describe("Filter by entry point symbol name"),
      limit: z.number().optional().describe("Max processes to return (default: all)"),
    },
    async ({ entryPoint, limit }) => {
      const result = {
        ...computeProcesses(graph, entryPoint, limit),
        nextSteps: getHints("get_processes"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 15: get_clusters
  server.tool(
    "get_clusters",
    "Get community-detected clusters of related files using Louvain algorithm. Discovers emergent groupings that may differ from directory structure. Use when: 'what files are related', 'find natural groupings', 'which files change together'. Not for: directory-based modules (use get_module_structure)",
    {
      minFiles: z.number().optional().describe("Filter clusters with at least N files (default: 0)"),
    },
    async ({ minFiles }) => {
      const result = {
        ...computeClusters(graph, minFiles),
        nextSteps: getHints("get_clusters"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

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
        availableTools: [
          "codebase_overview", "file_context", "get_dependents", "find_hotspots",
          "get_module_structure", "analyze_forces", "find_dead_exports", "get_groups",
          "symbol_context", "search", "detect_changes", "impact_analysis", "rename_symbol",
          "get_processes", "get_clusters",
        ],
        indexedHead,
        gettingStarted: [
          "Call codebase_overview for a high-level map",
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
}

export async function startMcpServer(graph: CodebaseGraph): Promise<void> {
  const server = new McpServer({
    name: "codebase-intelligence",
    version: "0.1.0",
  });

  registerTools(server, graph);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
