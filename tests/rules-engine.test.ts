import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseCodebase } from "../src/parser/index.js";
import { buildGraph } from "../src/graph/index.js";
import { analyzeGraph } from "../src/analyzer/index.js";
import { runCheck } from "../src/rules/check.js";
import { formatText, formatJson, formatSarif, formatResult } from "../src/rules/format.js";
import type { CheckResult, CodebaseIntelligenceConfig, Finding } from "../src/types/index.js";

// Real pipeline: parser -> graph -> analyzer -> rules engine. No mocks.
// Each case writes real .ts files + a real config to a temp dir.

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function projectResult(files: Record<string, string>, config: CodebaseIntelligenceConfig): CheckResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-rules-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.writeFileSync(path.join(dir, "codebase-intelligence.json"), JSON.stringify(config));
  const parsed = parseCodebase(dir);
  const graph = analyzeGraph(buildGraph(parsed), parsed);
  return runCheck(graph, dir);
}

function project(files: Record<string, string>, config: CodebaseIntelligenceConfig): Finding[] {
  return projectResult(files, config).findings;
}

const CIRCULAR_FILES: Record<string, string> = {
  "src/a.ts": 'import { b } from "./b.js";\nexport function a(): number { return b() + 1; }\n',
  "src/b.ts": 'import { a } from "./a.js";\nexport function b(): number { return a === undefined ? 0 : 1; }\n',
};

const DEAD_FILES: Record<string, string> = {
  "src/a.ts": 'import { used } from "./b.js";\nexport function a(): number { return used(); }\n',
  "src/b.ts": "export function used(): number { return 1; }\nexport function deadOne(): number { return 2; }\n",
};

const ids = (findings: Finding[]): string[] => findings.map((f) => f.ruleId);

