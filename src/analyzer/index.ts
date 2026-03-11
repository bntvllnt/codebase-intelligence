import type Graph from "graphology";
import pagerank from "graphology-metrics/centrality/pagerank.js";
import betweennessCentrality from "graphology-metrics/centrality/betweenness.js";
import path from "path";
import type {
  ParsedFile,
  FileMetrics,
  ModuleMetrics,
  GroupMetrics,
  ForceAnalysis,
  TensionFile,
  BridgeFile,
  ExtractionCandidate,
  CodebaseGraph,
  GraphNode,
  SymbolMetrics,
} from "../types/index.js";
import { type BuiltGraph, detectCircularDeps } from "../graph/index.js";
import { cloudGroup } from "../cloud-group.js";
import { traceProcesses } from "../process/index.js";
import { detectCommunities } from "../community/index.js";

export function analyzeGraph(built: BuiltGraph, parsedFiles?: ParsedFile[]): CodebaseGraph {
  const { graph, nodes, edges } = built;
  const fileNodes = nodes.filter((n) => n.type === "file");

  // Build lookup from parsed files
  const parsedByPath = new Map<string, ParsedFile>();
  if (parsedFiles) {
    for (const f of parsedFiles) {
      parsedByPath.set(f.relativePath, f);
    }
  }

  // Build set of all consumed symbols (for dead export detection)
  const consumedSymbols = new Map<string, Set<string>>();
  for (const edge of edges) {
    const existing = consumedSymbols.get(edge.target) ?? new Set<string>();
    for (const sym of edge.symbols) existing.add(sym);
    consumedSymbols.set(edge.target, existing);
  }

  // Also count symbols consumed via call graph (includes same-file calls)
  for (const callEdge of built.callEdges) {
    const sepIdx = callEdge.target.indexOf("::");
    if (sepIdx === -1) continue;
    const targetFile = callEdge.target.substring(0, sepIdx);
    // Normalize: class method "AuthService.validate" → class name "AuthService"
    const rawSymbol = callEdge.calleeSymbol;
    const consumedName = rawSymbol.includes(".") ? rawSymbol.split(".")[0] : rawSymbol;
    const existing = consumedSymbols.get(targetFile) ?? new Set<string>();
    existing.add(consumedName);
    consumedSymbols.set(targetFile, existing);
  }

  // Core metrics
  const pageRanks = computePageRank(graph);
  const betweennessScores = computeBetweenness(graph);
  const circularDeps = detectCircularDeps(graph);

  // Per-file metrics
  const fileMetrics = new Map<string, FileMetrics>();
  for (const node of fileNodes) {
    const fanIn = graph.inDegree(node.id);
    const fanOut = graph.outDegree(node.id);
    const coupling = fanOut === 0 && fanIn === 0 ? 0 : fanOut / (Math.max(fanIn, 1) + fanOut);
    const pr = pageRanks.get(node.id) ?? 0;
    const btwn = betweennessScores.get(node.id) ?? 0;

    const parsed = parsedByPath.get(node.id);
    const avgComplexity = parsed && parsed.exports.length > 0
      ? parsed.exports.reduce((sum, e) => sum + e.complexity, 0) / parsed.exports.length
      : 1;

    // Dead exports: exports not consumed by any edge
    const consumed = consumedSymbols.get(node.id) ?? new Set<string>();
    const deadExports = parsed
      ? parsed.exports
          .filter((e) => !e.isDefault && !consumed.has(e.name))
          .map((e) => e.name)
      : [];

    fileMetrics.set(node.id, {
      pageRank: pr,
      betweenness: btwn,
      fanIn,
      fanOut,
      coupling,
      tension: 0, // computed in force analysis
      isBridge: btwn > 0.1,
      churn: parsed?.churn ?? 0,
      cyclomaticComplexity: Math.round(avgComplexity * 100) / 100,
      blastRadius: 0, // computed after all nodes are processed
      deadExports,
      hasTests: parsed?.testFile !== undefined,
      testFile: parsed?.testFile ?? "",
      isTestFile: parsed?.isTestFile ?? false,
    });
  }

  // Blast radius: BFS transitive dependents per file
  for (const node of fileNodes) {
    const visited = new Set<string>();
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const dependent of graph.inNeighbors(current)) {
        if (graph.getNodeAttribute(dependent, "type") !== "file") continue;
        if (visited.has(dependent)) continue;
        visited.add(dependent);
        queue.push(dependent);
      }
    }
    const metrics = fileMetrics.get(node.id);
    if (metrics) metrics.blastRadius = visited.size;
  }

  // Module metrics
  const moduleMetrics = computeModuleMetrics(graph, fileNodes, fileMetrics);

  // Group metrics (cloud-level aggregation)
  const groups = computeGroups(fileNodes, fileMetrics);

  // Centrifuge force analysis
  const forceAnalysis = computeForceAnalysis(graph, fileNodes, fileMetrics, moduleMetrics, betweennessScores);

  // Update tension in fileMetrics from force analysis
  for (const tf of forceAnalysis.tensionFiles) {
    const existing = fileMetrics.get(tf.file);
    if (existing) {
      existing.tension = tf.tension;
    }
  }

  // Per-symbol fan-in/fan-out from call graph
  const symbolMetrics = computeSymbolMetrics(built);

  // Build partial graph for process tracing and community detection
  const partialGraph: CodebaseGraph = {
    nodes,
    edges,
    callEdges: built.callEdges,
    symbolNodes: built.symbolNodes,
    symbolMetrics,
    fileMetrics,
    moduleMetrics,
    groups,
    processes: [],
    clusters: [],
    forceAnalysis,
    stats: {
      totalFiles: fileNodes.length,
      totalFunctions: nodes.filter((n) => n.type === "function" || n.type === "class").length,
      totalDependencies: edges.length,
      circularDeps,
    },
  };

  // Process tracing and community detection
  partialGraph.processes = traceProcesses(partialGraph);
  partialGraph.clusters = detectCommunities(partialGraph);

  return partialGraph;
}

