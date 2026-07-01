import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { CodebaseGraph, Cluster } from "../types/index.js";

/** Detect communities using Louvain algorithm on the file dependency graph. */
export function detectCommunities(graph: CodebaseGraph): Cluster[] {
  const undirected = new Graph({ type: "undirected" });

  const fileNodes = graph.nodes
    .filter((node) => node.type === "file")
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const node of fileNodes) {
    if (node.type !== "file") continue;
    if (!undirected.hasNode(node.id)) {
      undirected.addNode(node.id, { module: node.module });
    }
  }

  const dependencyEdges = new Map<string, { source: string; target: string; weight: number }>();

  for (const edge of graph.edges) {
    if (!undirected.hasNode(edge.source) || !undirected.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;

    const source = edge.source.localeCompare(edge.target) <= 0 ? edge.source : edge.target;
    const target = source === edge.source ? edge.target : edge.source;
    const key = `${source}\t${target}`;
    const existing = dependencyEdges.get(key);
    if (existing) {
      existing.weight += edge.weight;
    } else {
      dependencyEdges.set(key, { source, target, weight: edge.weight });
    }
  }

  const sortedDependencyEdges = [...dependencyEdges.values()].sort((a, b) =>
    `${a.source}\t${a.target}`.localeCompare(`${b.source}\t${b.target}`)
  );

  for (const edge of sortedDependencyEdges) {
    undirected.addEdge(edge.source, edge.target, { weight: edge.weight });
  }

  if (undirected.order === 0) return [];

  const communities = louvain(undirected, { randomWalk: false }) as Record<string, number>;

  const clusterMap = new Map<number, string[]>();
  for (const [nodeId, clusterId] of Object.entries(communities).sort(([a], [b]) => a.localeCompare(b))) {
    const existing = clusterMap.get(clusterId) ?? [];
    existing.push(nodeId);
    clusterMap.set(clusterId, existing);
  }

  const clusters: Array<Omit<Cluster, "id">> = [];
  for (const files of clusterMap.values()) {
    files.sort((a, b) => a.localeCompare(b));
    const commonModule = findDominantModule(files, graph);
    const cohesion = computeClusterCohesion(files, graph);

    clusters.push({
      name: commonModule,
      files,
      cohesion,
    });
  }

  return clusters
    .sort((a, b) =>
      b.files.length - a.files.length ||
      a.name.localeCompare(b.name) ||
      (a.files[0] ?? "").localeCompare(b.files[0] ?? "")
    )
    .map((cluster, index) => ({ id: `cluster-${index}`, ...cluster }));
}

function findDominantModule(files: string[], graph: CodebaseGraph): string {
  const moduleCounts = new Map<string, number>();
  for (const file of files) {
    const node = graph.nodes.find((n) => n.id === file);
    if (!node) continue;
    const mod = node.module;
    moduleCounts.set(mod, (moduleCounts.get(mod) ?? 0) + 1);
  }

  let dominant = "misc";
  let maxCount = 0;
  for (const [mod, count] of moduleCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = mod;
    }
  }
  return dominant;
}

function computeClusterCohesion(files: string[], graph: CodebaseGraph): number {
  if (files.length <= 1) return 1;

  const fileSet = new Set(files);
  let internalEdges = 0;
  let totalEdges = 0;

  for (const edge of graph.edges) {
    if (!fileSet.has(edge.source)) continue;
    totalEdges++;
    if (fileSet.has(edge.target)) {
      internalEdges++;
    }
  }

  return totalEdges === 0 ? 0 : internalEdges / totalEdges;
}
