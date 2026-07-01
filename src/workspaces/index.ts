import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { CodebaseGraph } from "../types/index.js";

export interface WorkspaceInfo {
  name: string;
  path: string;
  files: number;
  changed: boolean;
  cycles: string[][];
  evidence: string[];
}

export interface WorkspacesResult {
  base: string;
  changedOnly: boolean;
  workspaces: WorkspaceInfo[];
  crossPackageCycles: string[][];
  summary: string;
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function packageJsonFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".codebase-intelligence") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === "package.json") results.push(full);
    }
  }
  walk(rootDir);
  return results;
}

function packageName(file: string): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object" && "name" in parsed && typeof (parsed as { name?: unknown }).name === "string") {
      return (parsed as { name: string }).name;
    }
  } catch {
    return path.basename(path.dirname(file));
  }
  return path.basename(path.dirname(file));
}

function changedFiles(rootDir: string, base: string): Set<string> {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "--relative", `${base}...HEAD`], {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return new Set(output.split("\n").map((line) => normalize(line.trim())).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

export function computeWorkspaces(graph: CodebaseGraph, rootDir: string, options: { base?: string; changedOnly?: boolean } = {}): WorkspacesResult {
  const base = options.base ?? "origin/main";
  const changed = changedFiles(rootDir, base);
  const workspaceRoots = packageJsonFiles(rootDir)
    .map((file) => ({ name: packageName(file), path: normalize(path.relative(rootDir, path.dirname(file))) || "." }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const workspaces = workspaceRoots.map((workspace) => {
    const files = graph.nodes.filter((node) => node.type === "file" && (workspace.path === "." || node.id.startsWith(`${workspace.path}/`)));
    const isChanged = [...changed].some((file) => workspace.path === "." ? !file.includes("/") : file.startsWith(`${workspace.path}/`));
    const cycles = graph.stats.circularDeps.filter((cycle) => cycle.some((file) => workspace.path === "." || file.startsWith(`${workspace.path}/`)));
    return {
      ...workspace,
      files: files.length,
      changed: isChanged,
      cycles,
      evidence: [`files=${String(files.length)}`, `changed=${String(isChanged)}`, `cycles=${String(cycles.length)}`],
    };
  });

  const filtered = options.changedOnly ? workspaces.filter((workspace) => workspace.changed) : workspaces;
  const workspaceForFile = (file: string): string => workspaces.find((workspace) => workspace.path !== "." && file.startsWith(`${workspace.path}/`))?.name ?? ".";
  const crossPackageCycles = graph.stats.circularDeps.filter((cycle) => new Set(cycle.map(workspaceForFile)).size > 1);
  return {
    base,
    changedOnly: options.changedOnly === true,
    workspaces: filtered,
    crossPackageCycles,
    summary: `${String(filtered.length)} workspace(s); ${String(workspaces.filter((workspace) => workspace.changed).length)} changed since ${base}; ${String(crossPackageCycles.length)} cross-package cycle(s).`,
  };
}

export function formatWorkspacesText(result: WorkspacesResult): string {
  const lines = ["Workspaces", result.summary, ""];
  for (const workspace of result.workspaces) {
    lines.push(`${workspace.name} ${workspace.path}: ${String(workspace.files)} file(s), changed=${String(workspace.changed)}, cycles=${String(workspace.cycles.length)}`);
  }
  return lines.join("\n");
}
