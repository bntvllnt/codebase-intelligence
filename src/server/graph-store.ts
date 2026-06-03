import type { CodebaseGraph } from "../types/index.js";

declare global {

  var __codebaseGraph: CodebaseGraph | undefined;

  var __indexedHeadHash: string | undefined;

  var __codebaseRoot: string | undefined;
}

export function setGraph(graph: CodebaseGraph): void {
  globalThis.__codebaseGraph = graph;
}

export function getGraph(): CodebaseGraph {
  if (!globalThis.__codebaseGraph) {
    throw new Error("Graph not initialized. Run the CLI to parse a codebase first.");
  }
  return globalThis.__codebaseGraph;
}

export function setIndexedHead(hash: string): void {
  globalThis.__indexedHeadHash = hash;
}

export function getIndexedHead(): string {
  return globalThis.__indexedHeadHash ?? "";
}

export function setRoot(root: string): void {
  globalThis.__codebaseRoot = root;
}

export function getRoot(): string {
  return globalThis.__codebaseRoot ?? process.cwd();
}
