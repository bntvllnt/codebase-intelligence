import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCodebaseGraph, type GraphLoadProgress } from "../src/graph-loader/index.js";
import { CANONICAL_INDEX_DIR_NAME } from "../src/persistence/cache-key.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    env: GIT_ENV,
    stdio: "ignore",
  });
}

function createRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-graph-loader-"));
  fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n", "utf-8");
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base", "--no-gpg-sign"]);
  return dir;
}

describe("graph-load pipeline", () => {
  it("emits progress, persists a graph, and reuses cache", () => {
    const repo = createRepo();
    try {
      const firstEvents: GraphLoadProgress[] = [];
      const first = loadCodebaseGraph({
        targetPath: repo,
        cliVersion: "test",
        force: true,
        persist: true,
        onProgress: (event) => firstEvents.push(event),
      });

      expect(first.fromCache).toBe(false);
      expect(first.graph.stats.totalFiles).toBe(1);
      expect(first.cacheFacts.cacheDir).toBe(path.join(repo, CANONICAL_INDEX_DIR_NAME));
      expect(firstEvents.map((event) => event.step)).toEqual([
        "parse-start",
        "parse-complete",
        "graph-built",
        "analysis-complete",
        "cache-saved",
      ]);
      expect(fs.existsSync(path.join(repo, CANONICAL_INDEX_DIR_NAME, "graph.json"))).toBe(true);

      const secondEvents: GraphLoadProgress[] = [];
      const second = loadCodebaseGraph({
        targetPath: repo,
        cliVersion: "test",
        persist: true,
        onProgress: (event) => secondEvents.push(event),
      });

      expect(second.fromCache).toBe(true);
      expect(second.graph.stats.totalFiles).toBe(first.graph.stats.totalFiles);
      expect(secondEvents.map((event) => event.step)).toEqual(["cache-hit"]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("can analyze without persisting a new graph", () => {
    const repo = createRepo();
    try {
      const result = loadCodebaseGraph({
        targetPath: repo,
        cliVersion: "test",
        force: true,
        persist: false,
      });

      expect(result.fromCache).toBe(false);
      expect(result.graph.stats.totalFiles).toBe(1);
      expect(fs.existsSync(path.join(repo, CANONICAL_INDEX_DIR_NAME))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
