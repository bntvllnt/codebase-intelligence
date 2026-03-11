import type { CodebaseGraph, CallConfidence } from "../types/index.js";

interface AffectedSymbol {
  file: string;
  symbol: string;
  confidence: CallConfidence;
}

interface ImpactLevel {
  depth: number;
  risk: "WILL BREAK" | "LIKELY" | "MAY NEED TESTING";
  affected: AffectedSymbol[];
}

interface ImpactResult {
  symbol: string;
  levels: ImpactLevel[];
  totalAffected: number;
  notFound?: boolean;
}

interface RenameReference {
  file: string;
  symbol: string;
  confidence: CallConfidence;
}

interface RenameResult {
  dryRun: boolean;
  oldName: string;
  newName: string;
  references: RenameReference[];
  totalReferences: number;
}

function riskForDepth(depth: number): ImpactLevel["risk"] {
  if (depth === 1) return "WILL BREAK";
  if (depth === 2) return "LIKELY";
  return "MAY NEED TESTING";
}

export function impactAnalysis(graph: CodebaseGraph, symbolQuery: string): ImpactResult {
  const targetIds: string[] = [];
  for (const sym of graph.symbolNodes) {
    const qualifiedName = `${sym.file.split("/").pop()?.replace(".ts", "")}::${sym.name}`;
    const className = sym.file.split("/").pop()?.replace(".ts", "") ?? "";
    const classQualified = `${className.charAt(0).toUpperCase()}${className.slice(1)}.${sym.name}`;

    if (
      sym.id === symbolQuery ||
      sym.name === symbolQuery ||
      qualifiedName === symbolQuery ||
      classQualified === symbolQuery
    ) {
      targetIds.push(sym.id);
    }
  }

  if (targetIds.length === 0) {
    for (const edge of graph.callEdges) {
      if (
        edge.calleeSymbol === symbolQuery ||
        edge.target.endsWith(`::${symbolQuery}`)
      ) {
        if (!targetIds.includes(edge.target)) {
          targetIds.push(edge.target);
        }
      }
    }
  }

  if (targetIds.length === 0) {
    return { symbol: symbolQuery, levels: [], totalAffected: 0, notFound: true };
  }

  const reverseEdges = new Map<string, Array<{ source: string; confidence: CallConfidence }>>();
  for (const edge of graph.callEdges) {
    const existing = reverseEdges.get(edge.target) ?? [];
    existing.push({ source: edge.source, confidence: edge.confidence });
    reverseEdges.set(edge.target, existing);
  }

  const visited = new Set<string>(targetIds);
  let currentFrontier = [...targetIds];
  let depth = 0;
  const levels: ImpactLevel[] = [];

  while (currentFrontier.length > 0) {
    depth++;
    const nextFrontier: string[] = [];
    const affected: AffectedSymbol[] = [];

    for (const nodeId of currentFrontier) {
      const callers = reverseEdges.get(nodeId) ?? [];
      for (const caller of callers) {
        if (visited.has(caller.source)) continue;
        visited.add(caller.source);
        nextFrontier.push(caller.source);

        const sym = graph.symbolNodes.find((s) => s.id === caller.source);
        affected.push({
          file: sym ? sym.file : caller.source.split("::")[0],
          symbol: sym ? sym.name : (caller.source.split("::")[1] ?? caller.source),
          confidence: caller.confidence,
        });
      }
    }

    if (affected.length > 0) {
      levels.push({ depth, risk: riskForDepth(depth), affected });
    }

    currentFrontier = nextFrontier;

    if (depth > 20) break;
  }

  const totalAffected = levels.reduce((sum, l) => sum + l.affected.length, 0);
  return { symbol: symbolQuery, levels, totalAffected };
}

export function renameSymbol(
  graph: CodebaseGraph,
  oldName: string,
  newName: string,
  dryRun: boolean,
): RenameResult {
  const references: RenameReference[] = [];

  for (const sym of graph.symbolNodes) {
    if (sym.name === oldName) {
      references.push({
        file: sym.file,
        symbol: sym.name,
        confidence: "type-resolved",
      });
    }
  }

  for (const edge of graph.callEdges) {
    if (edge.calleeSymbol === oldName) {
      const callerSym = graph.symbolNodes.find((s) => s.id === edge.source);
      const file = callerSym ? callerSym.file : edge.source.split("::")[0];
      if (!references.some((r) => r.file === file && r.symbol === oldName)) {
        references.push({
          file,
          symbol: oldName,
          confidence: edge.confidence,
        });
      }
    }
  }

  for (const edge of graph.edges) {
    if (edge.symbols.includes(oldName)) {
      if (!references.some((r) => r.file === edge.source)) {
        references.push({
          file: edge.source,
          symbol: oldName,
          confidence: "text-inferred",
        });
      }
    }
  }

  void newName;

  return {
    dryRun,
    oldName,
    newName,
    references,
    totalReferences: references.length,
  };
}
