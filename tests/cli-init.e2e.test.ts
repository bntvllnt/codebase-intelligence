import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { DEFAULT_MARKERS, renderSkill } from "../src/install/index.js";

// End-to-end tests for the `init` command lifecycle. These spawn the real
// compiled binary (dist/cli.js) — the CLI action handler is excluded from
// coverage and otherwise untested. Black-box: assert exit codes, stdout/stderr,
// and the files actually written to disk. No mocking of own code.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the compiled CLI with a sandboxed HOME so the global skill never
 * touches the developer's real home directory. */
function run(args: readonly string[], home: string): RunResult {
  const res = spawnSync("node", [cli, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf-8",
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

describe("codebase-intelligence --help", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ci-help-home-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("renders the command list exactly once (no duplicated help)", () => {
    const { stdout, status } = run(["--help"], home);
    expect(status).toBe(0);
    expect(stdout.split("Commands:").length - 1).toBe(1);
  });

  it("lists the init command exactly once", () => {
    const { stdout } = run(["--help"], home);
    const initLines = stdout.split("\n").filter((line) => /^\s+init\b/.test(line));
    expect(initLines).toHaveLength(1);
  });

  it("does not claim the skill installs by default (opt-in since #36)", () => {
    const { stdout } = run(["--help"], home);
    expect(stdout).not.toContain("writes agent instruction files + skill");
  });

  it("preserves the MCP-mode and Try hints", () => {
    const { stdout } = run(["--help"], home);
    expect(stdout).toContain("MCP mode");
    expect(stdout).toContain("Try: codebase-intelligence overview");
  });
});

describe("init lifecycle (e2e)", () => {
  let repo: string;
  let home: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ci-init-repo-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ci-init-home-"));
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const read = (rel: string): string => fs.readFileSync(path.join(repo, rel), "utf-8");
  const exists = (rel: string): boolean => fs.existsSync(path.join(repo, rel));

  it("--json writes the default agents and emits parseable JSON", () => {
    const { status, stdout } = run(["init", "--json", repo], home);
    expect(status).toBe(0);

    const parsed = JSON.parse(stdout) as {
      repoFiles: { path: string; action: string }[];
      skill: unknown;
    };
    expect(parsed.repoFiles.map((r) => r.path).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(parsed.repoFiles.every((r) => r.action === "created")).toBe(true);
    expect(parsed.skill).toBeNull();

    expect(read("AGENTS.md")).toContain(DEFAULT_MARKERS.start);
    expect(read("CLAUDE.md")).toContain("Codebase Intelligence");
  });

  it("default (non-TTY) run writes AGENTS.md + CLAUDE.md only", () => {
    const { status, stdout } = run(["init", repo], home);
    expect(status).toBe(0);
    expect(stdout).toContain("created");
    expect(exists("AGENTS.md")).toBe(true);
    expect(exists("CLAUDE.md")).toBe(true);
    expect(exists("GEMINI.md")).toBe(false);
  });

  it("TTY picker confirms default agents on enter", () => {
    const command = `node ${JSON.stringify(cli)} init ${JSON.stringify(repo)}`;
    const result = spawnSync("script", ["-qfec", command, "/dev/null"], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      input: "\n",
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Select what to set up");
    expect(result.stdout).toContain("created   AGENTS.md");
    expect(result.stdout).toContain("created   CLAUDE.md");
    expect(exists("AGENTS.md")).toBe(true);
    expect(exists("CLAUDE.md")).toBe(true);
    expect(exists("GEMINI.md")).toBe(false);
  });

  it("--all writes every agent file", () => {
    const { status } = run(["init", "--all", repo], home);
    expect(status).toBe(0);
    for (const rel of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "CONVENTIONS.md",
      path.join(".cursor", "rules", "codebase-intelligence.mdc"),
      path.join(".github", "copilot-instructions.md"),
    ]) {
      expect(exists(rel)).toBe(true);
    }
  });

  it("--agents writes only the listed agents", () => {
    const { status } = run(["init", "--agents", "claude,cursor", repo], home);
    expect(status).toBe(0);
    expect(exists("CLAUDE.md")).toBe(true);
    expect(exists(path.join(".cursor", "rules", "codebase-intelligence.mdc"))).toBe(true);
    expect(exists("AGENTS.md")).toBe(false);
    expect(exists("GEMINI.md")).toBe(false);
  });

  it("--agents with an unknown id exits 2 and names the offender", () => {
    const { status, stderr } = run(["init", "--agents", "claude,bogus", repo], home);
    expect(status).toBe(2);
    expect(stderr).toContain("Unknown agents: bogus");
    expect(exists("CLAUDE.md")).toBe(false);
  });

  it("--agents with an empty list writes nothing", () => {
    const { status, stdout } = run(["init", "--agents", "", repo], home);
    expect(status).toBe(0);
    expect(stdout).toContain("Nothing selected");
    expect(fs.readdirSync(repo)).toHaveLength(0);
  });

  it("is idempotent — a second run reports unchanged", () => {
    run(["init", repo], home);
    const before = read("AGENTS.md");

    const { status, stdout } = run(["init", repo], home);
    expect(status).toBe(0);
    expect(stdout).toContain("unchanged");
    expect(stdout).not.toContain("created");
    expect(read("AGENTS.md")).toBe(before);
  });

  it("exits 1 when the target path does not exist", () => {
    const missing = path.join(os.tmpdir(), "ci-init-missing-zzz-do-not-create");
    const { status, stderr } = run(["init", missing], home);
    expect(status).toBe(1);
    expect(stderr).toContain("Path does not exist");
  });

  it("--skill installs the global skill into HOME (opt-in)", () => {
    const { status } = run(["init", "--agents", "claude", "--skill", repo], home);
    expect(status).toBe(0);

    const skillPath = path.join(home, ".claude", "skills", "codebase-intelligence", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toBe(renderSkill());
  });

  it("does not install the skill unless asked", () => {
    run(["init", "--all", repo], home);
    const skillPath = path.join(home, ".claude", "skills", "codebase-intelligence", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(false);
  });
});
