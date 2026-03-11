import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import type { CodebaseGraph } from "../types/index.js";
import { getHints } from "./hints.js";
import { createSearchIndex, search, getSuggestions } from "../search/index.js";
import type { SearchIndex } from "../search/index.js";
import { getIndexedHead } from "../server/graph-store.js";
import { impactAnalysis, renameSymbol } from "../impact/index.js";

let cachedSearchIndex: SearchIndex | undefined;

function getSearchIndex(graph: CodebaseGraph): SearchIndex {
  cachedSearchIndex ??= createSearchIndex(graph);
  return cachedSearchIndex;
}

/** Register all MCP tools on a server instance. Shared by stdio and HTTP transports. */
export function registerTools(server: McpServer, graph: CodebaseGraph): void {
  // Tool 1: codebase_overview
  server.tool(
    "codebase_overview",
    "Get a high-level overview of the codebase: total files, modules, top-depended files, and key metrics. Use when: first exploring a codebase, 'what does this project look like'. Not for: module details (use get_module_structure) or data flow (use analyze_forces)",
    { depth: z.number().optional().describe("Module depth (default: 1)") },
    async (_params) => {
      const modules = [...graph.moduleMetrics.values()].map((m) => ({
        path: m.path,
        files: m.files,
        loc: m.loc,
        avgCoupling: m.cohesion < 0.4 ? "HIGH" : m.cohesion < 0.7 ? "MEDIUM" : "LOW",
        cohesion: m.cohesion,
      }));

      const topDepended = [...graph.fileMetrics.entries()]
        .sort(([, a], [, b]) => b.fanIn - a.fanIn)
        .slice(0, 5)
        .map(([path, m]) => `${path} (${m.fanIn} dependents)`);

      const maxDepth = Math.max(
        ...graph.nodes
          .filter((n) => n.type === "file")
          .map((n) => n.path.split("/").length)
      );

      const overview = {
        totalFiles: graph.stats.totalFiles,
        totalFunctions: graph.stats.totalFunctions,
        totalDependencies: graph.stats.totalDependencies,
        modules: modules.sort((a, b) => b.files - a.files),
        topDependedFiles: topDepended,
        metrics: {
          avgLOC: Math.round(
            graph.nodes.filter((n) => n.type === "file").reduce((sum, n) => sum + n.loc, 0) /
              graph.stats.totalFiles
          ),
          maxDepth,
          circularDeps: graph.stats.circularDeps.length,
        },
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
    async ({ filePath }) => {
      const metrics = graph.fileMetrics.get(filePath);
      if (!metrics) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `File not found in graph: ${filePath}` }) }],
          isError: true,
        };
      }

      const node = graph.nodes.find((n) => n.id === filePath && n.type === "file");
      const fileExports = graph.nodes
        .filter((n) => n.parentFile === filePath)
        .map((n) => ({ name: n.label, type: n.type, loc: n.loc }));

      const imports = graph.edges
        .filter((e) => e.source === filePath)
        .map((e) => ({ from: e.target, symbols: e.symbols, isTypeOnly: e.isTypeOnly, weight: e.weight }));

      const dependents = graph.edges
        .filter((e) => e.target === filePath)
        .map((e) => ({ path: e.source, symbols: e.symbols, isTypeOnly: e.isTypeOnly, weight: e.weight }));

      const context = {
        path: filePath,
        loc: node?.loc ?? 0,
        exports: fileExports,
        imports,
        dependents,
        metrics: {
          pageRank: Math.round(metrics.pageRank * 1000) / 1000,
          betweenness: Math.round(metrics.betweenness * 100) / 100,
          fanIn: metrics.fanIn,
          fanOut: metrics.fanOut,
          coupling: Math.round(metrics.coupling * 100) / 100,
          tension: metrics.tension,
          isBridge: metrics.isBridge,
          churn: metrics.churn,
          cyclomaticComplexity: metrics.cyclomaticComplexity,
          blastRadius: metrics.blastRadius,
          deadExports: metrics.deadExports,
          hasTests: metrics.hasTests,
          testFile: metrics.testFile,
        },
        nextSteps: getHints("file_context"),
      };

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
      if (!graph.fileMetrics.has(filePath)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `File not found in graph: ${filePath}` }) }],
          isError: true,
        };
      }

      const maxDepth = depth ?? 2;
      const directDependents = graph.edges
        .filter((e) => e.target === filePath)
        .map((e) => ({ path: e.source, symbols: e.symbols }));

      const transitive: Array<{ path: string; throughPath: string[]; depth: number }> = [];
      const visited = new Set<string>([filePath]);

      function bfs(current: string[], currentDepth: number, pathSoFar: string[]): void {
        if (currentDepth > maxDepth) return;
        const next: string[] = [];

        for (const node of current) {
          const deps = graph.edges.filter((e) => e.target === node).map((e) => e.source);
          for (const dep of deps) {
            if (visited.has(dep)) continue;
            visited.add(dep);
            if (currentDepth > 1) {
              transitive.push({ path: dep, throughPath: [...pathSoFar, node], depth: currentDepth });
            }
            next.push(dep);
          }
        }

        if (next.length > 0) bfs(next, currentDepth + 1, [...pathSoFar, ...current]);
      }

      bfs([filePath], 1, []);

      const totalAffected = visited.size - 1;
      const riskLevel = totalAffected > 20 ? "HIGH" : totalAffected > 5 ? "MEDIUM" : "LOW";

      const result = {
        file: filePath,
        directDependents,
        transitiveDependents: transitive,
        totalAffected,
        riskLevel,
        nextSteps: getHints("get_dependents"),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
      const maxResults = limit ?? 10;

      type ScoredFile = { path: string; score: number; reason: string };
      const scored: ScoredFile[] = [];

      if (metric === "escape_velocity") {
        for (const mod of graph.moduleMetrics.values()) {
          scored.push({
            path: mod.path,
            score: mod.escapeVelocity,
            reason: `${mod.dependedBy.length} modules depend on it, ${mod.externalDeps} external deps`,
          });
        }
      } else {
        const filterTestFiles = metric === "coverage" || metric === "coupling";
        for (const [filePath, metrics] of graph.fileMetrics) {
          if (filterTestFiles && metrics.isTestFile) continue;

          let score: number;
          let reason: string;

          switch (metric) {
            case "coupling":
              score = metrics.coupling;
              reason = `fan-in: ${metrics.fanIn}, fan-out: ${metrics.fanOut}`;
              break;
            case "pagerank":
              score = metrics.pageRank;
              reason = `${metrics.fanIn} dependents`;
              break;
            case "fan_in":
              score = metrics.fanIn;
              reason = `${metrics.fanIn} files import this`;
              break;
            case "fan_out":
              score = metrics.fanOut;
              reason = `imports ${metrics.fanOut} files`;
              break;
            case "betweenness":
              score = metrics.betweenness;
              reason = metrics.isBridge ? "bridge between clusters" : "on many shortest paths";
              break;
            case "tension":
              score = metrics.tension;
              reason = score > 0 ? "pulled by multiple modules" : "no tension";
              break;
            case "churn":
              score = metrics.churn;
              reason = `${metrics.churn} commits touching this file`;
              break;
            case "complexity":
              score = metrics.cyclomaticComplexity;
              reason = `avg cyclomatic complexity: ${metrics.cyclomaticComplexity.toFixed(1)}`;
              break;
            case "blast_radius":
              score = metrics.blastRadius;
              reason = `${metrics.blastRadius} transitive dependents affected if changed`;
              break;
            case "coverage":
              score = metrics.hasTests ? 0 : 1;
              reason = metrics.hasTests ? `tested (${metrics.testFile})` : "no test file found";
              break;
            default:
              score = 0;
              reason = "";
          }

          scored.push({ path: filePath, score, reason });
        }
      }

      const hotspots = scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
      const topIssue = hotspots[0];
      const summary =
        hotspots.length > 0
          ? `Top ${metric} hotspot: ${topIssue.path} (${topIssue.score.toFixed(2)}). ${topIssue.reason}.`
          : `No significant ${metric} hotspots found.`;

      const result = { metric, hotspots, summary, nextSteps: getHints("find_hotspots") };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Tool 5: get_module_structure
  server.tool(
    "get_module_structure",
    "Get module/directory structure with cross-module dependencies, cohesion scores, and circular deps. Use when: 'how are modules organized', 'what depends on what module'. Not for: emergent clusters (use get_clusters) or file-level metrics (use find_hotspots)",
    { depth: z.number().optional().describe("Module depth (default: 2)") },
    async (_params) => {
      const modules = [...graph.moduleMetrics.values()].map((m) => ({
        path: m.path,
        files: m.files,
        loc: m.loc,
        exports: m.exports,
        internalDeps: m.internalDeps,
        externalDeps: m.externalDeps,
        cohesion: m.cohesion,
        escapeVelocity: m.escapeVelocity,
        dependsOn: m.dependsOn,
        dependedBy: m.dependedBy,
      }));

      const crossModuleDeps: Array<{ from: string; to: string; weight: number }> = [];
      const crossMap = new Map<string, number>();

      for (const edge of graph.edges) {
        const sourceNode = graph.nodes.find((n) => n.id === edge.source);
        const targetNode = graph.nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;
        if (sourceNode.module === targetNode.module) continue;

        const key = `${sourceNode.module}->${targetNode.module}`;
        crossMap.set(key, (crossMap.get(key) ?? 0) + 1);
      }

      for (const [key, weight] of crossMap) {
        const [from, to] = key.split("->");
        crossModuleDeps.push({ from, to, weight });
      }

      const result = {
        modules: modules.sort((a, b) => b.files - a.files),
        crossModuleDeps: crossModuleDeps.sort((a, b) => b.weight - a.weight),
        circularDeps: graph.stats.circularDeps.map((cycle) => ({
          cycle,
          severity: cycle.length > 3 ? "HIGH" : "LOW",
        })),
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
      const cohesionMin = cohesionThreshold ?? 0.6;
      const tensionMin = tensionThreshold ?? 0.3;
      const escapeMin = escapeThreshold ?? 0.5;

      type CohesionVerdict = "COHESIVE" | "MODERATE" | "JUNK_DRAWER";
      const moduleCohesion = graph.forceAnalysis.moduleCohesion.map((m) => {
        const verdict: CohesionVerdict = m.cohesion >= cohesionMin ? "COHESIVE" : m.cohesion >= cohesionMin * 0.67 ? "MODERATE" : "JUNK_DRAWER";
        return { ...m, verdict };
      });

      const tensionFiles = graph.forceAnalysis.tensionFiles.filter((t) => t.tension > tensionMin);
      const extractionCandidates = graph.forceAnalysis.extractionCandidates.filter((e) => e.escapeVelocity >= escapeMin);

      const result = {
        moduleCohesion,
        tensionFiles,
        bridgeFiles: graph.forceAnalysis.bridgeFiles,
        extractionCandidates,
        summary: graph.forceAnalysis.summary,
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
      const maxResults = limit ?? 20;
      const deadFiles: Array<{ path: string; module: string; deadExports: string[]; totalExports: number }> = [];

      for (const [filePath, metrics] of graph.fileMetrics) {
        if (metrics.deadExports.length === 0) continue;
        const node = graph.nodes.find((n) => n.id === filePath);
        if (!node) continue;
        if (module && node.module !== module) continue;

        const totalExports = graph.nodes.filter((n) => n.parentFile === filePath).length;
        deadFiles.push({
          path: filePath,
          module: node.module,
          deadExports: metrics.deadExports,
          totalExports,
        });
      }

      const sorted = deadFiles
        .sort((a, b) => b.deadExports.length - a.deadExports.length)
        .slice(0, maxResults);

      const totalDead = sorted.reduce((sum, f) => sum + f.deadExports.length, 0);
      const result = {
        totalDeadExports: totalDead,
        files: sorted,
        summary: totalDead > 0
          ? `${totalDead} unused exports across ${sorted.length} files. Consider removing to reduce API surface.`
          : "No dead exports found.",
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
      const groups = graph.groups;

      if (groups.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ message: "No groups found.", nextSteps: getHints("get_groups") }) }] };
      }

      const result = {
        groups: groups.map((g, i) => ({
          rank: i + 1,
          name: g.name.toUpperCase(),
          files: g.files,
          loc: g.loc,
          importance: `${(g.importance * 100).toFixed(1)}%`,
          coupling: { total: g.fanIn + g.fanOut, fanIn: g.fanIn, fanOut: g.fanOut },
        })),
        nextSteps: getHints("get_groups"),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 9: symbol_context
  server.tool(
    "symbol_context",
    "Find all callers and callees of a function, class, or method with importance metrics. Use when: 'who calls X', 'trace this function', 'what depends on this symbol'. Not for: text search (use search) or file-level dependencies (use get_dependents)",
    { name: z.string().describe("Symbol name (e.g., 'AuthService', 'getUserById')") },
    async ({ name: symbolName }) => {
      const matches = [...graph.symbolMetrics.values()].filter(
        (m) => m.name === symbolName || m.symbolId.endsWith(`::${symbolName}`)
      );

      if (matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Symbol not found: ${symbolName}` }) }],
          isError: true,
        };
      }

      const sym = matches[0];
      const symNode = graph.symbolNodes.find((n) => n.id === sym.symbolId);
      const callers = graph.callEdges
        .filter((e) => e.calleeSymbol === symbolName || e.target === sym.symbolId)
        .map((e) => ({ symbol: e.callerSymbol, file: e.source.split("::")[0], confidence: e.confidence }));

      const callees = graph.callEdges
        .filter((e) => e.callerSymbol === symbolName || e.source === sym.symbolId)
        .map((e) => ({ symbol: e.calleeSymbol, file: e.target.split("::")[0], confidence: e.confidence }));

      const result = {
        name: sym.name,
        file: sym.file,
        type: symNode?.type ?? "function",
        loc: symNode?.loc ?? 0,
        isDefault: symNode?.isDefault ?? false,
        complexity: symNode?.complexity ?? 0,
        fanIn: sym.fanIn,
        fanOut: sym.fanOut,
        pageRank: Math.round(sym.pageRank * 10000) / 10000,
        betweenness: Math.round(sym.betweenness * 10000) / 10000,
        callers,
        callees,
        nextSteps: getHints("symbol_context"),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
      const idx = getSearchIndex(graph);
      const results = search(idx, query, limit ?? 20);

      if (results.length === 0) {
        const suggestions = getSuggestions(idx, query);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              query,
              results: [],
              suggestions,
              nextSteps: getHints("search"),
            }, null, 2),
          }],
        };
      }

      const mapped = results.map((r) => ({
        file: r.file,
        score: r.score,
        symbols: r.symbols.map((s) => ({
          name: s.name,
          type: s.type,
          loc: s.loc,
          relevance: s.score,
        })),
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            query,
            results: mapped,
            nextSteps: getHints("search"),
          }, null, 2),
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
      const diffScope = scope ?? "all";
      try {
        let diffCmd: string;
        switch (diffScope) {
          case "staged": diffCmd = "git diff --cached --name-only"; break;
          case "unstaged": diffCmd = "git diff --name-only"; break;
          default: diffCmd = "git diff HEAD --name-only"; break;
        }

        const output = execSync(diffCmd, { encoding: "utf-8", timeout: 5000 }).trim();
        const changedFiles = output ? output.split("\n").filter((f) => f.length > 0) : [];

        const changedSymbols: Array<{ file: string; symbols: string[] }> = [];
        const affectedFiles: string[] = [];
        const fileRiskMetrics: Array<{ file: string; blastRadius: number; complexity: number; churn: number }> = [];

        for (const file of changedFiles) {
          const fileSymbols = [...graph.symbolMetrics.values()]
            .filter((m) => m.file === file || file.endsWith(m.file))
            .map((m) => m.name);
          if (fileSymbols.length > 0) {
            changedSymbols.push({ file, symbols: fileSymbols });
          }

          const dependents = graph.edges
            .filter((e) => e.target === file || file.endsWith(e.target))
            .map((e) => e.source);
          affectedFiles.push(...dependents);

          const matchKey = [...graph.fileMetrics.keys()].find((k) => k === file || file.endsWith(k));
          const metrics = matchKey ? graph.fileMetrics.get(matchKey) : undefined;
          if (metrics) {
            fileRiskMetrics.push({
              file,
              blastRadius: metrics.blastRadius,
              complexity: metrics.cyclomaticComplexity,
              churn: metrics.churn,
            });
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              scope: diffScope,
              changedFiles,
              changedSymbols,
              affectedFiles: [...new Set(affectedFiles)],
              fileRiskMetrics,
              nextSteps: getHints("detect_changes"),
            }, null, 2),
          }],
        };
      } catch {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: "Git not available or not in a git repository",
              scope: diffScope,
              nextSteps: ["Ensure you are in a git repository"],
            }),
          }],
          isError: true,
        };
      }
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
      let processes = graph.processes;
      if (entryPoint) {
        processes = processes.filter((p) =>
          p.entryPoint.symbol === entryPoint ||
          p.name.toLowerCase().includes(entryPoint.toLowerCase())
        );
      }
      if (limit) {
        processes = processes.slice(0, limit);
      }

      const result = {
        processes: processes.map((p) => ({
          name: p.name,
          entryPoint: p.entryPoint,
          steps: p.steps,
          depth: p.depth,
          modulesTouched: p.modulesTouched,
        })),
        totalProcesses: graph.processes.length,
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
      let clusters = graph.clusters;
      if (minFiles) {
        clusters = clusters.filter((c) => c.files.length >= minFiles);
      }

      const result = {
        clusters: clusters.map((c) => ({
          id: c.id,
          name: c.name,
          files: c.files,
          fileCount: c.files.length,
          cohesion: c.cohesion,
        })),
        totalClusters: graph.clusters.length,
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
