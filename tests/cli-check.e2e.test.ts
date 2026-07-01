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

const DEAD_CODE_EXPANSION = {
  "package.json": JSON.stringify(
    {
      name: "dead-code-fixture",
      exports: "./src/index.ts",
      dependencies: {
        "@sinclair/typebox": "1.0.0",
        "left-pad": "1.0.0",
        "unused-runtime": "1.0.0",
        vitest: "1.0.0",
      },
    },
    null,
    2,
  ),
  "src/index.ts": 'export { live } from "./live.js";\n',
  "src/live.ts": "export function live(): number { return 1; }\n",
  "src/orphan.ts": 'import { live } from "./live.js";\nexport const orphan = live();\n',
  "src/types.ts": [
    "type LocalDraft = { id: string };",
    "interface LocalView { title: string }",
    "export type DeadPublic = { value: string };",
    "export const marker = 1;",
    "",
  ].join("\n"),
  "src/members.ts": [
    "class Worker {",
    "  private unusedTask(): number { return 1; }",
    "  private usedTask(): number { return 2; }",
    "  run(): number { return this.usedTask(); }",
    "}",
    "enum State { Idle = 'idle', Active = 'active' }",
    "export const state = State.Active;",
    "export const worker = new Worker().run();",
    "",
  ].join("\n"),
  "src/deps.ts": [
    'import type { Static } from "@sinclair/typebox";',
    'import equalsRuntime = require("equals-runtime");',
    'import leftPad from "left-pad";',
    'import missingRuntime from "missing-runtime";',
    "type Only = Static;",
    "export async function loadDynamic(): Promise<unknown> { return import('dynamic-runtime'); }",
    "export const depUse = leftPad(`${missingRuntime}${equalsRuntime}`, 3);",
    "",
  ].join("\n"),
  "src/deps.test.ts": 'import { describe } from "vitest";\ndescribe("deps", () => {});\n',
};

