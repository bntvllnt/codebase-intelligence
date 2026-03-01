import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";
import { getHints } from "@/src/mcp/hints";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  return params.then(({ name: symbolName }) => {
    const graph = getGraph();

    const matches = [...graph.symbolMetrics.values()].filter(
      (m) => m.name === symbolName || m.symbolId.endsWith(`::${symbolName}`),
    );

    if (matches.length === 0) {
      return NextResponse.json(
        { error: `Symbol not found: ${symbolName}` },
        { status: 404 },
      );
    }

    const uniqueByFile = new Map<string, typeof matches[0]>();
    for (const m of matches) {
      if (!uniqueByFile.has(m.file)) {
        uniqueByFile.set(m.file, m);
      }
    }
    let deduped = [...uniqueByFile.values()];

    if (deduped.length > 1) {
      const nonBarrel = deduped.filter((m) => !m.file.endsWith("/index.ts") && m.file !== "index.ts");
      if (nonBarrel.length > 0) deduped = nonBarrel;
    }

    if (deduped.length > 1) {
      return NextResponse.json({
        disambiguation: deduped.map((m) => ({
          name: m.name,
          file: m.file,
          symbolId: m.symbolId,
          fanIn: m.fanIn,
          fanOut: m.fanOut,
        })),
      });
    }

    const sym = deduped[0];

    const callers = graph.callEdges
      .filter((e) => e.calleeSymbol === symbolName || e.target === sym.symbolId)
      .map((e) => ({ symbol: e.callerSymbol, file: e.source.split("::")[0] }));

    const callees = graph.callEdges
      .filter((e) => e.callerSymbol === symbolName || e.source === sym.symbolId)
      .map((e) => ({ symbol: e.calleeSymbol, file: e.target.split("::")[0] }));

    return NextResponse.json({
      name: sym.name,
      file: sym.file,
      fanIn: sym.fanIn,
      fanOut: sym.fanOut,
      callers,
      callees,
      nextSteps: getHints("symbol_context"),
    });
  });
}
