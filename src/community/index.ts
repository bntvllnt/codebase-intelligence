import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { CodebaseGraph, Cluster } from "../types/index.js";

/** Detect communities using Louvain algorithm on the file dependency graph. */
export function detectCommunities(graph: CodebaseGraph): Cluster[] {
  const undirected = new Graph({ type: "undirected" });

  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    if (!undirected.hasNode(node.id)) {
      undirected.addNode(node.id, { module: node.module });
    }
  }

  for (const edge of graph.edges) {
    if (!undirected.hasNode(edge.source) || !undirected.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;
    if (!undirected.hasEdge(edge.source, edge.target) && !undirected.hasEdge(edge.target, edge.source)) {
      undirected.addEdge(edge.source, edge.target, { weight: edge.weight });
    }
  }

  if (undirected.order === 0) return [];

  const communities = louvain(undirected) as Record<string, number>;

  const clusterMap = new Map<number, string[]>();
  for (const [nodeId, clusterId] of Object.entries(communities)) {
    const existing = clusterMap.get(clusterId) ?? [];
    existing.push(nodeId);
    clusterMap.set(clusterId, existing);
  }

  const clusters: Cluster[] = [];
  for (const [clusterId, files] of clusterMap) {
    const commonModule = findDominantModule(files, graph);
    const cohesion = computeClusterCohesion(files, graph);

    clusters.push({
      id: `cluster-${clusterId}`,
      name: commonModule,
      files,
      cohesion,
    });
  }

  return clusters.sort((a, b) => b.files.length - a.files.length);
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
