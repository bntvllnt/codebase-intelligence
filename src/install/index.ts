import fs from "fs";
import path from "path";
import os from "os";

// ── Managed-block engine ────────────────────────────────────
//
// Idempotent upsert of an auto-generated block into a (possibly
// pre-existing, user-owned) text file. Content outside the markers is
// never touched, so re-running `init` converges instead of clobbering.

export interface BlockMarkers {
  start: string;
  end: string;
}

export const DEFAULT_MARKERS: BlockMarkers = {
  start: "<!-- codebase-intelligence:start (auto-generated — do not edit between markers) -->",
  end: "<!-- codebase-intelligence:end -->",
};

/**
 * Insert or replace a managed block in `existing` content.
 *
 * - Both markers present (in order) → replace the region between them.
 * - Otherwise → append the block, preserving all existing content.
 *
 * Pure and filesystem-free. `upsert(upsert(x)) === upsert(x)`.
 *
 * @param existing - Current file content ("" if the file does not exist).
 * @param block - Block body to manage (markers are added automatically).
 * @param markers - Comment markers delimiting the managed region.
 * @returns The new file content, always newline-terminated.
 */
export function upsertManagedBlock(
  existing: string,
  block: string,
  markers: BlockMarkers = DEFAULT_MARKERS,
): string {
  const wrapped = `${markers.start}\n${block.trim()}\n${markers.end}`;

  const startIdx = existing.indexOf(markers.start);
  const endIdx = existing.indexOf(markers.end, startIdx + markers.start.length);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + markers.end.length);
    return `${before}${wrapped}${after}`;
  }

  if (existing.trim() === "") {
    return `${wrapped}\n`;
  }

  return `${existing.replace(/\s+$/, "")}\n\n${wrapped}\n`;
}

/**
 * Ensure `content` begins with a frontmatter preamble (e.g. Cursor `.mdc`).
 * No-op when frontmatter (`---`) is already present.
 */
export function ensurePreamble(content: string, preamble: string): string {
  if (content.trimStart().startsWith("---")) {
    return content;
  }
  if (content.trim() === "") {
    return preamble;
  }
  return `${preamble.replace(/\s+$/, "")}\n\n${content}`;
}

// ── Agent target registry ───────────────────────────────────
//
// Single source of truth for which files each agent reads. Adapters
// differ only by path / optional frontmatter — the block content is
// shared (see renderBlock).

export type AgentId = "agents" | "claude" | "cursor" | "copilot" | "gemini" | "aider";

export interface AgentTarget {
  id: AgentId;
  label: string;
  /** Repo-relative path to the instruction file. */
  file: string;
  /** Frontmatter ensured at the top of the file when present. */
  preamble?: string;
}

const CURSOR_PREAMBLE = `---
description: Codebase Intelligence — query the CLI before grep/read for architecture, impact, and risk
alwaysApply: true
---
`;

export const AGENT_TARGETS: readonly AgentTarget[] = [
  { id: "agents", label: "AGENTS.md (cross-agent standard, incl. Codex)", file: "AGENTS.md" },
  { id: "claude", label: "Claude Code", file: "CLAUDE.md" },
  {
    id: "cursor",
    label: "Cursor",
    file: path.join(".cursor", "rules", "codebase-intelligence.mdc"),
    preamble: CURSOR_PREAMBLE,
  },
  { id: "copilot", label: "GitHub Copilot", file: path.join(".github", "copilot-instructions.md") },
  { id: "gemini", label: "Gemini CLI", file: "GEMINI.md" },
  { id: "aider", label: "Aider", file: "CONVENTIONS.md" },
];

export const ALL_AGENT_IDS: readonly AgentId[] = AGENT_TARGETS.map((t) => t.id);

