import fs from "fs";
import path from "path";
import type { CodebaseGraph } from "../types/index.js";

export interface WatchOptions {
  once?: boolean;
  debounceMs?: number;
}

export interface WatchSnapshot {
  status: "ready";
  files: number;
  dependencies: number;
  debounceMs: number;
  cacheUpdated: boolean;
  summary: string;
}

export function computeWatchSnapshot(graph: CodebaseGraph, options: WatchOptions = {}): WatchSnapshot {
  const debounceMs = options.debounceMs ?? 250;
  return {
    status: "ready",
    files: graph.stats.totalFiles,
    dependencies: graph.stats.totalDependencies,
    debounceMs,
    cacheUpdated: true,
    summary: `Watch ready for ${String(graph.stats.totalFiles)} files with ${String(debounceMs)}ms debounce.`,
  };
}

export function startWatch(rootDir: string, onChange: (file: string) => void, options: WatchOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  const watcher = fs.watch(path.resolve(rootDir), (_event, filename) => {
    if (!filename || (!filename.endsWith(".ts") && !filename.endsWith(".tsx"))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onChange(filename);
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}

export function formatWatchSnapshotText(snapshot: WatchSnapshot): string {
  return snapshot.summary;
}
