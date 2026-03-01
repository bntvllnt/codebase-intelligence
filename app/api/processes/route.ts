import { NextResponse } from "next/server";
import { getGraph } from "@/src/server/graph-store";

export function GET(): NextResponse {
  const graph = getGraph();

  return NextResponse.json({
    processes: graph.processes,
    stats: {
      totalProcesses: graph.processes.length,
      maxDepth: graph.processes.reduce((max, p) => Math.max(max, p.depth), 0),
    },
  });
}
