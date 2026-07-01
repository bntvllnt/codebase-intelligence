import { execFile, execFileSync, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureMcp } from "./helpers/mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

const created: string[] = [];

beforeAll(() => {
  execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function run(args: readonly string[], cwd = repoRoot): Promise<RunResult> {
  try {
    const { stdout, stderr } = await pexec("node", [cli, ...args], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    return {
      status: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    stdio: "ignore",
  });
}

function makeProject(files: Record<string, string>, config?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-25-roadmap-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, "codebase-intelligence.json"), JSON.stringify(config, null, 2));
  }
  return dir;
}

function initGit(dir: string): void {
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
}

const FILES = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "Node16", moduleResolution: "Node16" } }),
  "src/a.ts": "import { b } from './b.js';\nexport function a(flag: boolean): number { if (flag) { return b(); } return 1; }\n",
  "src/b.ts": "export function b(): number { return 2; }\n",
  "src/secret.ts": "export const safe = 'ok';\n",
};

describe("2.5.0 remaining roadmap chained E2E", () => {
  it("CH-P2-06: ci gates new findings, writes SARIF, emits PR markdown, and records history", async () => {
    const dir = makeProject(FILES, {
      rules: {
        "no-circular-deps": "off",
        "no-dead-exports": "off",
        "no-comments": "off",
      },
    });
    initGit(dir);

    const sarifPath = "codebase-intelligence.sarif";
    const sarifRun = await run(["ci", dir, "--base", "HEAD", "--new-only", "--format", "sarif", "--output", sarifPath, "--force"]);
    expect(sarifRun.status).toBe(0);
    const sarif = JSON.parse(fs.readFileSync(path.join(dir, sarifPath), "utf-8")) as { version: string };
    expect(sarif.version).toBe("2.1.0");

    fs.writeFileSync(path.join(dir, "codebase-intelligence.json"), JSON.stringify({
      rules: { "no-circular-deps": "off", "no-dead-exports": "off", "no-comments": "warn" },
    }, null, 2));
    fs.writeFileSync(path.join(dir, "src/new.ts"), "export const added = 1;\n// new finding\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "add new finding"]);
    const failing = await run(["ci", dir, "--base", "HEAD~1", "--new-only", "--fail-on", "warn", "--format", "json", "--history", "--force"]);
    expect(failing.status).toBe(1);
    const ci = JSON.parse(failing.stdout) as { verdict: string; check: { findings: Array<{ ruleId: string; actions: unknown[] }> } };
    expect(ci.verdict).toBe("fail");
    expect(ci.check.findings.some((finding) => finding.ruleId === "no-comments")).toBe(true);
    expect(ci.check.findings.every((finding) => Array.isArray(finding.actions) && finding.actions.length > 0)).toBe(true);

    const comment = await run(["ci", dir, "--base", "HEAD~1", "--new-only", "--comment", "markdown", "--force"]);
    expect(comment.stdout).toContain("Codebase Intelligence CI");
    expect(comment.stdout).toContain("codebase-intelligence:ci-pr-comment-github");

    const history = await run(["history", dir, "--json"]);
    const parsedHistory = JSON.parse(history.stdout) as { entries: unknown[]; summary: string };
    expect(parsedHistory.entries.length).toBe(1);
    expect(parsedHistory.summary).toContain("run(s)");
  }, 120_000);

  it("CH-P2-07/08: doctor, check formats, secret actions, explain, hooks, config migration, and watch are machine-readable", async () => {
    const dir = makeProject(
      {
        ...FILES,
        "src/secret.ts": "export const apiKey = 'sk_test_12345678901234567890';\n",
      },
      {
        rules: {
          "no-circular-deps": "off",
          "no-dead-exports": "off",
          "no-secrets": "warn",
        },
      },
    );
    initGit(dir);

    const doctor = await run(["doctor", dir, "--profile", "agent", "--agent", "codex", "--json"]);
    expect([0, 1]).toContain(doctor.status);
    const doctorJson = JSON.parse(doctor.stdout) as { checks: Array<{ id: string; level: string; fix?: string }> };
    expect(doctorJson.checks.some((item) => item.id === "graph.build" && item.level === "pass")).toBe(true);
    expect(doctorJson.checks.some((item) => item.id === "agent.instructions" && item.fix)).toBe(true);

    const checkJson = await run(["check", dir, "--format", "json", "--force"]);
    const parsed = JSON.parse(checkJson.stdout) as { findings: Array<{ kind?: string; actions?: unknown[] }> };
    expect(parsed.findings.some((finding) => finding.kind === "secret-leak")).toBe(true);
    expect(parsed.findings.every((finding) => Array.isArray(finding.actions) && finding.actions.length > 0)).toBe(true);

    const annotations = await run(["check", dir, "--format", "annotations", "--force"]);
    expect(annotations.stdout).toContain("::warning");
    const badge = await run(["check", dir, "--format", "badge", "--force"]);
    expect(JSON.parse(badge.stdout)).toHaveProperty("schemaVersion", 1);
    const codeclimate = await run(["check", dir, "--format", "codeclimate", "--force"]);
    expect(Array.isArray(JSON.parse(codeclimate.stdout))).toBe(true);

    const explanation = await run(["explain", "no-secrets", "--json"]);
    expect(JSON.parse(explanation.stdout)).toMatchObject({ ruleId: "no-secrets", found: true });

    const migration = await run(["migrate-config", dir, "--json"]);
    expect(JSON.parse(migration.stdout)).toMatchObject({ dryRun: true, changed: false });

    const hooksPlan = await run(["hooks", "install", dir, "--json"]);
    expect(JSON.parse(hooksPlan.stdout)).toMatchObject({ action: "planned", dryRun: true });
    const hooksApply = await run(["hooks", "install", dir, "--apply", "--json"]);
    expect(JSON.parse(hooksApply.stdout)).toMatchObject({ action: "installed", dryRun: false });
    expect(fs.existsSync(path.join(dir, ".git/hooks/pre-commit"))).toBe(true);

    const watch = await run(["watch", dir, "--once", "--json", "--force"]);
    expect(JSON.parse(watch.stdout)).toMatchObject({ status: "ready", cacheUpdated: true });
  }, 120_000);

  it("CH-P3/P4: cognitive metrics, ownership, architecture, LSP, and workspace scopes are exposed via CLI and MCP", async () => {
    const dir = makeProject({
      "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "Node16", moduleResolution: "Node16" } }),
      "CODEOWNERS": "packages/app/ @app-team\npackages/core/ @core-team\n",
      "packages/app/package.json": JSON.stringify({ name: "@fixture/app", dependencies: { "@fixture/core": "workspace:*" } }),
      "packages/app/src/index.ts": "import { core } from '@fixture/core';\nexport function app(flag: boolean): string { if (flag) { for (const x of [1]) { if (x) return core(); } } return 'app'; }\n",
      "packages/core/package.json": JSON.stringify({ name: "@fixture/core" }),
      "packages/core/src/index.ts": "export function core(): string { return 'core'; }\n",
    });
    initGit(dir);
    fs.writeFileSync(path.join(dir, "packages/app/src/feature.ts"), "export const feature = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "change app workspace"]);

    const hotspots = await run(["hotspots", dir, "--metric", "cognitive_complexity", "--json", "--force"]);
    expect(JSON.parse(hotspots.stdout)).toHaveProperty("metric", "cognitive_complexity");

    const fileContext = await run(["file", dir, "packages/app/src/index.ts", "--json", "--force"]);
    const fileJson = JSON.parse(fileContext.stdout) as { metrics: { cognitiveComplexity: number } };
    expect(fileJson.metrics.cognitiveComplexity).toBeGreaterThan(0);

    const owners = await run(["owners", dir, "--group-by", "owner", "--json", "--force"]);
    const ownerJson = JSON.parse(owners.stdout) as { groups: Array<{ key: string; busFactor: number }> };
    expect(ownerJson.groups.some((group) => group.key.includes("@app-team"))).toBe(true);

    const architecture = await run(["architecture", dir, "--json", "--force"]);
    const archJson = JSON.parse(architecture.stdout) as { recommendations: Array<{ effort: string; contextPack: unknown }> };
    expect(Array.isArray(archJson.recommendations)).toBe(true);

    const lsp = await run(["lsp", dir, "--diagnostics", "--json", "--force"]);
    const lspJson = JSON.parse(lsp.stdout) as { diagnostics: unknown[]; hovers: unknown[] };
    expect(Array.isArray(lspJson.diagnostics)).toBe(true);
    expect(lspJson.hovers.length).toBeGreaterThan(0);

    const workspaces = await run(["workspaces", dir, "--base", "HEAD~1", "--changed", "--json", "--force"]);
    const workspaceJson = JSON.parse(workspaces.stdout) as { workspaces: Array<{ name: string; changed: boolean }>; crossPackageCycles: string[][] };
    expect(workspaceJson.workspaces.some((workspace) => workspace.name === "@fixture/app" && workspace.changed)).toBe(true);
    expect(Array.isArray(workspaceJson.crossPackageCycles)).toBe(true);

    const ciWorkspaces = await run(["ci", dir, "--base", "HEAD~1", "--new-only", "--changed-workspaces", "--format", "json", "--force"]);
    const ciWorkspaceJson = JSON.parse(ciWorkspaces.stdout) as { workspaces?: { workspaces: Array<{ name: string; changed: boolean }>; crossPackageCycles: string[][] } };
    expect(ciWorkspaceJson.workspaces?.workspaces.some((workspace) => workspace.name === "@fixture/app" && workspace.changed)).toBe(true);
    expect(Array.isArray(ciWorkspaceJson.workspaces?.crossPackageCycles)).toBe(true);

    const mcp = await createFixtureMcp(dir);
    expect(await mcp.callTool("get_ownership", { groupBy: "directory" })).toHaveProperty("groups");
    expect(await mcp.callTool("get_architecture_recommendations")).toHaveProperty("recommendations");
    expect(await mcp.callTool("get_lsp_snapshot")).toHaveProperty("diagnostics");
    expect(await mcp.callTool("get_workspaces", { base: "HEAD", changedOnly: false })).toHaveProperty("workspaces");
  }, 120_000);
});
