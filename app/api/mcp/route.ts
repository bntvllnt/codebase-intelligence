import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";
import type { CodebaseGraph } from "@/src/types/index";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function runTool(graph: CodebaseGraph, tool: string, params: Record<string, unknown>): ToolResult {
  switch (tool) {
    case "codebase_overview": {
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
        ...graph.nodes.filter((n) => n.type === "file").map((n) => n.path.split("/").length),
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
              graph.stats.totalFiles,
          ),
          maxDepth,
          circularDeps: graph.stats.circularDeps.length,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
    }

    case "file_context": {
      const filePath = params.filePath as string;
      const metrics = graph.fileMetrics.get(filePath);
      if (!metrics) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `File not found: ${filePath}` }) }],
          isError: true,
        };
      }
      const node = graph.nodes.find((n) => n.id === filePath && n.type === "file");
      const fileExports = graph.nodes
        .filter((n) => n.parentFile === filePath)
        .map((n) => ({ name: n.label, type: "function", loc: n.loc }));
      const imports = graph.edges
        .filter((e) => e.source === filePath)
        .map((e) => ({ from: e.target, symbols: e.symbols }));
      const dependents = graph.edges
        .filter((e) => e.target === filePath)
        .map((e) => ({ path: e.source, symbols: e.symbols }));
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
      };
      return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
    }

    case "get_dependents": {
      const filePath = params.filePath as string;
      const depth = (params.depth as number | undefined) ?? 2;
      if (!graph.fileMetrics.has(filePath)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `File not found: ${filePath}` }) }],
          isError: true,
        };
      }
      const directDependents = graph.edges
        .filter((e) => e.target === filePath)
        .map((e) => ({ path: e.source, symbols: e.symbols }));
      const transitive: Array<{ path: string; throughPath: string[]; depth: number }> = [];
      const visited = new Set<string>([filePath]);
      function bfs(current: string[], currentDepth: number, pathSoFar: string[]): void {
        if (currentDepth > depth) return;
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
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ file: filePath, directDependents, transitiveDependents: transitive, totalAffected, riskLevel }, null, 2),
        }],
      };
    }

    case "find_hotspots": {
      const metric = (params.metric as string | undefined) ?? "coupling";
      const limit = (params.limit as number | undefined) ?? 10;
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
        for (const [fp, m] of graph.fileMetrics) {
          let score = 0;
          let reason = "";
          switch (metric) {
            case "coupling": score = m.coupling; reason = `fan-in: ${m.fanIn}, fan-out: ${m.fanOut}`; break;
            case "pagerank": score = m.pageRank; reason = `${m.fanIn} dependents`; break;
            case "fan_in": score = m.fanIn; reason = `${m.fanIn} files import this`; break;
            case "fan_out": score = m.fanOut; reason = `imports ${m.fanOut} files`; break;
            case "betweenness": score = m.betweenness; reason = m.isBridge ? "bridge" : "on many shortest paths"; break;
            case "tension": score = m.tension; reason = score > 0 ? "pulled by multiple modules" : "no tension"; break;
            case "churn": score = m.churn; reason = `${m.churn} commits`; break;
            case "complexity": score = m.cyclomaticComplexity; reason = `complexity: ${m.cyclomaticComplexity.toFixed(1)}`; break;
            case "blast_radius": score = m.blastRadius; reason = `${m.blastRadius} transitive dependents`; break;
            case "coverage": score = m.hasTests ? 0 : 1; reason = m.hasTests ? `tested (${m.testFile})` : "no test file"; break;
          }
          scored.push({ path: fp, score, reason });
        }
      }
      const hotspots = scored.sort((a, b) => b.score - a.score).slice(0, limit);
      const top = hotspots[0];
      const summary = hotspots.length > 0
        ? `Top ${metric} hotspot: ${top.path} (${top.score.toFixed(2)}). ${top.reason}.`
        : `No significant ${metric} hotspots found.`;
      return { content: [{ type: "text", text: JSON.stringify({ metric, hotspots, summary }, null, 2) }] };
    }

    case "get_module_structure": {
      const modules = [...graph.moduleMetrics.values()].map((m) => ({
        path: m.path, files: m.files, loc: m.loc, exports: m.exports,
        internalDeps: m.internalDeps, externalDeps: m.externalDeps,
        cohesion: m.cohesion, escapeVelocity: m.escapeVelocity,
        dependsOn: m.dependsOn, dependedBy: m.dependedBy,
      }));
      const crossMap = new Map<string, number>();
      for (const edge of graph.edges) {
        const sn = graph.nodes.find((n) => n.id === edge.source);
        const tn = graph.nodes.find((n) => n.id === edge.target);
        if (!sn || !tn || sn.module === tn.module) continue;
        const key = `${sn.module}->${tn.module}`;
        crossMap.set(key, (crossMap.get(key) ?? 0) + 1);
      }
      const crossModuleDeps: Array<{ from: string; to: string; weight: number }> = [];
      for (const [key, weight] of crossMap) {
        const [from, to] = key.split("->");
        crossModuleDeps.push({ from, to, weight });
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            modules: modules.sort((a, b) => b.files - a.files),
            crossModuleDeps: crossModuleDeps.sort((a, b) => b.weight - a.weight),
            circularDeps: graph.stats.circularDeps.map((c) => ({ cycle: c, severity: c.length > 3 ? "HIGH" : "LOW" })),
          }, null, 2),
        }],
      };
    }

    case "analyze_forces":
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            moduleCohesion: graph.forceAnalysis.moduleCohesion,
            tensionFiles: graph.forceAnalysis.tensionFiles,
            bridgeFiles: graph.forceAnalysis.bridgeFiles,
            extractionCandidates: graph.forceAnalysis.extractionCandidates,
            summary: graph.forceAnalysis.summary,
          }, null, 2),
        }],
      };

    case "get_groups": {
      const groups = graph.groups;
      if (groups.length === 0) {
        return { content: [{ type: "text", text: "No groups found." }] };
      }
      const lines = groups.map((g, i) =>
        `${i + 1}. ${g.name.toUpperCase()} — ${g.files} files, ${g.loc.toLocaleString()} LOC, ` +
        `importance: ${(g.importance * 100).toFixed(1)}%, coupling: ${g.fanIn + g.fanOut} (in:${g.fanIn} out:${g.fanOut})`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "find_dead_exports": {
      const mod = params.module as string | undefined;
      const limit = (params.limit as number | undefined) ?? 20;
      const deadFiles: Array<{ path: string; module: string; deadExports: string[]; totalExports: number }> = [];
      for (const [fp, m] of graph.fileMetrics) {
        if (m.deadExports.length === 0) continue;
        const node = graph.nodes.find((n) => n.id === fp);
        if (!node) continue;
        if (mod && node.module !== mod) continue;
        deadFiles.push({
          path: fp,
          module: node.module,
          deadExports: m.deadExports,
          totalExports: graph.nodes.filter((n) => n.parentFile === fp).length,
        });
      }
      const sorted = deadFiles.sort((a, b) => b.deadExports.length - a.deadExports.length).slice(0, limit);
      const totalDead = sorted.reduce((sum, f) => sum + f.deadExports.length, 0);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalDeadExports: totalDead,
            files: sorted,
            summary: totalDead > 0
              ? `${totalDead} unused exports across ${sorted.length} files.`
              : "No dead exports found.",
          }, null, 2),
        }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${tool}` }) }],
        isError: true,
      };
  }
}

export function GET() {
  const tools = [
    { name: "codebase_overview", description: "High-level overview of codebase structure, modules, and metrics" },
    { name: "file_context", description: "Detailed context for a specific file", params: ["filePath"] },
    { name: "get_dependents", description: "All files that depend on a given file", params: ["filePath", "depth?"] },
    { name: "find_hotspots", description: "Most problematic files by metric", params: ["metric", "limit?"] },
    { name: "get_module_structure", description: "Module structure with cross-module dependencies" },
    { name: "analyze_forces", description: "Centrifuge force analysis" },
    { name: "find_dead_exports", description: "Unused exports across the codebase", params: ["module?", "limit?"] },
    { name: "get_groups", description: "Top-level directory groups with aggregate metrics" },
  ];
  return NextResponse.json({ tools });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tool: string; params?: Record<string, unknown> };
    if (!body.tool) {
      return NextResponse.json({ error: "Missing 'tool' field" }, { status: 400 });
    }
    const graph = getGraph();
    const result = runTool(graph, body.tool, body.params ?? {});
    return NextResponse.json(result, { status: result.isError ? 404 : 200 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