describe("no-comments rule", () => {
  it("is off by default — inline comments are not reported", () => {
    const findings = project(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // trailing\n" },
      {},
    );
    expect(ids(findings)).not.toContain("no-comments");
  });

  it("flags an inline // comment when enabled", () => {
    const findings = project(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // trailing comment\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    const nc = findings.filter((f) => f.ruleId === "no-comments");
    expect(nc.length).toBe(1);
    expect(nc[0].line).toBe(2);
    expect(nc[0].severity).toBe("error");
  });

  it("allows a file-leading license header by default", () => {
    const findings = project(
      { "src/x.ts": "// Copyright header\nexport const x = 1;\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    expect(ids(findings)).not.toContain("no-comments");
  });

  it("allows JSDoc by default but flags it under allowJSDoc:false + style:all", () => {
    const src = "export const x = 1;\n/** doc */\nexport function z(): void {}\n";
    const allowed = project({ "src/x.ts": src }, { rules: { "no-comments": "error", "no-dead-exports": "off" } });
    expect(ids(allowed)).not.toContain("no-comments");

    const flagged = project(
      { "src/x.ts": src },
      { rules: { "no-comments": ["error", { style: "all", allowJSDoc: false }], "no-dead-exports": "off" } },
    );
    expect(ids(flagged)).toContain("no-comments");
  });

  it("respects the allow list", () => {
    const findings = project(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // TODO later\n" },
      { rules: { "no-comments": ["error", { allow: ["TODO"] }], "no-dead-exports": "off" } },
    );
    expect(ids(findings)).not.toContain("no-comments");
  });
});

describe("suppressions", () => {
  it("ci-ignore-next-line suppresses the following line", () => {
    const findings = project(
      {
        "src/x.ts": "export const x = 1;\n// ci-ignore-next-line no-comments\nexport const y = x; // hidden\n",
      },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    expect(ids(findings)).not.toContain("no-comments");
  });

  it("ci-ignore-file suppresses the whole file", () => {
    const findings = project(
      { "src/x.ts": "// ci-ignore-file no-comments\nexport const x = 1;\nexport const y = x; // a\nexport const z = y; // b\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    expect(ids(findings)).not.toContain("no-comments");
  });
});

describe("graph-backed rules", () => {
  it("flags circular dependencies as errors by default", () => {
    const findings = project(
      {
        "src/a.ts": 'import { b } from "./b.js";\nexport function a(): number { return b() + 1; }\n',
        "src/b.ts": 'import { a } from "./a.js";\nexport function b(): number { return a === undefined ? 0 : 1; }\n',
      },
      { rules: { "no-dead-exports": "off" } },
    );
    const circ = findings.filter((f) => f.ruleId === "no-circular-deps");
    expect(circ.length).toBeGreaterThanOrEqual(1);
    expect(circ[0].severity).toBe("error");
    expect(circ[0].message).toContain("Circular dependency");
  });

  it("reports dead exports as warnings", () => {
    const findings = project(
      {
        "src/a.ts": 'import { used } from "./b.js";\nexport function a(): number { return used(); }\n',
        "src/b.ts": "export function used(): number { return 1; }\nexport function deadOne(): number { return 2; }\n",
      },
      { rules: { "no-circular-deps": "off" } },
    );
    const dead = findings.filter((f) => f.ruleId === "no-dead-exports");
    expect(dead.some((f) => f.message.includes("deadOne"))).toBe(true);
    expect(dead.every((f) => f.severity === "warn")).toBe(true);
  });
});

describe("no-comments styles and directives", () => {
  it("style:block flags block comments only", () => {
    const findings = project(
      { "src/x.ts": "export const a = 1;\nexport const b = a; /* block */ // line\n" },
      { rules: { "no-comments": ["error", { style: "block" }], "no-dead-exports": "off" } },
    );
    expect(findings.filter((f) => f.ruleId === "no-comments").length).toBe(1);
  });

  it("style:all flags every comment", () => {
    const findings = project(
      { "src/x.ts": "export const a = 1;\nexport const b = a; /* block */ // line\n" },
      { rules: { "no-comments": ["error", { style: "all" }], "no-dead-exports": "off" } },
    );
    expect(findings.filter((f) => f.ruleId === "no-comments").length).toBe(2);
  });

  it("keeps @ts directive comments by default", () => {
    const findings = project(
      { "src/x.ts": "export const a = 1;\n// @ts-expect-error intentional\nexport const b = a;\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    expect(findings.filter((f) => f.ruleId === "no-comments").length).toBe(0);
  });
});

describe("formatters", () => {
  it("render a failing result in text, json, and sarif", () => {
    const result = projectResult(CIRCULAR_FILES, { rules: { "no-dead-exports": "off" } });

    expect(formatText(result)).toContain("Circular dependency");
    expect(formatResult(result, "text")).toBe(formatText(result));

    const json = JSON.parse(formatJson(result)) as { verdict: string };
    expect(json.verdict).toBe("fail");
    expect(formatResult(result, "json")).toContain("verdict");

    const sarif = JSON.parse(formatSarif(result)) as { version: string; runs: { results: unknown[] }[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThanOrEqual(1);
    expect(formatResult(result, "sarif")).toContain("2.1.0");
  });

  it("renders 'No findings.' for a clean result", () => {
    const result = projectResult(
      {
        "src/main.ts": "export function main(): number { return 1; }\n",
        "src/index.ts": 'import { main } from "./main.js";\nmain();\n',
      },
      { rules: {} },
    );
    expect(formatText(result)).toContain("No findings.");
  });
});

describe("verdict gating", () => {
  it("failOn:never keeps errors from failing the gate", () => {
    const result = projectResult(CIRCULAR_FILES, { rules: { "no-dead-exports": "off" }, ci: { failOn: "never" } });
    expect(result.verdict).not.toBe("fail");
  });

  it("maxWarnings turns warnings into a failure", () => {
    const result = projectResult(DEAD_FILES, { rules: { "no-circular-deps": "off" }, ci: { maxWarnings: 0 } });
    expect(result.verdict).toBe("fail");
  });

  it("failOn:never disables the maxWarnings gate too", () => {
    const result = projectResult(DEAD_FILES, {
      rules: { "no-circular-deps": "off" },
      ci: { failOn: "never", maxWarnings: 0 },
    });
    expect(result.verdict).not.toBe("fail");
  });
});

describe("no-comments precision (post-review)", () => {
  it("block-comment ci-ignore-file suppresses the whole file", () => {
    const findings = project(
      { "src/x.ts": "export const x = 1;\n/* ci-ignore-file no-comments */\nexport const y = x; // hidden\n" },
      { rules: { "no-comments": "error", "no-dead-exports": "off" } },
    );
    expect(ids(findings)).not.toContain("no-comments");
  });

  it("allow matches comment-body prefix, not arbitrary substrings", () => {
    const kept = project(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // TODO later\n" },
      { rules: { "no-comments": ["error", { allow: ["TODO"] }], "no-dead-exports": "off" } },
    );
    expect(ids(kept)).not.toContain("no-comments");

    // allow:["a"] must NOT over-allow "// bad" (substring "a") — body "bad" does not start with "a".
    const flagged = project(
      { "src/x.ts": "export const x = 1;\nexport const y = x; // bad\n" },
      { rules: { "no-comments": ["error", { allow: ["a"] }], "no-dead-exports": "off" } },
    );
    expect(ids(flagged)).toContain("no-comments");
  });
});

describe("new-only gate", () => {
  // Hermetic git identity — independent of global config / CI env.
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

  it("filters findings to files changed since base", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-newonly-"));
    created.push(dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "old.ts"), "export function old(): number { return 1; }\n");
    fs.writeFileSync(path.join(dir, "codebase-intelligence.json"), JSON.stringify({ rules: { "no-circular-deps": "off" } }));
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "t"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base", "--no-gpg-sign"]);
    const base = git(dir, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(dir, "src", "new.ts"), "export function fresh(): number { return 2; }\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "new", "--no-gpg-sign"]);

    const parsed = parseCodebase(dir);
    const graph = analyzeGraph(buildGraph(parsed), parsed);

    const full = runCheck(graph, dir).findings.filter((f) => f.ruleId === "no-dead-exports");
    expect(full.length).toBeGreaterThanOrEqual(2);

    const gated = runCheck(graph, dir, { gate: "new-only", base }).findings;
    expect(gated.length).toBeGreaterThanOrEqual(1);
    expect(gated.every((f) => f.file === "src/new.ts")).toBe(true);
  });

  it("works when the check target is a subdirectory of the repo (regression: silent false-pass)", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ci-newonly-sub-"));
    created.push(repo);
    const app = path.join(repo, "app");
    fs.mkdirSync(path.join(app, "src"), { recursive: true });
    fs.writeFileSync(path.join(app, "src", "old.ts"), "export function old(): number { return 1; }\n");
    fs.writeFileSync(path.join(app, "codebase-intelligence.json"), JSON.stringify({ rules: { "no-circular-deps": "off" } }));
    git(repo, ["init"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "base", "--no-gpg-sign"]);
    const base = git(repo, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(app, "src", "new.ts"), "export function fresh(): number { return 2; }\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "new", "--no-gpg-sign"]);

    // Check the SUBDIR, not the repo root — findings are app-relative, git paths repo-relative.
    const parsed = parseCodebase(app);
    const graph = analyzeGraph(buildGraph(parsed), parsed);
    const gated = runCheck(graph, app, { gate: "new-only", base }).findings;
    expect(gated.length).toBeGreaterThanOrEqual(1);
    expect(gated.every((f) => f.file === "src/new.ts")).toBe(true);
  });
});
