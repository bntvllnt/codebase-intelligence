import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { getCacheKey, INDEX_DIR_NAME } from "../src/persistence/cache-key.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    encoding: "utf-8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function initRepo(dir: string): string {
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base", "--no-gpg-sign"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

function cacheKey(dir: string, headHash: string): string {
  return getCacheKey(dir, { headHash, cliVersion: "test-version" });
}

describe("cache key", () => {
  it("ignores generated index files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cache-key-index-"));
    try {
      fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n");
      const headHash = initRepo(dir);
      const before = cacheKey(dir, headHash);

      const indexDir = path.join(dir, INDEX_DIR_NAME);
      fs.mkdirSync(indexDir);
      fs.writeFileSync(path.join(indexDir, "graph.json"), "{}\n");
      fs.writeFileSync(path.join(indexDir, "meta.json"), "{}\n");

      expect(cacheKey(dir, headHash)).toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when dirty tracked file content changes without HEAD changing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cache-key-dirty-"));
    try {
      const filePath = path.join(dir, "index.ts");
      fs.writeFileSync(filePath, "export const value = 1;\n");
      const headHash = initRepo(dir);
      const clean = cacheKey(dir, headHash);

      fs.writeFileSync(filePath, "export const value = 2;\n");
      const dirty = cacheKey(dir, headHash);
      expect(dirty).not.toBe(clean);
      expect(cacheKey(dir, headHash)).toBe(dirty);

      fs.writeFileSync(filePath, "export const value = 3;\n");
      expect(cacheKey(dir, headHash)).not.toBe(dirty);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when untracked source files appear without HEAD changing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cache-key-untracked-"));
    try {
      fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n");
      const headHash = initRepo(dir);
      const before = cacheKey(dir, headHash);

      fs.writeFileSync(path.join(dir, "extra.ts"), "export const extra = 2;\n");
      expect(cacheKey(dir, headHash)).not.toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when parser cache settings change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cache-key-config-"));
    const originalLimit = process.env.CBI_FULL_PROGRAM_FILE_LIMIT;
    try {
      fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n");
      const headHash = initRepo(dir);

      process.env.CBI_FULL_PROGRAM_FILE_LIMIT = "1500";
      const defaultLimit = cacheKey(dir, headHash);

      process.env.CBI_FULL_PROGRAM_FILE_LIMIT = "1";
      expect(cacheKey(dir, headHash)).not.toBe(defaultLimit);
    } finally {
      if (originalLimit === undefined) {
        delete process.env.CBI_FULL_PROGRAM_FILE_LIMIT;
      } else {
        process.env.CBI_FULL_PROGRAM_FILE_LIMIT = originalLimit;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
