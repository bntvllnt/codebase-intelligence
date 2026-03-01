import type { CodebaseGraph, ProcessFlow, ProcessStep } from "../types/index.js";

interface EntryPoint {
  file: string;
  symbol: string;
  symbolId: string;
}

/** Detect entry points: symbols with no inbound call edges in the call graph. */
export function detectEntryPoints(graph: CodebaseGraph): EntryPoint[] {
  const calledSymbolIds = new Set(graph.callEdges.map((e) => e.target));

  const entryPoints: EntryPoint[] = [];
  for (const sym of graph.symbolNodes) {
    if (sym.type !== "function" && sym.type !== "class") continue;
    if (!calledSymbolIds.has(sym.id)) {
      entryPoints.push({ file: sym.file, symbol: sym.name, symbolId: sym.id });
    }
  }

  return entryPoints;
}

/** Trace execution processes from entry points through the call graph via BFS. */
export function traceProcesses(graph: CodebaseGraph): ProcessFlow[] {
  const entryPoints = detectEntryPoints(graph);
  const processes: ProcessFlow[] = [];

  const outEdges = new Map<string, Array<{ target: string; calleeSymbol: string }>>();
  for (const edge of graph.callEdges) {
    const existing = outEdges.get(edge.source) ?? [];
    existing.push({ target: edge.target, calleeSymbol: edge.calleeSymbol });
    outEdges.set(edge.source, existing);
  }

  for (const ep of entryPoints) {
    const steps: ProcessStep[] = [];
    const visited = new Set<string>();
    const queue: Array<{ symbolId: string; step: number }> = [{ symbolId: ep.symbolId, step: 0 }];
    visited.add(ep.symbolId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      const sym = graph.symbolNodes.find((s) => s.id === current.symbolId);
      const file = sym ? sym.file : current.symbolId.split("::")[0];
      const symbolName = sym ? sym.name : (current.symbolId.split("::")[1] ?? current.symbolId);

      steps.push({ step: current.step, file, symbol: symbolName });

      const edges = outEdges.get(current.symbolId) ?? [];
      for (const edge of edges) {
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        queue.push({ symbolId: edge.target, step: current.step + 1 });
      }
    }

    const maxStep = steps.reduce((max, s) => Math.max(max, s.step), 0);
    const modulesTouched = [...new Set(steps.map((s) => {
      const parts = s.file.split("/");
      return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    }))];

    processes.push({
      name: ep.symbol,
      entryPoint: { file: ep.file, symbol: ep.symbol },
      steps,
      depth: maxStep,
      modulesTouched,
    });
  }

  return processes.sort((a, b) => b.depth - a.depth);
}
