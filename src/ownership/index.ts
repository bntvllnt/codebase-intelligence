import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { CodebaseGraph } from "../types/index.js";

export type OwnershipGroupBy = "owner" | "package" | "directory";

export interface OwnershipOptions {
  groupBy?: OwnershipGroupBy;
  effort?: number;
}

export interface OwnershipFile {
  file: string;
  owner: string;
  package: string;
  directory: string;
  churn: number;
  riskScore: number;
  busFactor: number;
  hasTests: boolean;
  coverageGap: boolean;
  evidence: string[];
}

export interface OwnershipGroup {
  key: string;
  files: number;
  owners: string[];
  busFactor: number;
  riskScore: number;
  churn: number;
  coverageGaps: number;
  evidence: string[];
}

export interface OwnershipResult {
  groupBy: OwnershipGroupBy;
  summary: string;
  files: OwnershipFile[];
  groups: OwnershipGroup[];
  hotspots: OwnershipGroup[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function packageNameFor(rootDir: string, file: string): string {
  let dir = path.dirname(path.resolve(rootDir, file));
  const root = path.resolve(rootDir);
  while (dir.startsWith(root)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (parsed && typeof parsed === "object" && "name" in parsed && typeof (parsed as { name?: unknown }).name === "string") {
          return (parsed as { name: string }).name;
        }
      } catch {
        return normalizePath(path.relative(root, dir)) || ".";
      }
      return normalizePath(path.relative(root, dir)) || ".";
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return ".";
}

function parseCodeowners(rootDir: string): Array<{ pattern: string; owners: string[] }> {
  const candidates = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];
  const file = candidates.map((candidate) => path.join(rootDir, candidate)).find((candidate) => fs.existsSync(candidate));
  if (!file) return [];
  return fs.readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern: normalizePath(pattern.replace(/^\//, "")), owners };
    })
    .filter((entry) => entry.owners.length > 0);
}

function codeownerFor(file: string, entries: Array<{ pattern: string; owners: string[] }>): string {
  let owner = "unowned";
  for (const entry of entries) {
    const pattern = entry.pattern.replace(/\*.*$/, "");
    if (entry.pattern === "*" || file.startsWith(pattern) || file === pattern) {
      owner = entry.owners.join(",");
    }
  }
  return owner;
}

function blameAuthors(rootDir: string, file: string): Set<string> {
  try {
    const output = execFileSync("git", ["log", "--format=%an", "--", file], {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function groupKey(file: OwnershipFile, groupBy: OwnershipGroupBy): string {
  if (groupBy === "owner") return file.owner;
  if (groupBy === "package") return file.package;
  return file.directory;
}

export function computeOwnership(graph: CodebaseGraph, rootDir: string, options: OwnershipOptions = {}): OwnershipResult {
  const groupBy = options.groupBy ?? "owner";
  const minEffort = options.effort ?? 0;
  const owners = parseCodeowners(rootDir);
  const files: OwnershipFile[] = [];

  for (const node of graph.nodes.filter((item) => item.type === "file")) {
    const metrics = graph.fileMetrics.get(node.id);
    if (!metrics || metrics.isTestFile) continue;
    const authors = blameAuthors(rootDir, node.id);
    const owner = codeownerFor(node.id, owners);
    const pkg = packageNameFor(rootDir, node.id);
    const directory = normalizePath(path.dirname(node.id));
    const busFactor = Math.max(authors.size, owner === "unowned" ? 0 : owner.split(",").length);
    const coverageGap = !metrics.hasTests && (metrics.fanIn > 0 || metrics.blastRadius > 0 || metrics.cyclomaticComplexity >= 5);
    const riskScore = metrics.cyclomaticComplexity + metrics.churn + metrics.blastRadius + metrics.fanIn + (coverageGap ? 5 : 0);
    files.push({
      file: node.id,
      owner,
      package: pkg,
      directory,
      churn: metrics.churn,
      riskScore,
      busFactor,
      hasTests: metrics.hasTests,
      coverageGap,
      evidence: [
        `owner=${owner}`,
        `authors=${String(authors.size)}`,
        `package=${pkg}`,
        `risk=${riskScore.toFixed(2)}`,
        `coverageGap=${String(coverageGap)}`,
      ],
    });
  }

  const grouped = new Map<string, OwnershipFile[]>();
  for (const file of files.filter((item) => item.riskScore >= minEffort)) {
    const key = groupKey(file, groupBy);
    const list = grouped.get(key) ?? [];
    list.push(file);
    grouped.set(key, list);
  }

  const groups: OwnershipGroup[] = [...grouped.entries()]
    .map(([key, groupFiles]) => {
      const ownersForGroup = [...new Set(groupFiles.map((file) => file.owner))].sort();
      const riskScore = groupFiles.reduce((sum, file) => sum + file.riskScore, 0);
      const churn = groupFiles.reduce((sum, file) => sum + file.churn, 0);
      const busFactor = Math.max(...groupFiles.map((file) => file.busFactor), 0);
      const coverageGaps = groupFiles.filter((file) => file.coverageGap).length;
      return {
        key,
        files: groupFiles.length,
        owners: ownersForGroup,
        busFactor,
        riskScore: Math.round(riskScore * 100) / 100,
        churn,
        coverageGaps,
        evidence: [`files=${String(groupFiles.length)}`, `owners=${ownersForGroup.join(",")}`, `busFactor=${String(busFactor)}`, `coverageGaps=${String(coverageGaps)}`],
      };
    })
    .sort((left, right) => right.riskScore - left.riskScore || left.key.localeCompare(right.key));

  return {
    groupBy,
    summary: `${groups.length} ${groupBy} group(s); top risk ${groups[0]?.key ?? "none"}.`,
    files: files.sort((left, right) => right.riskScore - left.riskScore || left.file.localeCompare(right.file)),
    groups,
    hotspots: groups.slice(0, 10),
  };
}

export function formatOwnershipText(result: OwnershipResult): string {
  const lines = [`Ownership grouped by ${result.groupBy}`, result.summary, ""];
  for (const group of result.hotspots) {
    lines.push(`${group.key}: ${String(group.files)} file(s), risk ${group.riskScore.toFixed(2)}, bus factor ${String(group.busFactor)}, coverage gaps ${String(group.coverageGaps)}`);
  }
  return lines.join("\n");
}
