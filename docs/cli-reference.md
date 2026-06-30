# CLI Reference

18 commands for terminal and CI use. The 16 analysis commands have full parity with MCP tools and auto-cache the index to `.code-visualizer/`; `check` runs the rules gate; `init` sets up agent adoption.

## Commands

### overview

High-level codebase snapshot.

```bash
codebase-intelligence overview <path> [--json] [--force]
```

**Output:** file count, function count, dependency count, analysis mode/call graph precision, modules (path, files, LOC, coupling, cohesion), top 5 depended files, avg LOC, max depth, circular dep count.

### hotspots

Rank files by metric.

```bash
codebase-intelligence hotspots <path> [--metric <metric>] [--limit <n>] [--json] [--force]
```

**Metrics:** `coupling` (default), `pagerank`, `fan_in`, `fan_out`, `betweenness`, `tension`, `churn`, `complexity`, `blast_radius`, `coverage`, `escape_velocity`.

### file

Detailed file context.

```bash
codebase-intelligence file <path> <file> [--json] [--force]
```

`<file>` is relative to the codebase root (e.g., `parser/index.ts`).

**Output:** LOC, exports, imports, dependents, all FileMetrics. Error: prints top 3 similar path suggestions.

### search

BM25 keyword search.

```bash
codebase-intelligence search <path> <query> [--limit <n>] [--json] [--force]
```

**Output:** Ranked results grouped by file, with symbol name, type, LOC, and relevance score.

### changes

Git diff analysis with risk metrics.

```bash
codebase-intelligence changes <path> [--scope <scope>] [--json] [--force]
```

**Scope:** `staged`, `unstaged`, `all` (default).

### dependents

File-level blast radius: direct + transitive dependents.

```bash
codebase-intelligence dependents <path> <file> [--depth <n>] [--json] [--force]
```

**Output:** direct dependents with symbols, transitive dependents with paths, total affected, risk level (LOW/MEDIUM/HIGH).

### modules

Module architecture with cross-module dependencies.

```bash
codebase-intelligence modules <path> [--json] [--force]
```

**Output:** modules with cohesion/escape velocity, cross-module deps, circular deps.

### forces

Architectural force analysis.

```bash
codebase-intelligence forces <path> [--cohesion <n>] [--tension <n>] [--escape <n>] [--json] [--force]
```

**Output:** module cohesion verdicts, tension files, bridge files, extraction candidates, shallow modules, deep modules, seam candidates, locality risks, summary.

### dead-exports

Find unused exports across the codebase.

```bash
codebase-intelligence dead-exports <path> [--module <module>] [--limit <n>] [--json] [--force]
```

**Output:** dead export count, files with unused exports, confidence, package-entrypoint evidence, summary.

### opportunities

Rank code quality and refactoring opportunities for AI agents.

```bash
codebase-intelligence opportunities <path> [--limit <n>] [--json] [--force]
```

**Output:** ranked opportunities with kind, priority, confidence, score, target, evidence, and suggested follow-up commands.

### groups

Top-level directory groups with aggregate metrics.

```bash
codebase-intelligence groups <path> [--json] [--force]
```

**Output:** groups ranked by importance with files, LOC, coupling.

### symbol

Function/class context with callers and callees.

```bash
codebase-intelligence symbol <path> <name> [--json] [--force]
```

**Output:** symbol metadata, fan-in/out, PageRank, betweenness, callers, callees.

### impact

Symbol-level blast radius with depth-grouped impact levels.

```bash
codebase-intelligence impact <path> <symbol> [--json] [--force]
```

**Output:** impact levels (WILL BREAK / LIKELY / MAY NEED TESTING), total affected.

### rename

Find all references for rename planning (read-only by default).

```bash
codebase-intelligence rename <path> <oldName> <newName> [--no-dry-run] [--json] [--force]
```

**Output:** references with file, symbol, and confidence level.

### processes

Entry point execution flows through the call graph.

```bash
codebase-intelligence processes <path> [--entry <name>] [--limit <n>] [--json] [--force]
```

**Output:** processes with entry point, steps, depth, modules touched.

### clusters

Community-detected file clusters (Louvain algorithm).

```bash
codebase-intelligence clusters <path> [--min-files <n>] [--json] [--force]
```

**Output:** clusters with files, file count, cohesion.

### check

Rules-engine gate for CI.

```bash
codebase-intelligence check <path> [--config <path>] [--format <fmt>] [--fail-on <severity>] [--gate <mode>] [--base <ref>] [--quiet] [--summary] [--json] [--force]
```

