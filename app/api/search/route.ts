import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";
import { createSearchIndex, search, getSuggestions } from "@/src/search/index";

export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100) : 20;

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  const graph = getGraph();
  const index = createSearchIndex(graph);
  const results = search(index, query, limit);

  if (results.length === 0) {
    const suggestions = getSuggestions(index, query);
    return NextResponse.json({ query, results: [], suggestions });
  }

  const mapped = results.map((r) => ({
    file: r.file,
    score: r.score,
    symbols: r.symbols.map((s) => ({
      name: s.name,
      type: s.type,
      loc: s.loc,
      relevance: s.score,
    })),
  }));

  return NextResponse.json({ query, results: mapped });
}
