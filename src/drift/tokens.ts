import { createHash } from "node:crypto";
import type { ContentDriftSeverity } from "./types.js";

const STOP_WORDS = new Set([
  "app",
  "by",
  "common",
  "config",
  "constant",
  "constants",
  "core",
  "data",
  "default",
  "file",
  "folder",
  "helper",
  "helpers",
  "index",
  "lib",
  "main",
  "manager",
  "module",
  "repo",
  "repository",
  "route",
  "routes",
  "scope",
  "server",
  "service",
  "shared",
  "src",
  "test",
  "tests",
  "type",
  "types",
  "util",
  "utilities",
  "utils",
]);

export const SIDE_EFFECT_TOKENS = new Set([
  "audit",
  "cache",
  "delete",
  "emit",
  "fetch",
  "insert",
  "log",
  "notify",
  "publish",
  "request",
  "save",
  "send",
  "store",
  "update",
  "write",
]);

export function hashId(parts: readonly string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 10);
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function stripExtension(file: string): string {
  return file
    .replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "")
    .replace(/\.d\.[cm]?ts$/, "")
    .replace(/\.[cm]?[jt]sx?$/, "");
}

export function basename(file: string): string {
  const normalized = normalizePath(file);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

export function dirname(file: string): string {
  const normalized = normalizePath(file);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? "" : normalized.slice(0, idx + 1);
}

export function scopeOf(file: string): string {
  const dir = dirname(file);
  return dir === "" ? "." : dir;
}

export function splitWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .map(normalizeToken)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function normalizeToken(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function firstWords(values: readonly string[], limit: number): string[] {
  return values.slice(0, limit);
}

function tokenSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

function overlapCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = tokenSet(right);
  return left.filter((token) => rightSet.has(token)).length;
}

export function hasOverlap(left: readonly string[], right: readonly string[]): boolean {
  return overlapCount(left, right) > 0;
}

export function dominantTokens(weighted: readonly string[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const token of weighted) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function scoreSeverity(score: number): ContentDriftSeverity {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}
