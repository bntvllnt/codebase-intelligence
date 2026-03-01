import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";

export function GET(): NextResponse {
  const graph = getGraph();
  return NextResponse.json({ groups: graph.groups });
}
