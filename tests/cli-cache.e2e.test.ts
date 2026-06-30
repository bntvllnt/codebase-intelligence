import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CANONICAL_INDEX_DIR_NAME, LEGACY_INDEX_DIR_NAME } from "../src/persistence/cache-key.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("node", [cli, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf-8",
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cache-e2e-"));
  fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n", "utf-8");
  return dir;
}

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

describe("cache CLI lifecycle", () => {
  it("writes canonical cache, reports status, and cleans canonical cache", () => {
    const repo = fixtureRepo();
    try {
      const overview = run(["overview", repo, "--json", "--force"]);
      expect(overview.status).toBe(0);
      expect(fs.existsSync(path.join(repo, CANONICAL_INDEX_DIR_NAME, "graph.json"))).toBe(true);
      expect(fs.existsSync(path.join(repo, LEGACY_INDEX_DIR_NAME))).toBe(false);

      const status = run([repo, "--status"]);
      expect(status.status).toBe(0);
      expect(status.stderr).toContain("Index status:");
      expect(status.stderr).toContain("Files:");

      fs.mkdirSync(path.join(repo, LEGACY_INDEX_DIR_NAME));
      const clean = run([repo, "--clean"]);
      expect(clean.status).toBe(0);
      expect(clean.stderr).toContain(CANONICAL_INDEX_DIR_NAME);
      expect(fs.existsSync(path.join(repo, CANONICAL_INDEX_DIR_NAME))).toBe(false);
      expect(fs.existsSync(path.join(repo, LEGACY_INDEX_DIR_NAME))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("migrates legacy cache directory before writing canonical cache", () => {
    const repo = fixtureRepo();
    try {
      const legacy = path.join(repo, LEGACY_INDEX_DIR_NAME);
      const canonical = path.join(repo, CANONICAL_INDEX_DIR_NAME);
      fs.mkdirSync(legacy);
      fs.writeFileSync(path.join(legacy, "marker.txt"), "legacy\n", "utf-8");

      const overview = run(["overview", repo, "--json", "--force"]);
      expect(overview.status).toBe(0);
      expect(overview.stderr).toContain("Migrated legacy index");
      expect(fs.existsSync(legacy)).toBe(false);
      expect(fs.readFileSync(path.join(canonical, "marker.txt"), "utf-8")).toBe("legacy\n");
      expect(fs.existsSync(path.join(canonical, "graph.json"))).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
