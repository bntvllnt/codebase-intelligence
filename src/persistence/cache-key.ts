import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { getFullProgramFileLimit } from "../parser/index.js";

export const INDEX_DIR_NAME = ".code-visualizer";

const CACHE_SCHEMA_VERSION = 3;
const CACHE_FINGERPRINT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  INDEX_DIR_NAME,
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  ".worktrees",
  ".claude/worktrees",
];

interface CacheKeyOptions {
  headHash: string;
  cliVersion: string;
}

function hashValue(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitNullDelimited(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function getGitRoot(targetPath: string): string | null {
  try {
    return gitOutput(path.resolve(targetPath), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

function isFingerprintIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return CACHE_FINGERPRINT_IGNORE_PATTERNS.some(
    (pattern) => normalized === pattern || normalized.startsWith(`${pattern}/`) || normalized.includes(`/${pattern}/`),
  );
}

function statusEntries(status: string): string[] {
  const parts = splitNullDelimited(status);
  const entries: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    const code = record.slice(0, 2);
    const firstPath = record.slice(3);

    if (code.startsWith("R") || code.startsWith("C")) {
      const secondPath = parts[i + 1] ?? "";
      i++;
      if (!isFingerprintIgnoredPath(firstPath) && !isFingerprintIgnoredPath(secondPath)) entries.push(`${record}\0${secondPath}`);
      continue;
    }

    if (!isFingerprintIgnoredPath(firstPath)) entries.push(record);
  }

  return entries.sort();
}

function hashFileIfPresent(root: string, relativePath: string): string {
  if (isFingerprintIgnoredPath(relativePath)) return `${relativePath}:ignored`;

  const absolutePath = path.join(root, relativePath);
  try {
    if (!fs.existsSync(absolutePath)) return `${relativePath}:missing`;
    if (!fs.statSync(absolutePath).isFile()) return `${relativePath}:non-file`;
    return `${relativePath}:${hashValue(fs.readFileSync(absolutePath))}`;
  } catch {
    return `${relativePath}:unreadable`;
  }
}

function getWorktreeFingerprint(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const gitRoot = getGitRoot(resolved);
  if (!gitRoot) return "no-git";

  const relativeTarget = path.relative(gitRoot, resolved).replaceAll(path.sep, "/");
  const pathspec = relativeTarget === "" ? "." : relativeTarget;

  try {
    const status = statusEntries(gitOutput(gitRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", pathspec]));
    const changedTracked = splitNullDelimited(gitOutput(gitRoot, ["diff", "--name-only", "-z", "HEAD", "--", pathspec]));
    const untracked = splitNullDelimited(gitOutput(gitRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec]));
    const contentFingerprints = [...new Set([...changedTracked, ...untracked])]
      .filter((filePath) => !isFingerprintIgnoredPath(filePath))
      .sort()
      .map((filePath) => hashFileIfPresent(gitRoot, filePath));

    return hashValue(JSON.stringify({ status, contentFingerprints }));
  } catch {
    return "unknown-worktree";
  }
}

export function getCacheKey(targetPath: string, options: CacheKeyOptions): string {
  return hashValue(
    JSON.stringify({
      cacheSchemaVersion: CACHE_SCHEMA_VERSION,
      cliVersion: options.cliVersion,
      fullProgramFileLimit: getFullProgramFileLimit(),
      headHash: options.headHash,
      worktreeFingerprint: getWorktreeFingerprint(targetPath),
    }),
  );
}
