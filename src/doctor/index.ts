import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadConfig } from "../config/index.js";
import { loadCodebaseGraph } from "../graph-loader/index.js";
import { operationList } from "../operations/index.js";
import { getCacheFactsForTarget } from "../persistence/index-dir.js";

export type DoctorLevel = "pass" | "warn" | "fail";
export type DoctorProfile = "local" | "ci" | "agent" | "mcp";
export type DoctorAgent = "codex" | "claude" | "cursor" | "generic";

export interface DoctorCheck {
  id: string;
  level: DoctorLevel;
  title: string;
  evidence: string[];
  fix?: string;
  docs?: string;
}

export interface DoctorResult {
  status: DoctorLevel;
  profile: DoctorProfile;
  agent: DoctorAgent;
  root: string;
  checks: DoctorCheck[];
  summary: string;
}

function check(id: string, level: DoctorLevel, title: string, evidence: string[], fix?: string, docs?: string): DoctorCheck {
  return { id, level, title, evidence, fix, docs };
}

function commandOk(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

function hasAny(root: string, rels: string[]): boolean {
  return rels.some((rel) => fs.existsSync(path.join(root, rel)));
}

function statusFor(checks: readonly DoctorCheck[]): DoctorLevel {
  if (checks.some((item) => item.level === "fail")) return "fail";
  if (checks.some((item) => item.level === "warn")) return "warn";
  return "pass";
}

function packageManager(root: string): string {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  return "unknown";
}

export function runDoctor(rootDir: string, options: { profile?: DoctorProfile; agent?: DoctorAgent } = {}): DoctorResult {
  const root = path.resolve(rootDir);
  const profile = options.profile ?? "local";
  const agent = options.agent ?? "generic";
  const checks: DoctorCheck[] = [];

  checks.push(
    check(
      "runtime.node",
      Number.parseInt(process.versions.node.split(".")[0], 10) >= 18 ? "pass" : "fail",
      "Node.js runtime",
      [`node=${process.versions.node}`],
      "Install Node.js 18 or newer.",
      "README.md#installation",
    ),
  );

  const manager = packageManager(root);
  checks.push(
    check(
      "package.manager",
      manager === "unknown" ? "warn" : "pass",
      "Package manager detected",
      [`manager=${manager}`],
      manager === "unknown" ? "Add a lockfile so CI and agents use the same package manager." : undefined,
      "README.md#development",
    ),
  );

  try {
    const { configPath } = loadConfig(root);
    checks.push(check("config.schema", "pass", "Config schema", [configPath ? `config=${configPath}` : "config=none"]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push(check("config.schema", "fail", "Config schema", [message], "Fix codebase-intelligence config JSON/schema errors.", "schema.json"));
  }

  const tsconfig = fs.existsSync(path.join(root, "tsconfig.json"));
  checks.push(
    check(
      "project.typescript",
      tsconfig ? "pass" : "warn",
      "TypeScript project root",
      [tsconfig ? "tsconfig.json found" : "tsconfig.json missing"],
      tsconfig ? undefined : "Run from a TypeScript project root or add tsconfig.json.",
      "docs/cli-reference.md",
    ),
  );

  const cache = getCacheFactsForTarget(root, false);
  checks.push(
    check(
      "cache.path",
      cache.warnings.length === 0 ? "pass" : "warn",
      "Cache directory",
      [`cacheDir=${cache.cacheDir}`, `legacyCacheDir=${cache.legacyCacheDir}`, ...cache.warnings],
      cache.warnings.length > 0 ? "Run codebase-intelligence init --gitignore ." : undefined,
      "docs/data-model.md#cachefacts",
    ),
  );

  try {
    const graphResult = loadCodebaseGraph({ targetPath: root, persist: false, cliVersion: "doctor" });
    checks.push(
      check(
        "graph.build",
        "pass",
        "Graph build",
        [`files=${String(graphResult.graph.stats.totalFiles)}`, `dependencies=${String(graphResult.graph.stats.totalDependencies)}`],
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push(check("graph.build", "fail", "Graph build", [message], "Run codebase-intelligence overview . --force to inspect parser errors.", "docs/architecture.md"));
  }

  const help = commandOk(process.execPath, [process.argv[1] ?? "", "--help"], root);
  checks.push(
    check(
      "cli.help",
      help.ok && help.output.includes("overview") ? "pass" : "warn",
      "CLI help",
      [help.ok ? "help rendered" : help.output],
      "Run pnpm build before using the CLI from source.",
      "docs/cli-reference.md",
    ),
  );

  checks.push(
    check(
      "mcp.tools",
      operationList.length >= 20 ? "pass" : "warn",
      "MCP tool registry",
      [`registeredOperations=${String(operationList.length)}`],
      "Run codebase-intelligence doctor --profile mcp --json for setup details.",
      "docs/mcp-tools.md",
    ),
  );

  const hasCi = hasAny(root, [".github/workflows/ci.yml", ".github/workflows/ci.yaml", ".gitlab-ci.yml"]);
  if (profile === "ci" || hasCi) {
    checks.push(
      check(
        "ci.workflow",
        hasCi ? "pass" : "warn",
        "CI workflow",
        [hasCi ? "workflow found" : "workflow missing"],
        "Add a workflow step: codebase-intelligence ci . --base origin/main --new-only --format sarif --output codebase-intelligence.sarif",
        "docs/cli-reference.md#ci",
      ),
    );
  }

  const agentFiles = {
    codex: ["AGENTS.md"],
    claude: ["CLAUDE.md", ".claude/CLAUDE.md"],
    cursor: [".cursorrules"],
    generic: ["AGENTS.md", "CLAUDE.md", ".cursorrules"],
  }[agent];
  const hasAgentInstructions = hasAny(root, agentFiles);
  if (profile === "agent" || agent !== "generic") {
    checks.push(
      check(
        "agent.instructions",
        hasAgentInstructions ? "pass" : "warn",
        "Agent instructions",
        [hasAgentInstructions ? "agent instructions found" : "agent instructions missing"],
        agent === "generic" ? "Run codebase-intelligence init --all ." : `Run codebase-intelligence init --agents ${agent} .`,
        "llms.txt",
      ),
    );
  }

  const status = statusFor(checks);
  return {
    status,
    profile,
    agent,
    root,
    checks,
    summary: `Doctor ${status.toUpperCase()}: ${String(checks.filter((item) => item.level === "fail").length)} fail, ${String(checks.filter((item) => item.level === "warn").length)} warn, ${String(checks.filter((item) => item.level === "pass").length)} pass.`,
  };
}

export function formatDoctorText(result: DoctorResult): string {
  const lines = [`Codebase Intelligence Doctor — ${result.status.toUpperCase()}`, result.summary, ""];
  for (const item of result.checks) {
    lines.push(`${item.level.toUpperCase().padEnd(4)} ${item.id} — ${item.title}`);
    for (const evidence of item.evidence) lines.push(`  evidence: ${evidence}`);
    if (item.fix) lines.push(`  fix: ${item.fix}`);
    if (item.docs) lines.push(`  docs: ${item.docs}`);
  }
  return lines.join("\n");
}