const GROUP_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
  "#0891b2", "#ca8a04", "#e11d48", "#4f46e5", "#059669",
  "#7c3aed", "#db2777", "#0d9488", "#d97706", "#6366f1",
  "#be123c", "#15803d", "#a855f7", "#f97316", "#0284c7",
];

const MAX_LEGEND_GROUPS = Infinity;

function computeGroups(
  fileNodes: GraphNode[],
  fileMetrics: Map<string, FileMetrics>,
): GroupMetrics[] {
  const agg = new Map<string, { files: number; loc: number; pr: number; fanIn: number; fanOut: number }>();

  for (const node of fileNodes) {
    const group = cloudGroup(node.module);
    const existing = agg.get(group) ?? { files: 0, loc: 0, pr: 0, fanIn: 0, fanOut: 0 };
    const metrics = fileMetrics.get(node.id);
    existing.files++;
    existing.loc += node.loc;
    existing.pr += metrics?.pageRank ?? 0;
    existing.fanIn += metrics?.fanIn ?? 0;
    existing.fanOut += metrics?.fanOut ?? 0;
    agg.set(group, existing);
  }

  const groups: GroupMetrics[] = [];
  let colorIdx = 0;

  const sorted = [...agg.entries()].sort((a, b) => b[1].pr - a[1].pr);
  for (const [name, data] of sorted) {
    if (groups.length >= MAX_LEGEND_GROUPS) break;
    groups.push({
      name,
      files: data.files,
      loc: data.loc,
      importance: Math.round(data.pr * 10000) / 10000,
      fanIn: data.fanIn,
      fanOut: data.fanOut,
      color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
    });
    colorIdx++;
  }

  return groups;
}

function computePageRank(graph: Graph): Map<string, number> {
  const result = new Map<string, number>();
  try {
    const scores = pagerank(graph, { alpha: 0.85, getEdgeWeight: "weight" });
    for (const [node, score] of Object.entries(scores)) {
      result.set(node, score);
    }
  } catch {
    // Fallback: uniform score
    graph.forEachNode((node: string) => result.set(node, 1 / graph.order));
  }
  return result;
}

