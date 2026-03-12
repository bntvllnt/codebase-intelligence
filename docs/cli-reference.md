# CLI Reference

15 commands for terminal and CI use. Full parity with MCP tools. All commands auto-cache the index to `.code-visualizer/`.

## Commands

### overview

High-level codebase snapshot.

```bash
codebase-intelligence overview <path> [--json] [--force]
```

**Output:** file count, function count, dependency count, modules (path, files, LOC, coupling, cohesion), top 5 depended files, avg LOC, max depth, circular dep count.

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

**Output:** module cohesion verdicts, tension files, bridge files, extraction candidates, summary.

### dead-exports

Find unused exports across the codebase.

```bash
codebase-intelligence dead-exports <path> [--module <module>] [--limit <n>] [--json] [--force]
```

**Output:** dead export count, files with unused exports, summary.

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

## Flags

| Flag | Available On | Description |
|------|-------------|-------------|
| `--json` | All commands | Output stable JSON to stdout |
| `--force` | All commands | Re-parse even if cached index matches HEAD |
| `--metric <m>` | hotspots | Metric to rank by (default: coupling) |
| `--limit <n>` | hotspots, search, dead-exports, processes | Max results |
| `--scope <s>` | changes | Git diff scope: staged, unstaged, all |
| `--depth <n>` | dependents | Max traversal depth (default: 2) |
| `--cohesion <n>` | forces | Min cohesion threshold (default: 0.6) |
| `--tension <n>` | forces | Min tension threshold (default: 0.3) |
| `--escape <n>` | forces | Min escape velocity threshold (default: 0.5) |
| `--module <m>` | dead-exports | Filter by module path |
| `--entry <name>` | processes | Filter by entry point name |
| `--min-files <n>` | clusters | Min files per cluster |
| `--no-dry-run` | rename | Actually perform the rename (default: dry run) |

## Behavior

**Auto-caching:** First CLI invocation parses the codebase and saves the index to `.code-visualizer/`. Subsequent commands use the cache if `git HEAD` hasn't changed. Add `.code-visualizer/` to `.gitignore`.

**stdout/stderr:** Results go to stdout. Progress messages go to stderr. Safe for piping (`| jq`, `> file.json`).

**Exit codes:**
- `0` — success
- `1` — runtime error (file not found, no TS files, git unavailable)
- `2` — bad args or usage error

**MCP mode:** Running `codebase-intelligence <path>` without a subcommand starts the MCP stdio server (backward compatible). MCP-specific flags:
- `--index` — persist graph index to `.code-visualizer/` (CLI auto-caches, MCP requires this flag)
- `--status` — print index status and exit
- `--clean` — remove `.code-visualizer/` index and exit
- `--force` — re-index even if HEAD unchanged
