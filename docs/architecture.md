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
  | 15 tools, 2 prompts,        | 5 commands: overview, hotspots,
  | 3 resources for LLMs        | file, search, changes + --json
```

## Module Map

```
src/
  types/index.ts       <- ALL interfaces (single source of truth)
  parser/index.ts      <- TS AST extraction + git churn + test detection
  graph/index.ts       <- graphology graph + circular dep detection
  analyzer/index.ts    <- All metric computation
  core/index.ts        <- Shared result computation (MCP + CLI)
  mcp/index.ts         <- 15 MCP tools for LLM integration
  mcp/hints.ts         <- Next-step hints for MCP tool responses
  impact/index.ts      <- Symbol-level impact analysis + rename planning
  search/index.ts      <- BM25 search engine
  process/index.ts     <- Entry point detection + call chain tracing
  community/index.ts   <- Louvain clustering
  persistence/index.ts <- Graph export/import to .code-visualizer/
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
  -> stdio MCP server with 15 tools, 2 prompts, 3 resources
```

## Key Design Decisions

- **Dual interface**: MCP stdio for LLM agents, CLI subcommands for humans/CI. Both consume `src/core/`.
- **graphology**: In-memory graph with O(1) neighbor lookup. PageRank and betweenness computed via graphology-metrics.
- **Batch git churn**: Single `git log --all --name-only` call, parsed for all files. Avoids O(n) subprocess spawning.
- **Dead export detection**: Cross-references parsed exports against edge symbol lists. May miss `import *` or re-exports (known limitation).
- **Graceful degradation**: Non-git dirs get churn=0, no-test codebases get coverage=false. Never crashes.
- **Graph persistence**: CLI commands always cache the graph index to `.code-visualizer/`. MCP mode (`codebase-intelligence <path>`) requires `--index` to persist the cache.

## Adding a New Metric

Vertical slice through all layers:

1. **types/index.ts** — Add field to `FileMetrics` (and `ParsedFile`/`ParsedExport` if extracted at parse time)
2. **parser/index.ts** — Extract raw data from AST or external source (git, filesystem)
3. **analyzer/index.ts** — Compute derived metric, store in `fileMetrics` map
4. **mcp/index.ts** — Expose via `find_hotspots` enum or new tool
5. **Tests** — Cover parser extraction + analyzer computation