function computeBetweenness(graph: Graph): Map<string, number> {
  const result = new Map<string, number>();
  try {
    const scores = betweennessCentrality(graph, { normalized: true });
    for (const [node, score] of Object.entries(scores)) {
      result.set(node, score);
    }
  } catch {
    graph.forEachNode((node: string) => result.set(node, 0));
  }
  return result;
}

function computeModuleMetrics(
  graph: Graph,
  fileNodes: GraphNode[],
  _fileMetrics: Map<string, FileMetrics>
): Map<string, ModuleMetrics> {
  const modules = new Map<string, GraphNode[]>();

  // Group files by module
  for (const node of fileNodes) {
    const existing = modules.get(node.module) ?? [];
    existing.push(node);
    modules.set(node.module, existing);
  }

  const moduleMetrics = new Map<string, ModuleMetrics>();

  for (const [modulePath, files] of modules) {
    const fileIds = new Set(files.map((f) => f.id));
    let internalDeps = 0;
    let externalDeps = 0;
    let totalLoc = 0;
    let totalExports = 0;
    const dependsOnSet = new Set<string>();
    const dependedBySet = new Set<string>();

    for (const file of files) {
      totalLoc += file.loc;
      totalExports += (graph.getNodeAttribute(file.id, "exportCount") as number | undefined) ?? 0;

      // Count outgoing edges
      for (const neighbor of graph.outNeighbors(file.id)) {
        if (graph.getNodeAttribute(neighbor, "type") !== "file") continue;
        const neighborModule = graph.getNodeAttribute(neighbor, "module") as string;
        if (fileIds.has(neighbor)) {
          internalDeps++;
        } else {
          externalDeps++;
          dependsOnSet.add(neighborModule);
        }
      }

      // Count incoming edges from other modules
      for (const neighbor of graph.inNeighbors(file.id)) {
        if (graph.getNodeAttribute(neighbor, "type") !== "file") continue;
        const neighborModule = graph.getNodeAttribute(neighbor, "module") as string;
        if (!fileIds.has(neighbor)) {
          dependedBySet.add(neighborModule);
        }
      }
    }

    const totalDeps = internalDeps + externalDeps;
    const cohesion = totalDeps === 0 ? 1 : internalDeps / totalDeps;

    // Escape velocity: high external use + low internal deps
    const externalUseCount = dependedBySet.size;
    const escapeVelocity =
      externalDeps === 0 && externalUseCount > 0
        ? Math.min(1, externalUseCount / (modules.size - 1))
        : 0;

    moduleMetrics.set(modulePath, {
      path: modulePath,
      files: files.length,
      loc: totalLoc,
      exports: totalExports,
      internalDeps,
      externalDeps,
      cohesion: Math.round(cohesion * 100) / 100,
      escapeVelocity: Math.round(escapeVelocity * 100) / 100,
      dependsOn: [...dependsOnSet],
      dependedBy: [...dependedBySet],
    });
  }

  return moduleMetrics;
}

function isTestFilePath(fileId: string): boolean {
  return fileId.includes(".test.") || fileId.includes(".spec.") || fileId.includes("__tests__/");
}

function isTypeHubFile(fileId: string): boolean {
  const basename = path.basename(fileId);
  const dir = path.dirname(fileId);
  const dirBasename = path.basename(dir);
  if (basename === "types.ts" || basename === "constants.ts" || basename === "config.ts") return true;
  if (basename === "index.ts" && dirBasename === "types") return true;
  return false;
}

function isEntryPointFile(fileId: string): boolean {
  const basename = path.basename(fileId);
  const entryNames = ["cli.ts", "main.ts", "app.ts", "server.ts"];
  if (entryNames.includes(basename)) return true;
  const dir = path.dirname(fileId);
  if (basename === "index.ts" && (dir === "." || dir === "")) return true;
  return false;
}

