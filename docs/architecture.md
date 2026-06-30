# Architecture

## Pipeline

```
CLI (commander)
  |
  v
Parser (TS Compiler API)
  | extracts: files, exports, imports, LOC, complexity, churn, test mapping
  v
Graph Builder (graphology)
  | creates: nodes (file + function), edges (imports with symbols/weights)
  | detects: circular dependencies (iterative DFS)
  v
Analyzer
  | computes: PageRank, betweenness, coupling, tension, cohesion
  | computes: churn, complexity, blast radius, dead exports, test coverage
  | produces: ForceAnalysis (tension files, bridges, extraction candidates)
  v
Core (shared computation)
  | result builders used by both MCP and CLI
  v
MCP (stdio)                    CLI (terminal/CI)
  | 17 tools, 2 prompts,        | 18 commands with text + JSON
  | 3 resources for LLMs        | output for humans and CI
```

## Module Map

```
src/
  types/index.ts       <- ALL interfaces (single source of truth)
  parser/index.ts      <- TS AST extraction + git churn + test detection
  graph/index.ts       <- graphology graph + circular dep detection
  analyzer/index.ts    <- All metric computation
  core/index.ts        <- Shared result computation (MCP + CLI)
  config/index.ts      <- Config discovery + zod validation
  rules/index.ts       <- Rules engine + registry (check command + MCP check tool)
  mcp/index.ts         <- 17 MCP tools for LLM integration
  mcp/hints.ts         <- Next-step hints for MCP tool responses
  impact/index.ts      <- Symbol-level impact analysis + rename planning
  search/index.ts      <- BM25 search engine
  process/index.ts     <- Entry point detection + call chain tracing
  community/index.ts   <- Louvain clustering
  persistence/index.ts <- Graph export/import to .codebase-intelligence/
  persistence/index-dir.ts <- Canonical cache path + legacy .code-visualizer/ migration
  persistence/cache-key.ts <- Cache signature from HEAD, worktree content, CLI version, parser settings
  install/index.ts     <- Agent adoption: managed-block engine + per-agent file targets + skill
  server/graph-store.ts <- Global graph state (shared by CLI + MCP)
  cli.ts               <- Entry point, CLI commands + MCP fallback
```

## Data Flow

```
parseCodebase(rootDir)
  -> ParsedFile[] (with churn, complexity, test mapping)

buildGraph(parsedFiles)
  -> BuiltGraph { graph: Graph, nodes: GraphNode[], edges: GraphEdge[] }

analyzeGraph(builtGraph, parsedFiles)
  -> CodebaseGraph {
       nodes, edges, symbolNodes, callEdges, symbolMetrics,
       fileMetrics, moduleMetrics, forceAnalysis, stats,
       groups, processes, clusters
     }

startMcpServer(codebaseGraph)
  -> stdio MCP server with 17 tools, 2 prompts, 3 resources
```

## Key Design Decisions

- **Dual interface**: MCP stdio for LLM agents, CLI subcommands for humans/CI. Both consume `src/core/`.
- **graphology**: In-memory graph with O(1) neighbor lookup. PageRank and betweenness computed via graphology-metrics.
- **Batch git churn**: Single `git log --all --name-only` call, parsed for all files. Avoids O(n) subprocess spawning.
- **Monorepo import resolution**: Root `tsconfig.json` path aliases and local `package.json` package names resolve to source files before graph construction.
- **Large repo fallback**: Above 1500 TypeScript files, the parser uses AST-only extraction to keep file/import/export analysis available without TypeScript program OOM.
- **Dead export detection**: Cross-references parsed exports against edge symbol lists. May miss `import *` or re-exports (known limitation).
- **Graceful degradation**: Non-git dirs get churn=0, no-test codebases get coverage=false. Never crashes.
- **Built-in scanner excludes**: Generated indexes, build outputs, coverage, framework caches, and agent worktrees are skipped before TypeScript program creation.
- **Graph persistence**: CLI commands always cache the graph index to `.codebase-intelligence/`. A legacy `.code-visualizer/` cache is migrated when canonical cache is absent. Cache reuse requires matching HEAD, dirty/untracked file-content fingerprint, CLI version, and parser cache settings. MCP mode (`codebase-intelligence <path>`) requires `--index` to persist the cache.

## Adding a New Metric

Vertical slice through all layers:

1. **types/index.ts** — Add field to `FileMetrics` (and `ParsedFile`/`ParsedExport` if extracted at parse time)
2. **parser/index.ts** — Extract raw data from AST or external source (git, filesystem)
3. **analyzer/index.ts** — Compute derived metric, store in `fileMetrics` map
4. **mcp/index.ts** — Expose via `find_hotspots` enum or new tool
5. **Tests** — Cover parser extraction + analyzer computation
