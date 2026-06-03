import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterEach } from "vitest";

// End-to-end tests for the `check` command. Spawn the real compiled binary
// against real temp projects and assert exit codes + stdout. No mocking.
// Async execFile (not spawnSync) keeps the worker event loop responsive.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function run(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await pexec("node", [cli, ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
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

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(files: Record<string, string>, config?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-check-e2e-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  if (config !== undefined) {
    fs.writeFileSync(
      path.join(dir, "codebase-intelligence.json"),
      typeof config === "string" ? config : JSON.stringify(config),
    );
  }
  return dir;
}

const CLEAN = {
  "src/main.ts": "export function main(): number { return 1; }\n",
  "src/index.ts": 'import { main } from "./main.js";\nmain();\n',
};

const CIRCULAR = {
  "src/a.ts": 'import { b } from "./b.js";\nexport function a(): number { return b() + 1; }\n',
  "src/b.ts": 'import { a } from "./a.js";\nexport function b(): number { return a === undefined ? 0 : 1; }\n',
};

const DEAD = {
  "src/a.ts": 'import { used } from "./b.js";\nexport function a(): number { return used(); }\n',
  "src/b.ts": "export function used(): number { return 1; }\nexport function deadOne(): number { return 2; }\n",
};

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

describe("check command (e2e)", () => {
  it("exits 0 with 'No findings.' on a clean project", async () => {
    const dir = makeProject(CLEAN, { rules: {} });
    const { status, stdout } = await run(["check", dir]);
    expect(status).toBe(0);
    expect(stdout).toContain("No findings.");
  });

  it("exits 1 and prints the cycle on a circular dependency", async () => {
    const dir = makeProject(CIRCULAR, { rules: { "no-dead-exports": "off" } });
    const { status, stdout } = await run(["check", dir]);
    expect(status).toBe(1);
    expect(stdout).toContain("Circular dependency");
  });

  it("--json emits a parseable result with verdict + findings", async () => {
    const dir = makeProject(CIRCULAR, { rules: { "no-dead-exports": "off" } });
    const { status, stdout } = await run(["check", dir, "--json"]);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      verdict: string;
      findings: { ruleId: string }[];
      summary: { error: number };
    };
    expect(parsed.verdict).toBe("fail");
    expect(parsed.findings.some((f) => f.ruleId === "no-circular-deps")).toBe(true);
    expect(parsed.summary.error).toBeGreaterThanOrEqual(1);
  });

  it("--format sarif emits SARIF 2.1.0", async () => {
    const dir = makeProject(CIRCULAR, { rules: { "no-dead-exports": "off" } });
    const { stdout } = await run(["check", dir, "--format", "sarif"]);
    const sarif = JSON.parse(stdout) as { version: string; runs: { results: unknown[] }[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThanOrEqual(1);
  });

  it("flags an inline comment when no-comments is enabled (exit 1)", async () => {
    const dir = makeProject(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // trailing\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off", "no-circular-deps": "off" } },
    );
    const { status, stdout } = await run(["check", dir, "--json"]);
    expect(status).toBe(1);
    expect(stdout).toContain("no-comments");
  });

  it("honors a ci-ignore-next-line suppression", async () => {
    const dir = makeProject(
      { "src/x.ts": "export const x = 1;\n// ci-ignore-next-line no-comments\nexport const y = x; // hidden\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off", "no-circular-deps": "off" } },
    );
    const { status, stdout } = await run(["check", dir]);
    expect(status).toBe(0);
    expect(stdout).toContain("No findings.");
  });

  it("default failOn=error keeps a warn-only project green (exit 0)", async () => {
    const dir = makeProject(DEAD, { rules: { "no-circular-deps": "off" } });
    const { status } = await run(["check", dir]);
    expect(status).toBe(0);
  });

  it("--fail-on warn turns warnings into a failure (exit 1)", async () => {
    const dir = makeProject(DEAD, { rules: { "no-circular-deps": "off" } });
    const { status } = await run(["check", dir, "--fail-on", "warn"]);
    expect(status).toBe(1);
  });

  it("exits 2 with a config error on an invalid config", async () => {
    const dir = makeProject(CLEAN, { bogusKey: true });
    const { status, stderr } = await run(["check", dir]);
    expect(status).toBe(2);
    expect(stderr).toContain("Config error");
  });

  it("exits 2 on an invalid --format value", async () => {
    const dir = makeProject(CLEAN, { rules: {} });
    const { status, stderr } = await run(["check", dir, "--format", "xml"]);
    expect(status).toBe(2);
    expect(stderr).toContain("--format must be one of");
  });

  it("accepts an explicit --config path", async () => {
    const dir = makeProject(CIRCULAR);
    const cfg = path.join(dir, "custom.json");
    fs.writeFileSync(cfg, JSON.stringify({ rules: { "no-circular-deps": "off", "no-dead-exports": "off" } }));
    const { status, stdout } = await run(["check", dir, "--config", cfg]);
    expect(status).toBe(0);
    expect(stdout).toContain("No findings.");
  });
});
