import fs from "fs";
import path from "path";

export type CoverageSource = "istanbul" | "static-tests";

export interface CoverageLookup {
  source: CoverageSource;
  files: Map<string, number>;
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFilePath(value: string): string {
  return value.split(path.sep).join("/");
}

function statementCoverage(entry: unknown): number | undefined {
  if (!isRecord(entry) || !isRecord(entry.s)) return undefined;
  const counts = Object.values(entry.s).filter((value): value is number => typeof value === "number");
  if (counts.length === 0) return undefined;
  const covered = counts.filter((count) => count > 0).length;
  return covered / counts.length;
}

function normalizeCoverageKey(rootDir: string, key: string): string {
  const absolute = path.isAbsolute(key) ? key : path.resolve(rootDir, key);
  return normalizeFilePath(path.relative(rootDir, absolute));
}

function readCoverageCandidate(rootDir: string, candidate: string): CoverageLookup | undefined {
  const filePath = path.join(rootDir, candidate);
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!isRecord(parsed)) {
      return { source: "static-tests", files: new Map(), warning: `${candidate} is not a JSON object` };
    }

    const files = new Map<string, number>();
    for (const [key, entry] of Object.entries(parsed)) {
      const coverage = statementCoverage(entry);
      if (coverage === undefined) continue;
      files.set(normalizeCoverageKey(rootDir, key), coverage);
    }

    if (files.size === 0) {
      return { source: "static-tests", files, warning: `${candidate} has no Istanbul statement counts` };
    }

    return { source: "istanbul", files };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { source: "static-tests", files: new Map(), warning: `${candidate} could not be read: ${message}` };
  }
}

export function loadCoverage(rootDir?: string): CoverageLookup {
  if (!rootDir) return { source: "static-tests", files: new Map() };

  const resolvedRoot = path.resolve(rootDir);
  for (const candidate of ["coverage/coverage-final.json", "coverage/coverage.json"]) {
    const lookup = readCoverageCandidate(resolvedRoot, candidate);
    if (lookup) return lookup;
  }

  return { source: "static-tests", files: new Map() };
}
