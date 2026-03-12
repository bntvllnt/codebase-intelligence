# Codebase Intelligence

TypeScript codebase analysis engine. Parses source, builds dependency graphs, computes architectural metrics.

## Setup

```bash
npx codebase-intelligence@latest <path>     # One-shot (no install)
npm install -g codebase-intelligence         # Global install
```

## Interfaces

### MCP (for AI agents — preferred)

Start the MCP stdio server:

```bash
codebase-intelligence ./path/to/project
```

15 tools available: `codebase_overview`, `file_context`, `get_dependents`, `find_hotspots`, `get_module_structure`, `analyze_forces`, `find_dead_exports`, `get_groups`, `symbol_context`, `search`, `detect_changes`, `impact_analysis`, `rename_symbol`, `get_processes`, `get_clusters`.

2 prompts: `detect_impact`, `generate_map`.
3 resources: `codebase://clusters`, `codebase://processes`, `codebase://setup`.

### CLI (for humans and CI)

15 commands — full parity with MCP tools:

```bash
codebase-intelligence overview ./src              # Codebase snapshot
codebase-intelligence hotspots ./src              # Rank files by metric
codebase-intelligence file ./src auth/login.ts    # File context
codebase-intelligence search ./src "auth"         # Keyword search
codebase-intelligence changes ./src               # Git diff analysis
codebase-intelligence dependents ./src types.ts   # File blast radius
codebase-intelligence modules ./src               # Module architecture
codebase-intelligence forces ./src                # Force analysis
codebase-intelligence dead-exports ./src          # Unused exports
codebase-intelligence groups ./src                # Directory groups
codebase-intelligence symbol ./src parseCodebase  # Symbol context
codebase-intelligence impact ./src getUserById    # Symbol blast radius
codebase-intelligence rename ./src old new        # Rename references
codebase-intelligence processes ./src             # Execution flows
codebase-intelligence clusters ./src              # File clusters
```

Add `--json` for machine-readable output. All commands auto-cache the index.

### Tool Selection

| Question | MCP Tool | CLI Command |
|----------|----------|-------------|
| What does this codebase look like? | `codebase_overview` | `overview` |
| Tell me about file X | `file_context` | `file` |
| What are the riskiest files? | `find_hotspots` | `hotspots` |
| Find files related to X | `search` | `search` |
| What changed? | `detect_changes` | `changes` |
| What breaks if I change file X? | `get_dependents` | `dependents` |
| What breaks if I change function X? | `impact_analysis` | `impact` |
| What's architecturally wrong? | `analyze_forces` | `forces` |
| Who calls this function? | `symbol_context` | `symbol` |
| Find all references for rename | `rename_symbol` | `rename` |
| What files naturally group together? | `get_clusters` | `clusters` |
| What can I safely delete? | `find_dead_exports` | `dead-exports` |
| How are modules organized? | `get_module_structure` | `modules` |
| What are the main areas? | `get_groups` | `groups` |
| How does data flow? | `get_processes` | `processes` |

## Documentation

- `docs/architecture.md` — Pipeline, module map, data flow
- `docs/data-model.md` — All TypeScript interfaces
- `docs/metrics.md` — Per-file and module metrics, force analysis
- `docs/mcp-tools.md` — 15 MCP tools with inputs, outputs, use cases
- `docs/cli-reference.md` — CLI commands with examples
- `llms.txt` — AI-consumable doc index
- `llms-full.txt` — Full documentation for context injection

## Metrics

Key file metrics: PageRank, betweenness, fan-in/out, coupling, tension, churn, cyclomatic complexity, blast radius, dead exports, test coverage.

Module metrics: cohesion, escape velocity, verdict (LEAF/COHESIVE/MODERATE/JUNK_DRAWER).

Force analysis: tension files, bridge files, extraction candidates.

## Project Structure

```
src/
  cli.ts              Entry point + CLI commands
  core/index.ts       Shared computation (used by MCP + CLI)
  types/index.ts      All interfaces (single source of truth)
  parser/index.ts     TypeScript AST parser
  graph/index.ts      Dependency graph builder (graphology)
  analyzer/index.ts   Metric computation engine
  mcp/index.ts        MCP stdio server (15 tools)
  impact/index.ts     Symbol-level impact analysis
  search/index.ts     BM25 search engine
  process/index.ts    Entry point + call chain tracing
  community/index.ts  Louvain clustering
  persistence/index.ts Graph cache (.code-visualizer/)
```
