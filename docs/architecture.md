# Architecture

## Pipeline

```
CLI (commander)
  |
  v
Parser (TS Compiler API)
  | extracts: files, exports, symbols, type facts, duplicate tokens, imports, LOC, complexity, churn, test mapping
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
  | result builders used by MCP, CLI, and operation descriptors
  |\
  | \-> Operation Registry
  |     typed descriptors, input schemas, CLI/MCP adapters, result wrappers, text formatters
  v
MCP (stdio)                    CLI (terminal/CI)
  | 18 tools, 2 prompts,        | 19 commands with text + JSON
  | 3 resources for LLMs        | output for humans and CI
```

## Module Map

```
src/
  types/index.ts       <- ALL interfaces (single source of truth)
  parser/index.ts      <- Parse orchestration + imports/exports/call sites + git churn/test detection
  parser/type-facts.ts <- Type signatures, parameters, consumed/produced shape facts
  parser/duplication.ts <- Function-body clone token extraction
  parser/symbols.ts    <- Symbol inventory + symbol complexity
  graph/index.ts       <- graphology graph + symbol/type graph + circular dep detection
  analyzer/index.ts    <- All metric computation
  graph-loader/index.ts <- Shared parse/build/analyze/cache pipeline + progress events
  core/index.ts        <- Shared result computation (MCP + CLI)
  operations/index.ts  <- Analysis operation descriptors + typed input schemas
  operations/formatters.ts <- Result-object text formatters for CLI commands
  duplication/index.ts <- Duplicate family detection + trace evidence
  config/index.ts      <- Config discovery + zod validation
  rules/index.ts       <- Rules engine + registry (check command + MCP check tool)
  mcp/index.ts         <- 18 MCP tools for LLM integration
  mcp/hints.ts         <- Operation-keyed next-step hints for MCP tool responses
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
loadCodebaseGraph(rootDir)
  -> cached CodebaseGraph when cache key matches
  -> otherwise emits progress events through parse/build/analyze/cache

parseCodebase(rootDir)
  -> ParsedFile[] (with churn, complexity, test mapping, symbol type facts, duplicate token facts)

buildGraph(parsedFiles)
  -> BuiltGraph { graph: Graph, nodes: GraphNode[], edges: GraphEdge[] }

analyzeGraph(builtGraph, parsedFiles)
  -> CodebaseGraph {
       nodes, edges, symbolNodes, callEdges, symbolMetrics,
       fileMetrics, moduleMetrics, forceAnalysis, stats,
       groups, processes, clusters
     }

startMcpServer(codebaseGraph)
  -> stdio MCP server with 18 tools, 2 prompts, 3 resources

runOperation(operation, codebaseGraph, input, context)
  -> { ok: true, data } | { ok: false, error, data? }
```

## Key Design Decisions

- **Dual interface**: MCP stdio for LLM agents, CLI subcommands for humans/CI. Both consume `src/core/`.
- **Operation registry foundation**: Analysis operations now have typed descriptors in `src/operations/` with operation names, CLI command names, MCP tool names, input schemas, discriminated run results, and result-object text formatters. MCP tool registration and CLI command execution consume those descriptors; CLI JSON remains raw result data plus cache facts.
- **Type/Shape facts**: Full-program parsing stores compact parameter/return/type-parameter facts on parsed symbols. `file`, `symbol`, and `search` JSON expose those facts additively; search indexes consumed/produced shape tokens so agents can ask which symbols touch a shape without a new command.
- **Duplication families**: Parser stores deterministic function-body token streams on symbols. `duplicates` / `find_duplicates` groups symbols into strict, renamed, and near-miss clone families, with optional trace evidence for AI agents before refactors.
- **Dead-code gates**: `check` can opt into unused-file, unused-type, unused-member, and dependency hygiene rules. These rules use graph metrics plus local TypeScript AST facts and emit confidence/evidence in JSON and SARIF.
- **Shared graph-load pipeline**: CLI commands and MCP stdio startup both use `src/graph-loader/` for path checks, legacy cache migration, cache reuse, parse/build/analyze, optional persistence, and stderr progress events.
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

1. **types/index.ts** — Add field to `FileMetrics`, `ParsedFile` / `ParsedExport`, or `SymbolTypeFacts` if extracted at parse time
2. **parser/index.ts / parser/type-facts.ts / parser/symbols.ts** — Extract raw data from AST or external source (git, filesystem)
3. **analyzer/index.ts** — Compute derived metric, store in `fileMetrics` map
4. **operations/index.ts / operations/formatters.ts** — Add or update the operation descriptor, input schema, text formatter, and CLI/MCP mapping
5. **mcp/index.ts / cli.ts** — Expose via existing adapter or new command/tool
6. **Tests** — Cover parser extraction, analyzer computation, operation descriptor parity, and adapter output
