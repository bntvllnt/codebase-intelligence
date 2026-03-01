import path from "path";
import { parseCodebase } from "../../src/parser/index.js";
import { buildGraph, type BuiltGraph } from "../../src/graph/index.js";
import { analyzeGraph } from "../../src/analyzer/index.js";
import type { ParsedFile, CodebaseGraph } from "../../src/types/index.js";

const FIXTURE_SRC = path.resolve(__dirname, "../fixture-codebase/src");

export interface PipelineResult {
  parsedFiles: ParsedFile[];
  builtGraph: BuiltGraph;
  codebaseGraph: CodebaseGraph;
  fixtureSrcPath: string;
}

let cached: PipelineResult | undefined;

export function getFixtureSrcPath(): string {
  return FIXTURE_SRC;
}

export function getFixturePipeline(): PipelineResult {
  if (cached) return cached;

  const parsedFiles = parseCodebase(FIXTURE_SRC);
  const builtGraph = buildGraph(parsedFiles);
  const codebaseGraph = analyzeGraph(builtGraph, parsedFiles);

  cached = { parsedFiles, builtGraph, codebaseGraph, fixtureSrcPath: FIXTURE_SRC };
  return cached;
}

export function resetPipelineCache(): void {
  cached = undefined;
}
