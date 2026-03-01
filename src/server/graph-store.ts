import type { CodebaseGraph } from "../types/index.js";

interface Staleness {
  stale: boolean;
  indexedHash: string;
  currentHash: string;
}

declare global {

  var __codebaseGraph: CodebaseGraph | undefined;

  var __projectName: string | undefined;

  var __indexedHeadHash: string | undefined;
}

export function setGraph(graph: CodebaseGraph, projectName: string): void {
  globalThis.__codebaseGraph = graph;
  globalThis.__projectName = projectName;
}

export function getGraph(): CodebaseGraph {
  if (!globalThis.__codebaseGraph) {
    throw new Error("Graph not initialized. Run the CLI to parse a codebase first.");
  }
  return globalThis.__codebaseGraph;
}

export function getProjectName(): string {
  return globalThis.__projectName ?? "unknown";
}

export function setIndexedHead(hash: string): void {
  globalThis.__indexedHeadHash = hash;
}

export function getIndexedHead(): string {
  return globalThis.__indexedHeadHash ?? "";
}

export function getStaleness(currentHash: string): Staleness {
  const indexedHash = globalThis.__indexedHeadHash ?? "";
  return {
    stale: indexedHash !== currentHash,
    indexedHash,
    currentHash,
  };
}