/** Runtime guard: is `value` a known agent id? */
export function isAgentId(value: string): value is AgentId {
  return (ALL_AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Default selection when the user doesn't choose explicitly: the universal
 * `AGENTS.md` standard plus `CLAUDE.md`. Everything else is opt-in.
 */
export const DEFAULT_AGENTS: readonly AgentId[] = ["agents", "claude"];

// ── Init planning (pure) ────────────────────────────────────

export interface InitFlags {
  /** Comma-separated agent ids from `--agents`. */
  agents?: string;
  /** `--all`: every agent. */
  all?: boolean;
  /** `--skill`: install the global skill (opt-in). */
  skill?: boolean;
  /** `--json`: machine output, implies non-interactive. */
  json?: boolean;
  /** `--yes`: accept defaults without prompting. */
  yes?: boolean;
}

export type InitMode = "explicit" | "interactive" | "default";

export interface InitPlan {
  /** Agents to write (preselection when mode is "interactive"). */
  agents: AgentId[];
  /** Whether to install the global skill (default when mode is "interactive"). */
  installSkill: boolean;
  /** How the selection was decided. "interactive" → caller should prompt. */
  mode: InitMode;
  /** Unknown ids passed to `--agents`. */
  invalidAgents: string[];
}

/**
 * Decide what `init` should do from its flags and whether stdout is a TTY.
 * Pure — no prompting or filesystem. When `mode` is "interactive" the caller
 * presents a picker seeded with `agents`/`installSkill`; otherwise the plan is
 * final.
 */
export function resolveInitPlan(flags: InitFlags, isTty: boolean): InitPlan {
  const installSkill = flags.skill === true;

  if (flags.all === true) {
    return { agents: [...ALL_AGENT_IDS], installSkill, mode: "explicit", invalidAgents: [] };
  }

  if (flags.agents !== undefined) {
    const requested = flags.agents
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    return {
      agents: requested.filter(isAgentId),
      installSkill,
      mode: "explicit",
      invalidAgents: requested.filter((a) => !isAgentId(a)),
    };
  }

  const interactive = isTty && flags.json !== true && flags.yes !== true;
  return {
    agents: [...DEFAULT_AGENTS],
    installSkill,
    mode: interactive ? "interactive" : "default",
    invalidAgents: [],
  };
}

// ── Content (single source of truth) ────────────────────────

/**
 * The instruction block injected into every agent file. This is the
 * product: it tells agents to query CI before grep/read.
 */
export function renderBlock(): string {
  return `## Codebase Intelligence

This repo is analyzed by \`codebase-intelligence\` — a static-analysis tool that maps
architecture, dependencies, and risk metrics for TypeScript code.

**Use it BEFORE grep/read when you need to understand structure, impact, or risk.**
It is faster and more accurate than reading files one at a time.

| When you need to… | Run |
|---|---|
| Understand the codebase | \`codebase-intelligence overview .\` |
| Find where complexity/risk lives | \`codebase-intelligence hotspots .\` |
| Blast radius before editing a symbol | \`codebase-intelligence impact . <symbol>\` |
| Who depends on a file | \`codebase-intelligence dependents . <file>\` |
| Find unused exports | \`codebase-intelligence dead-exports .\` |
| Keyword search | \`codebase-intelligence search . <query>\` |
| Plan a rename | \`codebase-intelligence rename . <old> <new>\` |

- Add \`--json\` for machine-readable output (use in automation/subagents).
- No global install? Prefix with \`npx codebase-intelligence@latest\`.
- Full command list: \`codebase-intelligence --help\`.
- MCP stdio server: \`codebase-intelligence .\``;
}

/**
 * The portable skill body (frontmatter + instructions). Installed to
 * `~/.claude/skills/` and shipped to the skills.sh registry.
 */
export function renderSkill(): string {
  return `---
name: codebase-intelligence
description: Query the codebase-intelligence CLI to understand TypeScript architecture, dependencies, blast radius, and risk before reading files. Use for any "how is this structured", "what breaks if I change X", "where is the complexity" question.
---

# Codebase Intelligence

\`codebase-intelligence\` turns a TypeScript codebase into a queryable graph of
architecture, dependencies, and risk metrics. **Prefer it over grep/read** when the
task is about structure, impact, or risk — it is faster and more accurate than
scanning files one by one.

## When to use

| Goal | Command |
|------|---------|
| First look / architecture | \`codebase-intelligence overview <path>\` |
| Risk & complexity ranking | \`codebase-intelligence hotspots <path>\` |
| Impact of changing a symbol | \`codebase-intelligence impact <path> <symbol>\` |
| File-level blast radius | \`codebase-intelligence dependents <path> <file>\` |
| Unused exports | \`codebase-intelligence dead-exports <path>\` |
| Keyword search | \`codebase-intelligence search <path> <query>\` |
| Rename planning | \`codebase-intelligence rename <path> <old> <new>\` |
| Module structure | \`codebase-intelligence modules <path>\` |

## Rules

- Run \`overview\` first to orient, then drill down (hotspots → file/symbol → impact).
- Always pass \`--json\` in automation/subagents for structured output.
- Use \`impact\`/\`dependents\` BEFORE editing to gauge blast radius.
- No global install? Prefix any command with \`npx codebase-intelligence@latest\`.
- Full reference: \`codebase-intelligence --help\`.
`;
}

// ── Install operations (filesystem) ─────────────────────────

export interface InstallResult {
  path: string;
  action: "created" | "updated" | "unchanged";
}

export interface InstallRepoOptions {
  /** Subset of agents to target. Defaults to all. */
  agents?: readonly AgentId[];
}

/** Write the instruction block into each selected agent's repo file. */
export function installRepoFiles(repoRoot: string, options: InstallRepoOptions = {}): InstallResult[] {
  const selected = options.agents ?? ALL_AGENT_IDS;
  const block = renderBlock();
  const results: InstallResult[] = [];

  for (const target of AGENT_TARGETS) {
    if (!selected.includes(target.id)) continue;

    const filePath = path.join(repoRoot, target.file);
    const existedBefore = fs.existsSync(filePath);
    const original = existedBefore ? fs.readFileSync(filePath, "utf-8") : "";

    const base = target.preamble ? ensurePreamble(original, target.preamble) : original;
    const next = upsertManagedBlock(base, block);

    if (existedBefore && original === next) {
      results.push({ path: target.file, action: "unchanged" });
      continue;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, next, "utf-8");
    results.push({ path: target.file, action: existedBefore ? "updated" : "created" });
  }

  return results;
}

/** Install the portable skill into the per-user Claude skills directory. */
export function installGlobalSkill(homeDir: string = os.homedir()): InstallResult {
  const dir = path.join(homeDir, ".claude", "skills", "codebase-intelligence");
  const filePath = path.join(dir, "SKILL.md");
  const skill = renderSkill();

  const existedBefore = fs.existsSync(filePath);
  const original = existedBefore ? fs.readFileSync(filePath, "utf-8") : "";

  if (existedBefore && original === skill) {
    return { path: filePath, action: "unchanged" };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, skill, "utf-8");
  return { path: filePath, action: existedBefore ? "updated" : "created" };
}