**Formats:** `text` (default), `json`, `sarif`.

**Fail-on:** `error` (default), `warn`, `never`.

**Gate modes:** `all` (default), `new-only`.

**Output:** pass/warn/fail verdict, findings, and summary counts. Exit code `0` on pass, `1` when the configured gate fails, `2` for invalid config or arguments.

### init

Set up AI agents to use codebase-intelligence by writing a managed instruction block
into each selected agent's repo file (`AGENTS.md`, `CLAUDE.md`,
`.cursor/rules/codebase-intelligence.mdc`, `.github/copilot-instructions.md`,
`GEMINI.md`, `CONVENTIONS.md`) and optionally installing the portable skill to
`~/.claude/skills/`. Idempotent — only content between the
`codebase-intelligence:start`/`:end` markers is touched.

Opt-in by design: on a TTY it shows an interactive picker (`AGENTS.md` + `CLAUDE.md`
preselected). Non-interactively (or with `--yes`/`--json`) it defaults to those two.
The global skill is never installed unless `--skill` is passed.

```bash
codebase-intelligence init [path] [--agents <list>] [--all] [--skill] [--yes] [--json]
```

**Output:** per-file actions (created / updated / unchanged) and skill install status.

## Flags

| Flag | Available On | Description |
|------|-------------|-------------|
| `--json` | All commands | Output stable JSON to stdout |
| `--force` | All commands | Re-parse even if cached index matches HEAD |
| `--metric <m>` | hotspots | Metric to rank by (default: coupling) |
| `--limit <n>` | hotspots, search, dead-exports, opportunities, processes | Max results |
| `--scope <s>` | changes | Git diff scope: staged, unstaged, all |
| `--depth <n>` | dependents | Max traversal depth (default: 2) |
| `--cohesion <n>` | forces | Min cohesion threshold (default: 0.6) |
| `--tension <n>` | forces | Min tension threshold (default: 0.3) |
| `--escape <n>` | forces | Min escape velocity threshold (default: 0.5) |
| `--module <m>` | dead-exports | Filter by module path |
| `--entry <name>` | processes | Filter by entry point name |
| `--min-files <n>` | clusters | Min files per cluster |
| `--no-dry-run` | rename | Actually perform the rename (default: dry run) |
| `--format <fmt>` | check | Output format: text, json, sarif |
| `--fail-on <severity>` | check | Severity that fails the gate: error, warn, never |
| `--gate <mode>` | check | Gate mode: all, new-only |
| `--base <ref>` | check | Base git ref for new-only gating |
| `--quiet` | check | Suppress output when the result passes |
| `--summary` | check | Print summary counts only |
| `--agents <list>` | init | Comma-separated agents, non-interactive (default: agents,claude) |
| `--all` | init | Target every agent (non-interactive) |
| `--skill` | init | Also install the global Claude skill (opt-in) |
| `-y, --yes` | init | Accept defaults without prompting |

## Behavior

**Auto-caching:** First CLI invocation parses the codebase and saves the index to `.code-visualizer/`. Subsequent commands use the cache only when `git HEAD`, dirty/untracked file contents under the analyzed path, the CLI version, and parser cache settings match. Add `.code-visualizer/` to `.gitignore`.

**Default scanner excludes:** The parser always skips `.git`, `node_modules`, `.code-visualizer`, `.next`, `dist`, `coverage`, `.turbo`, `.cache`, `.worktrees`, and `.claude/worktrees`, even if the target repo has no matching `.gitignore` entry.

**Large repo mode:** Repos above 1500 TypeScript files use a lightweight AST parser by default to avoid TypeScript program OOM. File/import/export/dependency metrics remain available; type-resolved call graph details are reduced. Set `CBI_FULL_PROGRAM_FILE_LIMIT=<n>` to tune the cutoff.

**stdout/stderr:** Results go to stdout. Progress messages go to stderr. Safe for piping (`| jq`, `> file.json`).

**Exit codes:**
- `0` — success
- `1` — runtime error (file not found, no TS files, git unavailable)
- `2` — bad args or usage error

**MCP mode:** Running `codebase-intelligence <path>` without a subcommand starts the MCP stdio server (backward compatible). MCP-specific flags:
- `--index` — persist graph index to `.code-visualizer/` (CLI auto-caches, MCP requires this flag)
- `--status` — print index status and exit
- `--clean` — remove `.code-visualizer/` index and exit
- `--force` — re-index even if the cache signature matches
