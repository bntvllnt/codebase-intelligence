import fs from "fs";
import path from "path";
import type { CheckResult } from "../types/index.js";

export interface FindingHistoryEntry {
  timestamp: string;
  verdict: CheckResult["verdict"];
  summary: CheckResult["summary"];
  fingerprints: string[];
}

export interface FindingHistoryResult {
  path: string;
  entries: FindingHistoryEntry[];
  trend: {
    previous?: number;
    current?: number;
    delta?: number;
  };
  summary: string;
}

function historyPath(rootDir: string): string {
  return path.join(rootDir, ".codebase-intelligence", "history.json");
}

function readEntries(file: string): FindingHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed.filter((item): item is FindingHistoryEntry => item !== null && typeof item === "object" && "timestamp" in item) : [];
  } catch {
    return [];
  }
}

export function recordFindingHistory(rootDir: string, result: CheckResult): FindingHistoryResult {
  const file = historyPath(rootDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries = readEntries(file);
  entries.push({
    timestamp: new Date().toISOString(),
    verdict: result.verdict,
    summary: result.summary,
    fingerprints: result.findings.map((finding) => finding.fingerprint).sort(),
  });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  return readFindingHistory(rootDir);
}

export function readFindingHistory(rootDir: string): FindingHistoryResult {
  const file = historyPath(rootDir);
  const entries = readEntries(file);
  const previous = entries.at(-2)?.fingerprints.length;
  const current = entries.at(-1)?.fingerprints.length;
  const delta = previous !== undefined && current !== undefined ? current - previous : undefined;
  return {
    path: file,
    entries,
    trend: { previous, current, delta },
    summary: entries.length === 0 ? "No local finding history yet." : `${String(entries.length)} run(s), latest finding count ${String(current ?? 0)}.`,
  };
}

export function formatFindingHistoryText(result: FindingHistoryResult): string {
  const delta = result.trend.delta === undefined ? "n/a" : String(result.trend.delta);
  return `${result.summary}\npath=${result.path}\ndelta=${delta}`;
}