const DEAD_CODE_RULES = {
  rules: {
    "no-circular-deps": "off",
    "no-dead-exports": "off",
    "no-dead-files": "warn",
    "no-unused-types": "warn",
    "no-unused-members": "warn",
    "no-unused-deps": "warn",
  },
};

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
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

  it("flushes large JSON output before exiting", async () => {
    const files: Record<string, string> = {};
    for (let fileIndex = 0; fileIndex < 180; fileIndex += 1) {
      const exports = [];
      for (let exportIndex = 0; exportIndex < 20; exportIndex += 1) {
        exports.push(`export const dead_${fileIndex}_${exportIndex} = ${fileIndex + exportIndex};`);
      }
      files[`src/file-${fileIndex}.ts`] = `${exports.join("\n")}\n`;
    }

    const dir = makeProject(files, { rules: { "no-circular-deps": "off" } });
    const { status, stdout } = await run(["check", dir, "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      verdict: string;
      findings: { ruleId: string }[];
      summary: { warn: number };
    };
    expect(parsed.verdict).toBe("warn");
    expect(parsed.findings.length).toBe(3600);
    expect(parsed.summary.warn).toBe(3600);
  }, 90_000);

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

  it("CH-P1-06: reports active and stale suppressions with JSDoc cleanup semantics", async () => {
    const activeDir = makeProject(
      {
        "src/contracts.ts": [
          "/** @expected-unused */",
          "type Intentional = { value: string };",
          "/** @public */",
          "export type PublicContract = { id: string };",
          "/** @internal */",
          "export type InternalDraft = { id: string };",
          "",
        ].join("\n"),
      },
      { rules: { "no-circular-deps": "off", "no-dead-exports": "off", "no-unused-types": "warn" } },
    );
    const activeRun = await run(["check", activeDir, "--json"]);
    expect(activeRun.status).toBe(0);
    const active = JSON.parse(activeRun.stdout) as {
      summary: { suppressed: number; staleSuppressions: number };
      suppressions: Array<{ directive: string; status: string; targetLine?: number; suppressed: number }>;
      findings: Array<{ ruleId: string; message: string }>;
    };
    expect(active.summary.suppressed).toBe(1);
    expect(active.summary.staleSuppressions).toBe(0);
    expect(active.suppressions).toContainEqual(
      expect.objectContaining({ directive: "@expected-unused", status: "active", targetLine: 2, suppressed: 1 }),
    );
    expect(active.findings.some((finding) => finding.message.includes("Intentional"))).toBe(false);
    expect(active.findings.some((finding) => finding.message.includes("PublicContract"))).toBe(false);
    expect(active.findings.some((finding) => finding.message.includes("InternalDraft"))).toBe(true);

    const activeSummary = await run(["check", activeDir, "--summary"]);
    expect(activeSummary.status).toBe(0);
    expect(activeSummary.stdout).toContain("1 suppressed");

    const staleDir = makeProject(
      {
        "src/contracts.ts": [
          "/** @expected-unused */",
          "type Used = { value: string };",
          "export const value: Used = { value: 'ok' };",
          "",
        ].join("\n"),
      },
      { rules: { "no-circular-deps": "off", "no-dead-exports": "off", "no-unused-types": "warn" } },
    );
    const staleRun = await run(["check", staleDir, "--json", "--fail-on", "warn"]);
    expect(staleRun.status).toBe(1);
    const stale = JSON.parse(staleRun.stdout) as {
      summary: { warn: number; suppressed: number; staleSuppressions: number };
      suppressions: Array<{ directive: string; status: string; targetLine?: number; suppressed: number }>;
      findings: Array<{ ruleId: string; kind?: string; message: string }>;
    };
    expect(stale.summary.warn).toBe(1);
    expect(stale.summary.suppressed).toBe(0);
    expect(stale.summary.staleSuppressions).toBe(1);
    expect(stale.suppressions).toContainEqual(
      expect.objectContaining({ directive: "@expected-unused", status: "stale", targetLine: 2, suppressed: 0 }),
    );
    expect(stale.findings).toContainEqual(
      expect.objectContaining({ ruleId: "no-stale-suppressions", kind: "stale-suppression" }),
    );

    const staleSummary = await run(["check", staleDir, "--summary", "--fail-on", "warn"]);
    expect(staleSummary.status).toBe(1);
    expect(staleSummary.stdout).toContain("1 stale suppression(s)");

    const staleSarifRun = await run(["check", staleDir, "--format", "sarif", "--fail-on", "warn"]);
    expect(staleSarifRun.status).toBe(1);
    const staleSarif = JSON.parse(staleSarifRun.stdout) as {
      runs: Array<{ results: Array<{ ruleId: string; properties?: { kind?: string; evidence?: string[] } }> }>;
    };
    const staleFinding = staleSarif.runs[0].results.find((finding) => finding.ruleId === "no-stale-suppressions");
    expect(staleFinding?.properties?.kind).toBe("stale-suppression");
    expect(staleFinding?.properties?.evidence).toContain("directive=@expected-unused");
  }, 90_000);

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

  it("exits 2 on an invalid --gate value", async () => {
    const dir = makeProject(CLEAN, { rules: {} });
    const { status, stderr } = await run(["check", dir, "--gate", "future-only"]);
    expect(status).toBe(2);
    expect(stderr).toContain("--gate must be one of");
  });

  it("--quiet wins over --summary on pass: no output, exit 0 (pinned contract)", async () => {
    const dir = makeProject(CLEAN, { rules: {} });
    const { status, stdout } = await run(["check", dir, "--quiet", "--summary"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("--quiet --summary still prints the summary line on failure", async () => {
    const dir = makeProject(CIRCULAR, { rules: { "no-dead-exports": "off" } });
    const { status, stdout } = await run(["check", dir, "--quiet", "--summary"]);
    expect(status).toBe(1);
    expect(stdout).toContain("error(s)");
    expect(stdout).toContain("FAIL");
  });

  it("accepts an explicit --config path", async () => {
    const dir = makeProject(CIRCULAR);
    const cfg = path.join(dir, "custom.json");
    fs.writeFileSync(cfg, JSON.stringify({ rules: { "no-circular-deps": "off", "no-dead-exports": "off" } }));
    const { status, stdout } = await run(["check", dir, "--config", cfg]);
    expect(status).toBe(0);
    expect(stdout).toContain("No findings.");
  });

  it("CH-P1-05: gates dead files, types, members, and dependency drift with confidence evidence", async () => {
    const dir = makeProject(DEAD_CODE_EXPANSION, DEAD_CODE_RULES);
    const jsonRun = await run(["check", dir, "--json", "--fail-on", "warn", "--force"]);
    expect(jsonRun.status).toBe(1);

    const parsed = JSON.parse(jsonRun.stdout) as {
      findings: Array<{
        ruleId: string;
        kind?: string;
        confidence?: string;
        file: string;
        message: string;
        evidence?: string[];
      }>;
    };

    const findings = parsed.findings;
    const unusedFile = findings.find((finding) => finding.kind === "unused-file" && finding.file === "src/orphan.ts");
    expect(unusedFile?.ruleId).toBe("no-dead-files");
    expect(unusedFile?.confidence).toBe("medium");
    expect(unusedFile?.evidence).toContain("entrypoint=false");
    expect(findings.some((finding) => finding.ruleId === "no-dead-files" && finding.file === "src/index.ts")).toBe(false);

    expect(findings.some((finding) => finding.kind === "unused-type" && finding.message.includes("LocalDraft"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "unused-interface" && finding.message.includes("LocalView"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "unused-exported-type" && finding.message.includes("DeadPublic"))).toBe(true);

    expect(findings.some((finding) => finding.kind === "private-class-member" && finding.message.includes("Worker.unusedTask"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "enum-member" && finding.message.includes("State.Idle"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("Worker.usedTask"))).toBe(false);
    expect(findings.some((finding) => finding.message.includes("State.Active"))).toBe(false);

    expect(findings.some((finding) => finding.kind === "unused-dependency" && finding.message.includes("unused-runtime"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "type-only-dependency" && finding.message.includes("@sinclair/typebox"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "test-only-dependency" && finding.message.includes("vitest"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "unlisted-dependency" && finding.message.includes("missing-runtime"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "unlisted-dependency" && finding.message.includes("equals-runtime"))).toBe(true);
    expect(findings.some((finding) => finding.kind === "unlisted-dependency" && finding.message.includes("dynamic-runtime"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("left-pad"))).toBe(false);

    const sarifRun = await run(["check", dir, "--format", "sarif", "--fail-on", "warn", "--force"]);
    expect(sarifRun.status).toBe(1);
    const sarif = JSON.parse(sarifRun.stdout) as {
      runs: Array<{
        results: Array<{
          ruleId: string;
          locations?: Array<{ physicalLocation?: { artifactLocation?: { uri?: string } } }>;
          properties?: { confidence?: string; evidence?: string[]; kind?: string };
        }>;
      }>;
    };
    const sarifFinding = sarif.runs[0].results.find(
      (finding) => finding.properties?.kind === "unused-file"
        && finding.locations?.[0]?.physicalLocation?.artifactLocation?.uri === "src/orphan.ts",
    );
    expect(sarifFinding?.ruleId).toBe("no-dead-files");
    expect(sarifFinding?.properties?.confidence).toBe("medium");
    expect(sarifFinding?.properties?.evidence).toContain("entrypoint=false");
  }, 90_000);
});
