import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { analyzeGraph } from "../analyzer/index.js";
import { buildGraph } from "../graph/index.js";
import { parseCodebase } from "../parser/index.js";
import { getCacheKey } from "../persistence/cache-key.js";
import {
  getCacheFacts,
  prepareIndexDirectory,
  type IndexDirectoryResolution,
} from "../persistence/index-dir.js";
import { exportGraph, importGraph } from "../persistence/index.js";
import { setIndexedHead, setRoot } from "../server/graph-store.js";
import type { CacheFacts, CodebaseGraph, ParsedFile } from "../types/index.js";

export type GraphLoadProgress =
  | { step: "migration"; message: string; resolution: IndexDirectoryResolution }
  | { step: "cache-hit"; message: string; headHash: string; indexDir: string }
  | { step: "parse-start"; message: string; targetPath: string }
  | { step: "parse-complete"; message: string; fileCount: number }
  | { step: "graph-built"; message: string; fileCount: number; functionCount: number; dependencyCount: number }
  | { step: "analysis-complete"; message: string; circularDependencyCount: number; tensionFileCount: number }
  | { step: "cache-saved"; message: string; indexDir: string };

interface GraphLoadOptions {
  targetPath: string;
  cliVersion: string;
  force?: boolean;
  persist?: boolean;
  onProgress?: (event: GraphLoadProgress) => void;
}

interface GraphLoadResult {
  graph: CodebaseGraph;
  headHash: string;
  cacheFacts: CacheFacts;
  indexDir: string;
  cacheKey: string;
  fromCache: boolean;
}

interface GraphCachePreparation {
  cacheFacts: CacheFacts;
  indexDir: string;
  resolution: IndexDirectoryResolution;
}

export class GraphLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphLoadError";
  }
}

interface ProgressOptions {
  onProgress?: (event: GraphLoadProgress) => void;
}

function emit(options: ProgressOptions, event: GraphLoadProgress): void {
  options.onProgress?.(event);
}

function getHeadHash(targetPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: path.resolve(targetPath),
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function reportIndexMigration(options: ProgressOptions, resolution: IndexDirectoryResolution): void {
  if (resolution.migration === "migrated-legacy") {
    emit(options, {
      step: "migration",
      message: `Migrated legacy index ${resolution.legacyDir} to ${resolution.canonicalDir}`,
      resolution,
    });
  }
  if (resolution.migration === "ignored-legacy") {
    emit(options, {
      step: "migration",
      message: `Using ${resolution.canonicalDir}; legacy index remains at ${resolution.legacyDir}`,
      resolution,
    });
  }
}

/**
 * Resolve the active cache directory, including safe legacy migration.
 *
 * @param options - Target path and optional progress callback.
 * @returns Active cache directory and JSON cache facts.
 */
export function prepareGraphCache(options: Pick<GraphLoadOptions, "targetPath" | "onProgress">): GraphCachePreparation {
  const resolution = prepareIndexDirectory(options.targetPath);
  reportIndexMigration(options, resolution);
  return {
    cacheFacts: getCacheFacts(resolution),
    indexDir: resolution.activeDir,
    resolution,
  };
}

function parseFiles(targetPath: string): ParsedFile[] {
  try {
    return parseCodebase(targetPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GraphLoadError(message);
  }
}

/**
 * Load, analyze, and optionally persist a graph through the shared cache pipeline.
 *
 * @param options - Target path, CLI version, cache behavior, and progress callback.
 * @returns Loaded graph plus cache metadata.
 */
export function loadCodebaseGraph(options: GraphLoadOptions): GraphLoadResult {
  const resolved = path.resolve(options.targetPath);
  if (!fs.existsSync(resolved)) {
    throw new GraphLoadError(`Path does not exist: ${options.targetPath}`);
  }

  setRoot(resolved);

  const cache = prepareGraphCache(options);
  const cacheFacts = cache.cacheFacts;
  const indexDir = cache.indexDir;
  const headHash = getHeadHash(options.targetPath);
  const cacheKey = getCacheKey(options.targetPath, { headHash, cliVersion: options.cliVersion });

  if (options.force !== true && headHash !== "unknown") {
    const cached = importGraph(indexDir);
    if (cached?.headHash === headHash && cached.cacheKey === cacheKey) {
      emit(options, {
        step: "cache-hit",
        message: `Using cached index (HEAD: ${headHash.slice(0, 7)})`,
        headHash,
        indexDir,
      });
      setIndexedHead(cached.headHash);
      return { graph: cached.graph, headHash, cacheFacts, indexDir, cacheKey, fromCache: true };
    }
  }

  emit(options, {
    step: "parse-start",
    message: `Parsing ${options.targetPath}...`,
    targetPath: options.targetPath,
  });
  const files = parseFiles(options.targetPath);
  emit(options, {
    step: "parse-complete",
    message: `Parsed ${files.length} files`,
    fileCount: files.length,
  });

  if (files.length === 0) {
    throw new GraphLoadError(`No TypeScript files found at ${options.targetPath}`);
  }

  const built = buildGraph(files);
  const fileCount = built.nodes.filter((node) => node.type === "file").length;
  const functionCount = built.nodes.filter((node) => node.type === "function").length;
  emit(options, {
    step: "graph-built",
    message: `Built graph: ${fileCount} files, ${functionCount} functions, ${built.edges.length} dependencies`,
    fileCount,
    functionCount,
    dependencyCount: built.edges.length,
  });

  const graph = analyzeGraph(built, files);
  emit(options, {
    step: "analysis-complete",
    message: `Analysis complete: ${graph.stats.circularDeps.length} circular deps, ${graph.forceAnalysis.tensionFiles.length} tension files`,
    circularDependencyCount: graph.stats.circularDeps.length,
    tensionFileCount: graph.forceAnalysis.tensionFiles.length,
  });

  setIndexedHead(headHash);

  if (options.persist === true) {
    exportGraph(graph, indexDir, headHash, cacheKey);
    emit(options, {
      step: "cache-saved",
      message: `Index saved to ${indexDir}`,
      indexDir,
    });
  }

  return { graph, headHash, cacheFacts, indexDir, cacheKey, fromCache: false };
}
