import fs from "fs";
import path from "path";
import type { CodebaseGraph } from "../types/index.js";

const GRAPH_FILE = "graph.json";
const META_FILE = "meta.json";

interface PersistedMeta {
  headHash: string;
  timestamp: string;
  version: number;
}

interface PersistedGraph {
  nodes: CodebaseGraph["nodes"];
  edges: CodebaseGraph["edges"];
  callEdges: CodebaseGraph["callEdges"];
  symbolNodes: CodebaseGraph["symbolNodes"];
  symbolMetrics: Array<[string, CodebaseGraph["symbolMetrics"] extends Map<string, infer V> ? V : never]>;
  fileMetrics: Array<[string, CodebaseGraph["fileMetrics"] extends Map<string, infer V> ? V : never]>;
  moduleMetrics: Array<[string, CodebaseGraph["moduleMetrics"] extends Map<string, infer V> ? V : never]>;
  groups: CodebaseGraph["groups"];
  processes: CodebaseGraph["processes"];
  clusters: CodebaseGraph["clusters"];
  forceAnalysis: CodebaseGraph["forceAnalysis"];
  stats: CodebaseGraph["stats"];
}

interface ImportResult {
  graph: CodebaseGraph;
  headHash: string;
}

/** Export a CodebaseGraph to JSON files in the given directory. */
export function exportGraph(graph: CodebaseGraph, dir: string, headHash: string): void {
  fs.mkdirSync(dir, { recursive: true });

  const persisted: PersistedGraph = {
    nodes: graph.nodes,
    edges: graph.edges,
    callEdges: graph.callEdges,
    symbolNodes: graph.symbolNodes,
    symbolMetrics: [...graph.symbolMetrics.entries()],
    fileMetrics: [...graph.fileMetrics.entries()],
    moduleMetrics: [...graph.moduleMetrics.entries()],
    groups: graph.groups,
    processes: graph.processes,
    clusters: graph.clusters,
    forceAnalysis: graph.forceAnalysis,
    stats: graph.stats,
  };

  const meta: PersistedMeta = {
    headHash,
    timestamp: new Date().toISOString(),
    version: 1,
  };

  fs.writeFileSync(path.join(dir, GRAPH_FILE), JSON.stringify(persisted));
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta));
}

/** Import a CodebaseGraph from JSON files. Returns null if files don't exist. */
export function importGraph(dir: string): ImportResult | null {
  const graphPath = path.join(dir, GRAPH_FILE);
  const metaPath = path.join(dir, META_FILE);

  if (!fs.existsSync(graphPath) || !fs.existsSync(metaPath)) {
    return null;
  }

  const persisted = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as PersistedGraph;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as PersistedMeta;

  const graph: CodebaseGraph = {
    nodes: persisted.nodes,
    edges: persisted.edges,
    callEdges: persisted.callEdges,
    symbolNodes: persisted.symbolNodes,
    symbolMetrics: new Map(persisted.symbolMetrics),
    fileMetrics: new Map(persisted.fileMetrics),
    moduleMetrics: new Map(persisted.moduleMetrics),
    groups: persisted.groups,
    processes: persisted.processes,
    clusters: persisted.clusters,
    forceAnalysis: persisted.forceAnalysis,
    stats: persisted.stats,
  };

  return { graph, headHash: meta.headHash };
}