function computeForceAnalysis(
  graph: Graph,
  fileNodes: GraphNode[],
  fileMetrics: Map<string, FileMetrics>,
  moduleMetrics: Map<string, ModuleMetrics>,
  betweennessScores: Map<string, number>
): ForceAnalysis {
  // Group files by module for non-test file counting
  const moduleFiles = new Map<string, GraphNode[]>();
  for (const node of fileNodes) {
    const existing = moduleFiles.get(node.module) ?? [];
    existing.push(node);
    moduleFiles.set(node.module, existing);
  }

  // Module cohesion verdicts
  type CohesionVerdict = "COHESIVE" | "MODERATE" | "JUNK_DRAWER" | "LEAF";
  const moduleCohesion = [...moduleMetrics.values()].map((m) => {
    const files = moduleFiles.get(m.path) ?? [];
    const nonTestFileCount = files.filter((f) => !isTestFilePath(f.id)).length;
    const verdict: CohesionVerdict = nonTestFileCount <= 1
      ? "LEAF"
      : m.cohesion >= 0.6 ? "COHESIVE" : m.cohesion >= 0.4 ? "MODERATE" : "JUNK_DRAWER";
    return { ...m, verdict };
  });

  // Tension files: files pulled by multiple modules
  const tensionFiles: TensionFile[] = [];
  for (const file of fileNodes) {
    const modulePulls = new Map<string, { strength: number; symbols: string[] }>();

    for (const neighbor of graph.outNeighbors(file.id)) {
      if (graph.getNodeAttribute(neighbor, "type") !== "file") continue;
      const neighborModule = graph.getNodeAttribute(neighbor, "module") as string;
      if (neighborModule === file.module) continue;

      const edgeAttrs = graph.getEdgeAttributes(file.id, neighbor);
      const existing = modulePulls.get(neighborModule) ?? { strength: 0, symbols: [] };
      existing.strength += (edgeAttrs.weight as number) || 1;
      const edgeSymbols = edgeAttrs.symbols as string[] | undefined;
      if (edgeSymbols) existing.symbols.push(...edgeSymbols);
      modulePulls.set(neighborModule, existing);
    }

    // Also count inbound pulls
    for (const neighbor of graph.inNeighbors(file.id)) {
      if (graph.getNodeAttribute(neighbor, "type") !== "file") continue;
      const neighborModule = graph.getNodeAttribute(neighbor, "module") as string;
      if (neighborModule === file.module) continue;

      const existing = modulePulls.get(neighborModule) ?? { strength: 0, symbols: [] };
      existing.strength += 0.5; // Inbound pull is weaker
      modulePulls.set(neighborModule, existing);
    }

    if (modulePulls.size >= 2) {
      const pulls = [...modulePulls.entries()].map(([mod, data]) => ({
        module: mod,
        strength: Math.round(data.strength * 100) / 100,
        symbols: [...new Set(data.symbols)],
      }));

      // Tension = entropy-based evenness of pulls
      const totalStrength = pulls.reduce((sum, p) => sum + p.strength, 0);
      const probs = pulls.map((p) => p.strength / totalStrength);
      const maxEntropy = Math.log(pulls.length);
      const entropy = -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);
      const tension = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) / 100 : 0;

      if (tension > 0.3) {
        let recommendation: string;
        if (isTypeHubFile(file.id)) {
          recommendation = "Type hub — split not recommended (design-intentional shared types)";
        } else if (isEntryPointFile(file.id)) {
          recommendation = "Entry point — split not recommended (CLI/app entry point)";
        } else {
          const topModules = pulls
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 2)
            .map((p) => path.basename(p.module.replace(/\/$/, "")));
          recommendation = `Split into ${topModules.map((m) => `${m}-${path.basename(file.id)}`).join(" and ")}`;
        }

        tensionFiles.push({
          file: file.id,
          tension,
          pulledBy: pulls.sort((a, b) => b.strength - a.strength),
          recommendation,
        });
      }
    }
  }

  // Bridge files: high betweenness centrality
  const bridgeFiles: BridgeFile[] = [];
  for (const file of fileNodes) {
    const btwn = betweennessScores.get(file.id) ?? 0;
    if (btwn < 0.05) continue;

    const connectedModules = new Set<string>();
    for (const neighbor of graph.neighbors(file.id)) {
      if (graph.getNodeAttribute(neighbor, "type") !== "file") continue;
      const mod = graph.getNodeAttribute(neighbor, "module") as string;
      if (mod !== file.module) connectedModules.add(mod);
    }

    if (connectedModules.size >= 2) {
      bridgeFiles.push({
        file: file.id,
        betweenness: Math.round(btwn * 100) / 100,
        connects: [...connectedModules],
        role: `Bridge between ${connectedModules.size} otherwise-disconnected modules`,
      });
    }
  }

  // Extraction candidates: high escape velocity modules
  const extractionCandidates: ExtractionCandidate[] = [];
  for (const mod of moduleMetrics.values()) {
    if (mod.escapeVelocity < 0.5) continue;
    if (mod.files < 1) continue;

    extractionCandidates.push({
      target: mod.path,
      escapeVelocity: mod.escapeVelocity,
      internalDeps: mod.internalDeps,
      externalDeps: mod.externalDeps,
      dependedByModules: mod.dependedBy.length,
      recommendation: `Extract to standalone package — ${mod.externalDeps === 0 ? "0 deps on host codebase" : `${mod.externalDeps} deps to resolve`}`,
    });
  }

  // Summary
  const junkDrawers = moduleCohesion.filter((m) => m.verdict === "JUNK_DRAWER");
  const summaryParts: string[] = [];
  if (junkDrawers.length > 0) {
    summaryParts.push(`${junkDrawers.length} junk-drawer module(s) (${junkDrawers.map((m) => m.path).join(", ")})`);
  }
  if (tensionFiles.length > 0) {
    summaryParts.push(`${tensionFiles.length} tension file(s) need splitting`);
  }
  if (extractionCandidates.length > 0) {
    summaryParts.push(`${extractionCandidates.map((e) => e.target).join(", ")} ready for extraction`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Codebase architecture looks healthy. No major force imbalances detected.");
  }

  return {
    moduleCohesion,
    tensionFiles: tensionFiles.sort((a, b) => b.tension - a.tension),
    bridgeFiles: bridgeFiles.sort((a, b) => b.betweenness - a.betweenness),
    extractionCandidates: extractionCandidates.sort((a, b) => b.escapeVelocity - a.escapeVelocity),
    summary: summaryParts.join(". ") + ".",
  };
}

