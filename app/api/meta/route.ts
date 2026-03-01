import { NextResponse } from "next/server";
import { getProjectName, getIndexedHead } from "@/src/server/graph-store";

export function GET(): NextResponse {
  const indexedHash = getIndexedHead();
  return NextResponse.json({
    projectName: getProjectName(),
    staleness: {
      stale: false,
      indexedHash,
    },
  });
}
