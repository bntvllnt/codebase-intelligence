import type { CodebaseGraph, GraphEdge, SymbolNode } from "../types/index.js";
import type { ContentDriftBehavior, ContentDriftIntent, FileProfile } from "./types.js";
import {
  basename,
  dominantTokens,
  scopeOf,
  SIDE_EFFECT_TOKENS,
  splitWords,
  stripExtension,
  uniqueSorted,
} from "./tokens.js";

function fileNodePaths(graph: CodebaseGraph): string[] {
  return graph.nodes
    .filter((node) => node.type === "file")
    .map((node) => node.path)
    .sort();
}

function symbolsByFile(graph: CodebaseGraph): Map<string, SymbolNode[]> {
  const grouped = new Map<string, SymbolNode[]>();
  for (const symbol of graph.symbolNodes) {
    const symbols = grouped.get(symbol.file) ?? [];
    symbols.push(symbol);
    grouped.set(symbol.file, symbols);
  }
  for (const symbols of grouped.values()) {
    symbols.sort((left, right) => left.name.localeCompare(right.name));
  }
  return grouped;
}

function edgesBySource(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const grouped = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const group = grouped.get(edge.source) ?? [];
    group.push(edge);
    grouped.set(edge.source, group);
  }
  return grouped;
}

function edgesByTarget(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const grouped = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const group = grouped.get(edge.target) ?? [];
    group.push(edge);
    grouped.set(edge.target, group);
  }
  return grouped;
}

function calledSymbolsForFile(graph: CodebaseGraph, file: string): string[] {
  return uniqueSorted(
    graph.callEdges
      .filter((edge) => edge.source.startsWith(`${file}::`))
      .map((edge) => edge.calleeSymbol),
  );
}

function typeNamesForSymbols(symbols: readonly SymbolNode[]): string[] {
  const names: string[] = [];
  for (const symbol of symbols) {
    if (!symbol.typeFacts) continue;
    names.push(...symbol.typeFacts.consumes, ...symbol.typeFacts.produces);
  }
  return uniqueSorted(names);
}

function declaredIntent(file: string, symbols: readonly SymbolNode[]): ContentDriftIntent {
  const fileName = stripExtension(basename(file));
  const scope = scopeOf(file);
  const exportNames = uniqueSorted(symbols.filter((symbol) => symbol.isExported).map((symbol) => symbol.name));
  const tokens = uniqueSorted([
    ...splitWords(scope),
    ...splitWords(fileName),
    ...exportNames.flatMap((name) => splitWords(name)),
  ]);
  return {
    path: file,
    fileName,
    scope,
    tokens,
    exports: exportNames,
  };
}

function behaviorProfile(
  graph: CodebaseGraph,
  file: string,
  symbols: readonly SymbolNode[],
  importEdges: readonly GraphEdge[],
  importedBy: readonly GraphEdge[],
): ContentDriftBehavior {
  const calls = calledSymbolsForFile(graph, file);
  const types = typeNamesForSymbols(symbols);
  const imports = uniqueSorted(importEdges.map((edge) => edge.target));
  const importTokens = imports.flatMap((target) => splitWords(stripExtension(target)));
  const callTokens = calls.flatMap((call) => splitWords(call));
  const typeTokens = types.flatMap((typeName) => splitWords(typeName));
  const exportTokens = symbols.map((symbol) => symbol.name).flatMap((name) => splitWords(name));
  const importedByTokens = importedBy.flatMap((edge) => splitWords(stripExtension(edge.source)));
  const sideEffects = uniqueSorted(
    [...calls, ...symbols.map((symbol) => symbol.name)]
      .filter((name) => splitWords(name).some((token) => SIDE_EFFECT_TOKENS.has(token))),
  );

  return {
    tokens: dominantTokens([...importTokens, ...callTokens, ...typeTokens, ...exportTokens, ...importedByTokens]),
    imports,
    calls,
    types,
    sideEffects,
    tests: importedBy.filter((edge) => edge.symbols.includes("tests")).map((edge) => edge.source).sort(),
  };
}

export function buildProfiles(graph: CodebaseGraph): FileProfile[] {
  const byFile = symbolsByFile(graph);
  const bySource = edgesBySource(graph.edges);
  const byTarget = edgesByTarget(graph.edges);

  return fileNodePaths(graph).map((file) => {
    const symbols = byFile.get(file) ?? [];
    const importEdges = bySource.get(file) ?? [];
    const importedBy = byTarget.get(file) ?? [];
    const metrics = graph.fileMetrics.get(file);
    return {
      file,
      scope: scopeOf(file),
      fileName: stripExtension(basename(file)),
      declared: declaredIntent(file, symbols),
      behavior: behaviorProfile(graph, file, symbols, importEdges, importedBy),
      metrics,
      importEdges,
      importedBy,
      symbols,
      isTestFile: metrics?.isTestFile ?? /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
    };
  });
}