function computeSymbolMetrics(built: BuiltGraph): Map<string, SymbolMetrics> {
  const metrics = new Map<string, SymbolMetrics>();
  const { callGraph, symbolNodes } = built;

  const symbolPageRank = new Map<string, number>();
  const symbolBetweenness = new Map<string, number>();

  if (callGraph.order > 0) {
    try {
      const prScores = pagerank(callGraph, { alpha: 0.85, getEdgeWeight: null });
      for (const [node, score] of Object.entries(prScores)) {
        symbolPageRank.set(node, score);
      }
    } catch {
      callGraph.forEachNode((node: string) => { symbolPageRank.set(node, 0); });
    }

    try {
      const btScores = betweennessCentrality(callGraph, { normalized: true });
      for (const [node, score] of Object.entries(btScores)) {
        symbolBetweenness.set(node, score);
      }
    } catch {
      callGraph.forEachNode((node: string) => { symbolBetweenness.set(node, 0); });
    }
  }

  for (const sym of symbolNodes) {
    const fanIn = callGraph.hasNode(sym.id) ? callGraph.inDegree(sym.id) : 0;
    const fanOut = callGraph.hasNode(sym.id) ? callGraph.outDegree(sym.id) : 0;
    metrics.set(sym.id, {
      symbolId: sym.id,
      name: sym.name,
      file: sym.file,
      fanIn,
      fanOut,
      pageRank: symbolPageRank.get(sym.id) ?? 0,
      betweenness: symbolBetweenness.get(sym.id) ?? 0,
    });
  }

  callGraph.forEachNode((nodeId: string, attrs: Record<string, unknown>) => {
    if (metrics.has(nodeId)) return;
    metrics.set(nodeId, {
      symbolId: nodeId,
      name: attrs.name as string,
      file: attrs.file as string,
      fanIn: callGraph.inDegree(nodeId),
      fanOut: callGraph.outDegree(nodeId),
      pageRank: symbolPageRank.get(nodeId) ?? 0,
      betweenness: symbolBetweenness.get(nodeId) ?? 0,
    });
  });

  return metrics;
}
