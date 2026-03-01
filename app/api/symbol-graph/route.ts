import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";
import type { SymbolGraphResponse } from "@/lib/types";

export function GET(): NextResponse<SymbolGraphResponse> {
  const graph = getGraph();

  const symbolNodes = graph.symbolNodes.map((s) => {
    const metrics = graph.symbolMetrics.get(s.id);
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      file: s.file,
      loc: s.loc,
      isDefault: s.isDefault,
      fanIn: metrics?.fanIn ?? 0,
      fanOut: metrics?.fanOut ?? 0,
      pageRank: metrics?.pageRank ?? 0,
      betweenness: metrics?.betweenness ?? 0,
    };
  });

  const callEdges = graph.callEdges.map((e) => ({
    source: e.source,
    target: e.target,
    callerSymbol: e.callerSymbol,
    calleeSymbol: e.calleeSymbol,
    confidence: e.confidence,
  }));

  const symbolMetrics = [...graph.symbolMetrics.values()].map((m) => ({
    symbolId: m.symbolId,
    name: m.name,
    file: m.file,
    fanIn: m.fanIn,
    fanOut: m.fanOut,
    pageRank: m.pageRank,
    betweenness: m.betweenness,
  }));

  return NextResponse.json({ symbolNodes, callEdges, symbolMetrics });
}
