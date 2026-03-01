import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return params.then(({ path }) => {
    const graph = getGraph();
    const filePath = path.join("/");
    const metrics = graph.fileMetrics.get(filePath);
    if (!metrics) {
      return NextResponse.json(
        { error: `File not found in graph: ${filePath}` },
        { status: 404 },
      );
    }

    const node = graph.nodes.find((n) => n.id === filePath);
    const imports = graph.edges.filter((e) => e.source === filePath);
    const dependents = graph.edges.filter((e) => e.target === filePath);
    const functions = graph.nodes.filter((n) => n.parentFile === filePath);

    return NextResponse.json({
      path: filePath,
      loc: node?.loc ?? 0,
      module: node?.module ?? "",
      functions: functions.map((f) => {
        const symId = `${filePath}::${f.label}`;
        const symMetrics = graph.symbolMetrics.get(symId);
        return {
          name: f.label,
          loc: f.loc,
          fanIn: symMetrics?.fanIn ?? 0,
          fanOut: symMetrics?.fanOut ?? 0,
          pageRank: symMetrics?.pageRank ?? 0,
        };
      }),
      imports: imports.map((e) => ({ from: e.target, symbols: e.symbols })),
      dependents: dependents.map((e) => ({
        path: e.source,
        symbols: e.symbols,
      })),
      metrics,
    });
  });
}
