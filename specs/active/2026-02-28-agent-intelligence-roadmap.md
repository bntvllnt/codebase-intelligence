---
title: Agent Intelligence Roadmap
status: active
created: 2026-02-28
estimate: 100h (6 phases, each 8-25h)
tier: standard
semver: 2.0.0 (Phase 1 re-export fix is breaking metric change)
---

# Agent Intelligence Roadmap

## Context

codebase-intelligence has strong 3D visualization + file-level metrics but weak agent tooling. GitNexus proves that precomputed symbol-level intelligence (call graphs, process tracing, community detection, search) makes coding agents 5-10x more effective. Goal: surpass GitNexus on both fronts — richer UI for humans AND more complete MCP tools for AI agents.

Current state: 8 MCP tools (file-level), 8 UI views (3D), 74 tests.
Target state: 13+ MCP tools (symbol-level), 6 MCP resources, 2 MCP prompts, enhanced UI views, persistent JSON index in `.code-visualizer/`. No embedded AI chat — MCP is the interface; external agents (Claude Code, Codex, OpenCode, Cursor) connect via stdio + HTTP/SSE transports.

## Architecture Principles

### Single Source of Truth: Backend Pipeline

```
                    SINGLE SOURCE OF TRUTH
                    ─────────────────────
TS Files on disk
    │
    ▼
┌──────────┐    ┌───────────┐    ┌────────────┐    ┌─────────────┐
│  Parser  │───▶│   Graph   │───▶│  Analyzer  │───▶│ Graph Store │
│ (TS AST) │    │(graphology)│    │ (metrics)  │    │ (globalThis)│
└──────────┘    └───────────┘    └────────────┘    └──────┬──────┘
                                                          │
                              ┌────────────────────────────┤
                              │                            │
                         ┌────▼─────┐               ┌─────▼──────┐
                         │ MCP Tools│               │ API Routes │
                         │ (stdio + │               │ (Next.js)  │
                         │  HTTP)   │               └─────┬──────┘
                         └──────────┘                     │
                              │                     ┌─────▼──────┐
                         Agents read                │  React UI  │
                         from MCP                   │(consumes   │
                                                    │ API only)  │
                                                    └────────────┘
```

**Rules:**
- Pipeline computes ALL data (parser → graph → analyzer → store)
- MCP tools and API routes READ from the store — never compute independently
- UI components FETCH from API routes — never import pipeline modules
- If a value is needed in the UI, it MUST exist as an API response field first
- MCP tools and API routes return the SAME data for the same query (shared logic)

### Implementation Order (per feature)

```
1. Types          ← define the shape
2. Pipeline       ← parser → graph → analyzer (compute the data)
3. MCP tool       ← expose to agents (primary consumer)
4. API route      ← expose to UI (mirrors MCP response shape)
5. UI component   ← render from API (last, only if needed)
```

**Never build UI without API. Never build API without pipeline. Types first, always.**

## Testing Strategy

### TDD Protocol (MANDATORY)

Every scope item follows RED → GREEN → REFACTOR:

```
┌─────────┐    ┌─────────┐    ┌──────────┐
│  RED    │───▶│  GREEN  │───▶│ REFACTOR │
│ (write  │    │ (minimal│    │ (clean   │
│  failing│    │  impl   │    │  up,     │
│  test)  │    │  to     │    │  no new  │
│         │    │  pass)  │    │  behavior│
└─────────┘    └─────────┘    └──────────┘
```

- **RED**: Write the test first. It MUST fail. Commit if meaningful.
- **GREEN**: Write the minimum code to make the test pass. No more.
- **REFACTOR**: Clean up without changing behavior. All tests still pass.

### E2E Test Fixture: The Fake Codebase

All tests run against a **real TypeScript project on disk** — a fully realistic fake codebase that exercises every feature. No mocking. No stubs. No fake graph objects.

```
tests/
  fixture-codebase/           ← a REAL TypeScript project
    tsconfig.json             ← real TS config with path aliases
    package.json              ← real package.json
    src/
      index.ts                ← barrel re-exports
      auth/
        auth-service.ts       ← class with methods, calls user-service
        auth-middleware.ts     ← function, calls auth-service.validate()
        index.ts              ← re-exports from auth-service
      users/
        user-service.ts       ← class, called by auth-service
        user-repository.ts    ← data layer, called by user-service
        user-types.ts         ← interfaces + types (type-only exports)
        index.ts              ← barrel re-exports
      api/
        routes.ts             ← entry point: imports auth + users
        middleware.ts          ← imports auth-middleware
      utils/
        logger.ts             ← used by many files (high fan-in)
        helpers.ts             ← internal functions (not exported)
        validators.ts         ← called via callback pattern
      config/
        settings.ts           ← dead exports (unused by anyone)
        constants.ts          ← type-only + value exports mixed
      __tests__/
        auth-service.test.ts  ← test file for coverage detection
    expected/
      call-graph.json         ← ground truth: every expected call edge
      file-graph.json         ← ground truth: every expected import edge
      symbols.json            ← ground truth: every expected symbol
      clusters.json           ← expected cluster groupings (approximate)
      processes.json          ← expected execution flows
```

**Fixture design principles:**
- Real `tsconfig.json` with `paths` aliases (`@/` → `src/`)
- Real class inheritance (`AuthService extends BaseService`)
- Real callback patterns (`validators.ts` called via `arr.filter(validate)`)
- Real dynamic dispatch patterns (method calls on typed interfaces)
- Dead exports in `settings.ts` (test dead export detection)
- Barrel re-exports in every `index.ts` (test re-export resolution)
- Mixed type-only and value imports (test `isTypeOnly` handling)
- Entry points (`routes.ts`, `middleware.ts`) with no inbound calls (test process tracing)
- Cross-module calls (auth → users → utils) for clustering validation
- High fan-in file (`logger.ts`) for metric validation
- Git history (init + commits) for churn and change detection tests

### Test Layers (all E2E, no mocking)

| Layer | How Tests Work | Example |
|-------|---------------|---------|
| **Parser** | `parseCodebase("tests/fixture-codebase/src")` → assert against `expected/symbols.json` | "auth-service.ts exports AuthService with 3 methods" |
| **Graph** | `buildGraph(parsedFiles)` → assert against `expected/file-graph.json` + `expected/call-graph.json` | "auth-service.ts → user-service.ts edge exists with symbols ['UserService']" |
| **Analyzer** | `analyzeGraph(builtGraph, files)` → assert metrics against known values | "logger.ts has fan-in >= 5 because 5+ files import it" |
| **MCP tools** | Real `McpServer` instance with real graph → call tool → assert response | `symbol_context({symbol: "AuthService"})` → callers include "routes.ts" |
| **API routes** | Real Next.js route handler with real graph in `globalThis` → assert JSON response | `GET /api/search?q=auth` → results include auth-service.ts |
| **Persistence** | Write graph to `.code-visualizer/`, restart, read back → assert identical | Round-trip: `export()` → JSON → `import()` → same node/edge count |
| **Transport** | Real HTTP server + real MCP client → call tool → assert response | HTTP `symbol_context` returns same as stdio `symbol_context` |
| **CLI** | `execFileSync("node", ["dist/cli.js", "tests/fixture-codebase/src", "--mcp"])` → assert output | CLI parses fixture, outputs valid MCP JSON |

### What is NEVER mocked

- Internal modules (parser, graph, analyzer, search, process, community)
- graphology (build real graphs)
- Express/Next.js (use real request handlers)
- Filesystem (use real fixture files on disk)
- MCP server (use real McpServer instance)
- Git (init a real git repo in fixture for churn/change tests)

### What CAN be mocked (external only)

- Network requests to external APIs (none currently)
- System clock (if time-sensitive tests needed)

### Test Naming Convention

```
{module}.test.ts              ← unit-level E2E (one module, real data)
{module}.integration.test.ts  ← cross-module E2E (pipeline, real data)
{feature}.e2e.test.ts         ← full stack E2E (CLI/server, real data)
```

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/types/index.ts` | MODIFY | Add SymbolNode, CallEdge, ProcessFlow, Cluster, SearchResult types |
| `src/parser/index.ts` | MODIFY | Add call-site extraction with confidence tags, re-export fixing, fix class node type bug |
| `tests/fixture-codebase/` | CREATE | Full fake TS project (15+ files, tsconfig, package.json, git repo, ground-truth expected outputs) |
| `src/graph/index.ts` | MODIFY | Add callGraph (separate graphology instance), symbol nodes with real edges, remove function orphans from file graph |
| `src/analyzer/index.ts` | MODIFY | Add community detection (Louvain on undirected projection), process tracing, per-symbol fan-in/fan-out, fix analyze_forces thresholds |
| `src/mcp/index.ts` | MODIFY | Add 5 new tools, 6 resources, 2 prompts, fix file_context class type bug |
| `src/mcp/hints.ts` | CREATE | Next-step hint generator — all tools return actionable `nextSteps` |
| `src/mcp/transport.ts` | CREATE | Dual MCP transport: two McpServer instances (stdio + HTTP) sharing graph data |
| `src/server/graph-store.ts` | MODIFY | Add staleness detection (HEAD hash tracking) |
| `src/cli.ts` | MODIFY | Add --index, --force, --status, --clean flags |
| `src/search/` | CREATE | New module: BM25 keyword search engine (no semantic/embeddings) |
| `src/process/` | CREATE | New module: entry point detection + call chain tracing |
| `src/community/` | CREATE | New module: Louvain clustering over undirected call graph projection |
| `src/persistence/` | CREATE | New module: graph serialization to JSON in `.code-visualizer/` per project |
| `components/FileTree/` | CREATE | File tree sidebar (consumes GET /api/graph, never imports pipeline) |
| `components/ProcessFlow/` | CREATE | Process flow visualization (consumes GET /api/processes) |
| `components/CodeRefs/` | CREATE | Code references panel (consumes GET /api/symbols/:name) |
| `app/api/search/` | CREATE | Search endpoint (delegates to search module) |
| `app/api/symbols/` | CREATE | Symbol-level query endpoint (delegates to graph store) |
| `app/api/changes/` | CREATE | Git diff → affected symbols endpoint (delegates to detect_changes logic) |

**Files:** 10 create | 7 modify | all API routes affected (additive fields)
**Reuse:** graphology (existing), TypeScript checker API (exists in parser)
**Breaking changes:** Phase 1 changes export counts for barrel files (re-export fix) → semver bump to 2.0.0. `get_dependents` deprecated in favor of `impact_analysis` (Phase 4).
**New dependencies:** graphology-communities-louvain (clustering). No native deps — JSON persistence, no SQLite, no transformers.js.

**Decisions (user-confirmed):**
1. **Persistence:** JSON files in `.code-visualizer/` per project (no SQLite, no native deps)
2. **Search:** BM25 only, no semantic/embeddings (agents search by keywords/symbols, not intent)
3. **No AI chat panel:** MCP is the interface — external agents connect via MCP, not embedded chat
4. **MCP transports:** stdio (Claude Code, OpenCode, Cursor) + HTTP/SSE (Codex, web agents)
5. **TDD:** RED → GREEN → REFACTOR for every scope item. Tests written first.
6. **E2E only:** All tests run against real fixture codebase. No mocking internal modules.
7. **API/MCP first:** Backend pipeline = single truth. MCP tools + API routes before UI. UI consumes API.

**Decisions (plan-review):**
8. **Dual transport = two McpServer instances:** SDK's `connect()` accepts one transport. Two instances sharing same graph data via `globalThis`.
9. **Louvain on undirected projection:** Louvain is defined for undirected graphs. Convert directed call graph to undirected before clustering.
10. **Call edge confidence tags:** Every `CallEdge` has `confidence: "type-resolved" | "text-inferred"` field. Agents can filter by confidence.
11. **Remove function orphans from file graph:** Currently dilute PageRank/betweenness. Move to call graph only.
12. **HTTP transport auth:** Bind to `127.0.0.1` only + optional bearer token. MCP exposes full codebase data.
13. **No class hierarchy extraction:** Call graph reveals coupling. Heritage adds parser complexity for low agent value.
14. **Fix existing bugs in Phase 1:** `file_context` hardcodes `type: "function"` for class nodes. `analyze_forces` ignores threshold params.

## User Journey (MANDATORY)

### Primary Journey: AI Agent

ACTOR: Coding agent (Claude Code, Codex, OpenCode, Cursor)
GOAL: Understand codebase deeply and make safe changes fast
PRECONDITION: Repo indexed, MCP server running

1. Agent connects to MCP server (stdio or HTTP/SSE)
   → System exposes tools + resources + prompts
   → Agent reads `codebase://setup` resource for onboarding

2. Agent asks "how does auth work?"
   → System runs BM25 search over symbol graph
   → Agent receives ranked results with file + symbol locations (file-grouped in Phase 2, process-grouped after Phase 3)

3. Agent needs to change `UserService.login()`
   → System returns 360° symbol context: callers, callees, process participation, confidence tags
   → Agent sees blast radius: d=1 WILL BREAK (3 files), d=2 LIKELY AFFECTED (7 files)

4. Agent makes changes
   → System detects changed symbols from git diff
   → Agent gets risk summary: affected symbols, affected files, test recommendations

5. Agent renames `getUserById` → `findUserById`
   → System provides multi-file rename plan with confidence tags (type-resolved vs text-inferred)
   → Agent applies rename across all references

POSTCONDITION: Agent has full codebase knowledge, changes are safe, rename is complete

### Primary Journey: Human Developer

ACTOR: Developer using web UI
GOAL: Understand codebase architecture and find hotspots
PRECONDITION: Server running with parsed codebase

1. Developer opens web UI
   → System shows 3D galaxy view + file tree + project stats
   → Developer sees architecture at a glance

2. Developer searches for a symbol in the search bar
   → UI calls `GET /api/search?q=auth` → renders ranked results
   → Developer clicks result → graph flies to node

3. Developer clicks a function in the graph
   → UI calls `GET /api/symbols/AuthService` → renders code references panel
   → Developer navigates the call chain visually

4. Developer views process flow
   → UI calls `GET /api/processes` → renders step-by-step trace
   → Developer understands the full execution path

POSTCONDITION: Developer has deep architectural understanding without reading code

### Error Journeys

E1. Search returns no results
  Trigger: Query doesn't match any symbols
  1. Agent/user searches for "authentication"
     → System returns empty results with suggestion: "Did you mean: auth, login, session?"
  Recovery: Agent refines query

E2. Index is stale
  Trigger: Code changed since last index
  1. Agent reads resource
     → System reports staleness: "Index is 15 commits behind HEAD"
     → Agent calls reindex tool or user runs CLI
  Recovery: Fresh index, accurate results

E3. Git not available
  Trigger: No git repository or git not installed
  1. Agent calls `detect_changes`
     → System returns error: "Git not available. Change detection requires a git repository."
  2. Churn metrics return 0 (graceful degradation, not error)
  Recovery: Other tools still work; change detection disabled

### Edge Cases

EC1. Circular call chains: Process tracing detects cycles, reports them as loops not infinite traces
EC2. Very large codebases (10k+ files): Chunked processing, memory-bounded caching
EC3. No git history: Churn/change detection gracefully degrades (returns empty, not error)
EC4. Multi-language files: Future phase; TS/TSX-only with clean extension points
EC5. Disconnected symbol subgraphs: `impact_analysis` returns depth-0 results with clear "no dependents found" message
EC6. Re-export deduplication: Same symbol re-exported from barrel — deduplicate by resolved source file, not re-exporter

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING — all must pass to ship)

- [ ] AC-1: GIVEN a parsed codebase WHEN agent calls `search` tool with "auth" THEN receives ranked results with file + symbol locations
- [ ] AC-2: GIVEN a symbol name WHEN agent calls `symbol_context` tool THEN receives incoming refs (callers, importers) with confidence tags, outgoing refs (callees, imports), file location, metrics, nextSteps hints
- [ ] AC-3: GIVEN a file with changes WHEN agent calls `detect_changes` with scope "unstaged" THEN receives list of changed symbols, affected files, risk summary
- [ ] AC-4: GIVEN a symbol WHEN agent calls `impact_analysis` THEN receives depth-grouped dependents (d=1 WILL BREAK, d=2 LIKELY, d=3 MAY NEED TESTING) with risk level and affected modules
- [ ] AC-5: GIVEN codebase is parsed WHEN agent reads `codebase://clusters` resource THEN receives functional clusters with cohesion scores and member lists
- [ ] AC-6: GIVEN codebase is parsed WHEN agent reads `codebase://processes` resource THEN receives detected execution flows with entry points and step counts
- [ ] AC-7: GIVEN the web UI WHEN user clicks a node THEN code references panel shows callers/callees fetched from `GET /api/symbols/:name`
- [ ] AC-8: GIVEN MCP server running WHEN agent connects via HTTP/SSE transport THEN all tools/resources/prompts are accessible (same as stdio)
- [ ] AC-9: GIVEN stale index WHEN agent reads any resource THEN response includes staleness warning with commit count behind
- [ ] AC-10: GIVEN codebase WHEN agent reads `codebase://setup` resource THEN receives project stack, conventions, entry points, available tools

### Error Criteria (BLOCKING — all must pass)

- [ ] AC-E1: GIVEN search with no matches WHEN agent calls `search` THEN receives empty results with suggestion alternatives, not an error
- [ ] AC-E2: GIVEN ambiguous symbol name WHEN agent calls `symbol_context` THEN receives disambiguation list (file + export name for each match)
- [ ] AC-E3: GIVEN git unavailable WHEN agent calls `detect_changes` THEN receives clear error message, other tools unaffected

### Should Have (ship without, fix soon)

- [ ] AC-11: GIVEN codebase WHEN user opens file tree panel THEN sees navigable tree fetched from API that fly-to-focuses nodes on click
- [ ] AC-12: GIVEN a process WHEN user clicks it THEN sees step-by-step flow visualization fetched from API
- [ ] AC-13: GIVEN a symbol name WHEN agent calls `rename_symbol` with dry_run=true THEN receives multi-file rename plan with confidence tags per reference

## Scope

### Phase 0: Test Fixture & Validation (~5h)

Build the real fake codebase that ALL subsequent tests run against. No implementation code — only test infrastructure.

- [ ] 0.1 Create `tests/fixture-codebase/` — full TypeScript project: `tsconfig.json` (with `@/` path aliases), `package.json`, 15+ `.ts` files across 5 modules (auth, users, api, utils, config)
- [ ] 0.2 Design fixture to cover: classes + methods, function calls across modules, barrel re-exports, callback patterns, dead exports, type-only imports, high fan-in file, entry points (no inbound calls), mixed default + named exports
- [ ] 0.3 Init git repo in fixture: `git init` + 3+ commits touching different files (for churn + change detection tests)
- [ ] 0.4 Write `tests/fixture-codebase/expected/` ground truth files: `call-graph.json` (every expected call edge with confidence), `file-graph.json` (every expected import edge), `symbols.json` (every expected symbol with type + file), `processes.json` (expected execution flows)
- [ ] 0.5 Write `tests/helpers/pipeline.ts` — shared test helper that runs full pipeline (parse → build → analyze) on fixture codebase. Returns `CodebaseGraph`. Cached across tests (run once per test suite).
- [ ] 0.6 Verify `graphology-communities-louvain` works with graphology@0.25.4: `pnpm add graphology-communities-louvain`, run on small test graph, confirm undirected projection works
- [ ] 0.7 Verify HTTP/SSE agent compatibility: research Codex MCP transport docs. If unverified, HTTP transport is best-effort (not blocking)

### Phase 1: Symbol-Level Graph Foundation (~25h) → AC-2, AC-7

TDD order: write failing test → implement → refactor. Types → pipeline → MCP → API → UI.

**RED: Write failing tests first**

- [ ] 1.1 TEST: parser re-export resolution — assert fixture barrel `index.ts` files expose transitive exports (currently fails: `__export` skipped)
- [ ] 1.2 TEST: `file_context` tool returns correct type for class exports — assert `type: "class"` not `type: "function"` (currently fails)
- [ ] 1.3 TEST: `analyze_forces` responds to threshold params — assert different thresholds produce different results (currently fails: params ignored)
- [ ] 1.4 TEST: file graph PageRank excludes orphan function nodes — assert only file nodes participate in centrality (currently fails: orphans dilute scores)
- [ ] 1.5 TEST: parser extracts call sites from fixture — assert `auth-service.ts` calls `user-service.ts::getUserById` with confidence `"type-resolved"` (currently fails: no call extraction)
- [ ] 1.6 TEST: call graph contains symbol nodes with edges — assert `AuthService.validate` → `UserService.getUserById` edge exists (currently fails: no call graph)
- [ ] 1.7 TEST: per-symbol fan-in/fan-out — assert `logger.log` has fan-in >= 5 in fixture (currently fails: no symbol metrics)
- [ ] 1.8 TEST: `symbol_context` MCP tool — assert calling with `"AuthService"` returns callers, callees, metrics, nextSteps (currently fails: tool doesn't exist)
- [ ] 1.9 TEST: `GET /api/symbols/AuthService` returns same data as MCP tool (currently fails: route doesn't exist)
- [ ] 1.10 TEST: hints module — assert each tool name maps to relevant next-step suggestions (currently fails: module doesn't exist)

**GREEN: Implement to pass tests**

- [ ] 1.11 Types: add `CallSite`, `CallEdge` (with `confidence` field), `SymbolNode`, `SymbolMetrics` to `src/types/index.ts`
- [ ] 1.12 Parser: fix re-export extraction — `checker.getExportsOfModule()` instead of skipping `__export`. Deduplicate by resolved source file.
- [ ] 1.13 Parser: extract call sites — visit `ts.CallExpression` nodes, resolve callee via `checker.getSymbolAtLocation()`. Tag confidence: `"type-resolved"` if checker resolves, `"text-inferred"` if regex fallback.
- [ ] 1.14 Graph: remove function orphan nodes from file graph. Only file nodes in import graph.
- [ ] 1.15 Graph: build separate call graph — symbol nodes + call edges (confidence-tagged) in new graphology instance on `BuiltGraph`.
- [ ] 1.16 Analyzer: per-symbol fan-in/fan-out from call graph (O(N) degree counts).
- [ ] 1.17 Analyzer: fix `analyze_forces` — accept threshold params, re-run computation with user values (cache hardcoded defaults).
- [ ] 1.18 MCP: fix `file_context` — use `ParsedExport.type` instead of hardcoded `"function"`.
- [ ] 1.19 MCP: create `src/mcp/hints.ts` — per-tool next-step hint generator.
- [ ] 1.20 MCP: register `symbol_context` tool — 360° view with callers (confidence-tagged), callees, metrics, nextSteps.
- [ ] 1.21 API: `GET /api/symbols/:name` route — delegates to same logic as `symbol_context` MCP tool. Same response shape.
- [ ] 1.22 UI: Code references panel component — fetches from `GET /api/symbols/:name`, renders callers/callees with confidence indicators + navigate action.

**REFACTOR + CHECKPOINT**

- [ ] 1.23 Refactor: clean up, ensure all tests pass, no regressions in existing 74 tests
- [ ] 1.24 **15h checkpoint**: Measure false-positive rate against ground-truth `call-graph.json`. If >30%, evaluate pivot to text-based approach.

### Phase 2: Search & MCP Transport (~15h) → AC-1, AC-8, AC-E1

**RED first**

- [x] 2.1 TEST: BM25 search — assert searching "auth" in fixture returns `auth-service.ts` ranked above `config/settings.ts`. Assert camelCase tokenization splits `getUserById` into searchable terms.
- [x] 2.2 TEST: BM25 empty results — assert searching "nonexistent" returns empty results with suggestion alternatives (closest matches).
- [x] 2.3 TEST: `search` MCP tool — assert returns file-grouped results with symbol locations and nextSteps hints.
- [x] 2.4 TEST: HTTP/SSE transport — start real HTTP server, connect real MCP client, call `search` tool, assert response matches stdio response.
- [x] 2.5 TEST: `GET /api/search?q=auth` — assert returns same data shape as MCP search tool.
- [x] 2.6 TEST: hints on existing tools — assert `codebase_overview` response includes `nextSteps` array.

**GREEN**

- [x] 2.7 Create `src/search/index.ts`: BM25 engine — tokenizer (camelCase split + lowercasing), IDF computation, document scoring. Index built from symbol names + file paths + export signatures.
- [x] 2.8 MCP: register `search` tool — BM25 search with file-grouped results, nextSteps hints. Suggestion generation on empty results (fuzzy match top-5 closest terms).
- [x] 2.9 MCP: create `src/mcp/transport.ts` — stateless HTTP transport creating fresh McpServer per request, shared `registerTools()` function. HTTP via `StreamableHTTPServerTransport` bound to `127.0.0.1`.
- [x] 2.10 MCP: retrofit `nextSteps` hints on all 10 tools (additive — appended to every response).
- [x] 2.11 API: `GET /api/search?q=&limit=` route — delegates to search module, same response shape as MCP tool.

**REFACTOR**

- [x] 2.12 Refactor: extracted `registerTools()` shared function, all 129 tests green, no regressions

### Phase 3: Execution Intelligence & Persistence (~18h) → AC-3, AC-5, AC-6, AC-9, AC-10, AC-12

**RED first**

- [x] 3.1 TEST: persistence round-trip — write graph to JSON, read back, assert identical node/edge counts and attributes.
- [x] 3.2 TEST: staleness detection — assert stale=true when HEAD differs from indexed commit.
- [x] 3.3 TEST: entry point detection — assert `routes.ts` and `middleware.ts` identified as entry points.
- [x] 3.4 TEST: call chain tracing — assert process from `routes.ts` traces through auth → users with step indices.
- [x] 3.5 TEST: circular call chain — assert processes have bounded depth (no infinite trace).
- [x] 3.6 TEST: Louvain clustering — assert cluster count 2-10, all nodes assigned, cohesion >= 0.
- [x] 3.7 TEST: `detect_changes` MCP tool — assert tool is registered on server.
- [ ] 3.8 TEST: `detect_changes` without git — todo (requires isolated env without git).
- [x] 3.9 TEST: MCP resources — assert clusters, processes, setup resources registered via HTTP transport.
- [ ] 3.10 TEST: `GET /api/changes` — todo (deferred to Phase 4).

**GREEN**

- [x] 3.11 Create `src/persistence/index.ts`: serialize graph to JSON + HEAD hash. Import reconstructs Maps from arrays.
- [x] 3.12 Staleness: `setIndexedHead`/`getStaleness` in graph-store.ts. Compares current HEAD vs stored.
- [x] 3.13 Create `src/process/index.ts`: entry point detection (no inbound call edges), BFS call chain tracing, cycle detection via visited set.
- [x] 3.14 Create `src/community/index.ts`: undirected graph from file edges, Louvain clustering, per-cluster cohesion scores.
- [x] 3.15 MCP: register `detect_changes` tool — git diff → symbols → affected files. Graceful error when git unavailable.
- [x] 3.16 MCP: register resources — `codebase://clusters`, `codebase://processes`, `codebase://setup`.
- [ ] 3.17 API: `GET /api/changes` — deferred to Phase 4.
- [x] 3.18 API: `GET /api/processes` — returns process list from analyzer.
- [ ] 3.19 UI: Process flow visualization — deferred to Phase 5.

**REFACTOR**

- [x] 3.20 Refactor: 142 tests pass, 0 failures, all quality gates green

### Phase 4: Impact & Refactoring Tools (~12h) → AC-4, AC-13

**RED first**

- [ ] 4.1 TEST: `impact_analysis` — assert changing `UserService.getUserById` in fixture returns depth-grouped results: d=1 includes `AuthService`, d=2 includes `routes.ts`.
- [ ] 4.2 TEST: `impact_analysis` on disconnected symbol — assert returns depth-0 with "no dependents found".
- [ ] 4.3 TEST: `rename_symbol` dry_run — assert renaming `getUserById` to `findUserById` returns plan listing all files + line numbers with confidence tags per reference.
- [ ] 4.4 TEST: `rename_symbol` apply — copy fixture to temp dir, apply rename, assert all references updated, TypeScript still compiles.
- [ ] 4.5 TEST: search results now include process grouping (Phase 3 traces available).
- [ ] 4.6 TEST: `get_dependents` response includes deprecation notice pointing to `impact_analysis`.
- [ ] 4.7 TEST: MCP prompts — assert `detect_impact` prompt returns structured workflow, `generate_map` returns architecture description.

**GREEN**

- [ ] 4.8 MCP: register `impact_analysis` tool — BFS from symbol through call graph, depth-label results (d=1 WILL BREAK, d=2 LIKELY, d=3 MAY NEED TESTING), include affected processes + modules.
- [ ] 4.9 MCP: register `rename_symbol` tool — graph-based refs (confidence: `"type-resolved"`) + text-search refs (confidence: `"text-inferred"`). `dry_run=true` enforced default. Apply mode writes to disk only with explicit `dry_run: false`.
- [ ] 4.10 MCP: register prompts — `detect_impact` (pre-commit workflow), `generate_map` (architecture doc generation).
- [ ] 4.11 MCP: upgrade `search` results to process-grouped when process traces available.
- [ ] 4.12 MCP: add deprecation notice to `get_dependents` → points to `impact_analysis`.

**REFACTOR**

- [ ] 4.13 Refactor: clean up, all tests green, no regressions

### Phase 5: UI Enhancement (~8h) → AC-11

All UI components consume API routes. No pipeline imports.

**RED first**

- [ ] 5.1 TEST: file tree renders from `GET /api/graph` response (directory grouping, click-to-focus)
- [ ] 5.2 TEST: search bar calls `GET /api/search`, renders results, click flies to node
- [ ] 5.3 TEST: disambiguation picker shown when `GET /api/symbols/:name` returns multiple matches
- [ ] 5.4 TEST: staleness banner shown when `GET /api/meta` reports stale index

**GREEN**

- [ ] 5.5 File tree panel: fetches graph from API, groups by directory, click-to-focus, search filter
- [ ] 5.6 Enhanced search bar: calls `GET /api/search`, renders ranked results, fly-to on click
- [ ] 5.7 Symbol disambiguation UI: renders picker from API disambiguation response
- [ ] 5.8 Staleness banner: polls `GET /api/meta` for staleness, shows "N commits behind" with re-index action

**REFACTOR**

- [ ] 5.9 Refactor: clean up, visual verification in browser, all tests green

### Phase 6: Polish & Performance (~8h)

**RED first**

- [x] 6.1 TEST: CLI `--index` writes `.code-visualizer/graph.json`, `--status` prints index info, `--clean` removes it, `--force` re-indexes even if HEAD unchanged
- [x] 6.2 TEST: per-symbol PageRank/betweenness returns values (if benchmark passes perf gate)
- [x] 6.3 TEST: full pipeline on 1k+ file codebase completes in <30s (benchmark assertion)

**GREEN**

- [x] 6.4 CLI: `--index` (persist), `--force` (re-index), `--status`, `--clean` commands
- [x] 6.5 Per-symbol PageRank + betweenness on call graph (benchmark first — only ship if <5s on 5k-file codebase)
- [x] 6.6 Performance benchmark: measure pipeline at 1k, 3k, 5k file thresholds

**REFACTOR**

- [x] 6.7 Refactor: final cleanup, all tests green

### Out of Scope

- Embedded AI chat panel — MCP is the interface; agents connect externally
- Semantic/vector search — BM25 sufficient for agent keyword queries
- Class hierarchy extraction (extends/implements) — call graph reveals coupling, low agent value
- `raw_query` / `find_path` tools — low agent usage, overlaps with existing tools
- `codebase://schema` resource — only useful with raw_query
- Multi-language parsing (Python, Go, Rust, etc.) — future phase, clean extension points only
- Wiki generation — different product, introduces LLM dep
- Multi-repo support — prove single-repo first
- Bridge mode — persistence + existing server is sufficient
- PreToolUse hook augmentation — requires editor-specific integration
- Agent skills (.claude/skills/) — create after core tools stabilize
- Visual diff / PR review mode — future feature
- Real-time collaboration / multi-user
- Mocking internal modules in tests — E2E against real fixture only

## Quality Checklist

### Blocking (must pass to ship per phase)

- [ ] All Must Have ACs for the phase passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items for the phase implemented
- [ ] TDD: every implementation has a test written BEFORE the code
- [ ] E2E: all tests run against real fixture codebase, zero mocks of internal modules
- [ ] No regressions in existing 74+ tests
- [ ] Error states handled (stale index, no matches, ambiguous symbols, git unavailable)
- [ ] No hardcoded secrets or credentials
- [ ] MCP tools return structured JSON with `nextSteps` hints, not prose
- [ ] API routes return same data shape as corresponding MCP tools
- [ ] UI components fetch from API routes, never import pipeline modules directly
- [ ] UI changes verified in browser (visual verification)
- [ ] HTTP MCP endpoint bound to 127.0.0.1 only (security)

### Advisory (should pass, not blocking)

- [ ] Should Have ACs passing
- [ ] Code follows existing project patterns (ESM, strict TS, vitest)
- [ ] New modules have TSDoc on exports
- [ ] Search latency < 200ms for 5k-file codebase
- [ ] Package size stays under 5MB (dist/ only, no .next/)

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Call-site extraction misses dynamic calls (~15%) | HIGH | HIGH | `CallEdge.confidence` field: `"type-resolved"` (graph) vs `"text-inferred"` (regex fallback). Ground-truth fixture measures accuracy. |
| Symbol graph too large for in-memory (10k+ files → 50k+ symbols) | HIGH | MEDIUM | Phase 1 ships fan-in/fan-out only (O(N)). PageRank/betweenness deferred to Phase 6 after benchmark. |
| Louvain clustering produces meaningless clusters on sparse/directed graphs | MEDIUM | MEDIUM | Undirected projection. Tests assert structural properties (cluster count, cohesion > 0, all assigned), not exact membership. |
| MCP dual transport: SDK requires two McpServer instances | MEDIUM | CERTAIN | Two instances, shared graph data via `globalThis`. `src/mcp/transport.ts` manages lifecycle. |
| HTTP/SSE transport agent compatibility unverified (Codex, others) | MEDIUM | MEDIUM | Phase 0 research. If unverified, HTTP is best-effort. stdio is primary. Bind to 127.0.0.1 + optional bearer token. |
| JSON persistence perf on large symbol graphs (50k+ nodes) | MEDIUM | MEDIUM | Benchmark in Phase 6. graphology `export()`/`import()` is native JSON. If >5s, switch to msgpack. |
| Phase 1 re-export fix changes existing metrics | LOW | CERTAIN | Semver bump to 2.0.0. Update test baselines. Document in changelog. |
| Re-export fix creates duplicate symbol nodes | LOW | HIGH | Deduplicate by resolved source file path. Barrel re-exports point to original. |
| Dead export detection accuracy after re-export fix | LOW | MEDIUM | E2E test: fixture has A → B → C re-export chain with consumer importing from C. Assert dead exports correct. |
| `rename_symbol` dry_run=false is irreversible | HIGH | LOW | `dry_run=true` enforced default. Apply mode runs on temp copy in tests. |
| Fixture maintenance burden — fixture must evolve with features | LOW | HIGH | Fixture covers all patterns from Phase 0. New features add to fixture only when testing a genuinely new pattern. |

**Kill criteria:**

| Phase | Trigger | Signal | Action |
|-------|---------|--------|--------|
| Phase 1 | >35h elapsed | At 15h: measure false-positive rate vs ground-truth fixture | If >30% → pivot to text-based approach |
| Phase 1 | >50% false-positive call edges | Ground-truth comparison | Pivot to regex-based call detection |
| Phase 3 | Louvain produces 1 giant or all singletons | Run on 3+ real codebases | Switch to directory-based clustering |
| Phase 6 | PageRank/betweenness >10s on 5k files | Benchmark | Ship without symbol-level centrality |

## State Machine

**Status**: N/A — Stateless pipeline (parse → build → analyze → serve). No persistent state transitions within a request. Persistence (Phase 3) introduces index states:

```
┌───────────┐  analyze   ┌─────────┐  code change  ┌─────────┐
│ NO_INDEX  │───────────▶│ INDEXED │──────────────▶│  STALE  │
└───────────┘            └─────────┘               └────┬────┘
                              ▲                         │
                              │      --force / reindex  │
                              └─────────────────────────┘
```

Complexity: LOW (3 states, 3 transitions, 0 guards)

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| TS Compiler API can extract call sites reliably | `checker.getSymbolAtLocation()` resolves static calls; proven in TS language server | Dynamic calls (~15%) unresolvable; callbacks lose type info | RISKY — confidence tags + ground-truth fixture + 15h checkpoint |
| Louvain on undirected call graph produces meaningful clusters | GitNexus uses Leiden (similar); graphology-communities-louvain exists | Clustering quality depends on edge density; sparse graphs produce garbage | RISKY — undirected projection + structural property tests (not exact membership) |
| BM25 is sufficient without semantic search | Agents search by symbol names not intent; GitNexus uses BM25 as primary | Agents sometimes describe intent | VALID — BM25 only, can revisit |
| In-memory graph scales to 10k files at symbol level | graphology handles 100k+ nodes | Symbol-level = ~10x more nodes; O(N²) metrics are expensive | RISKY — defer O(N²) to Phase 6. Ship O(N) first. Benchmark. |
| E2E tests against a real fixture are sufficient (no unit mocks) | Tests cover real integration behavior; catch bugs mocks hide | Slower test suite; fixture maintenance burden | VALID — real tests catch real bugs. Fixture is cached across suite. Maintenance is scoped to Phase 0. |
| API/MCP-first ensures data consistency | Single source of truth; UI can't diverge from API | Adds latency (fetch vs direct import); more code (route + component) | VALID — consistency > latency. API is local (same process). |

### Blind Spots

1. **[Performance]** Blast radius BFS is O(N²) at symbol level. MITIGATED: defer to Phase 6 with benchmark gate.

2. **[UX]** 5 new MCP tools = tool sprawl risk. MITIGATED: nextSteps hints + `get_dependents` deprecation.

3. **[Scope]** No persistence in Phases 1-2 (~40h). Acceptable: foundation work.

4. **[Testing]** Fixture must cover all call-site patterns. MITIGATED: Phase 0 designs fixture before coding. Ground-truth files validate accuracy.

5. **[Integration]** HTTP MCP + Next.js on same server — port/routing. MITIGATED: design decided in Phase 2.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Call-site extraction >30% false positives at 15h | Phase 1 pivots, losing ~5h | Dynamic dispatch + callbacks | HIGH | Confidence tags + ground-truth fixture + pre-planned text fallback |
| Symbol graph 10x larger than file graph | Memory spikes, startup >30s | Every export becomes a node | HIGH | Export-only mode. O(N) metrics only. Benchmark in Phase 6. |
| Louvain clusters don't match human mental model | Agents confused | Unsupervised on sparse graph | MEDIUM | Undirected projection. Directory-based fallback. |
| E2E tests too slow (>60s suite) | Developer friction, CI cost | Full pipeline per test file | MEDIUM | Cache pipeline output across test suite (run once). Parallelize test files. |

### The Real Question

Confirmed — spec solves the right problem. TDD + E2E against a real fixture ensures we catch integration bugs that mocks hide. API/MCP-first ensures agents and UI always see the same data. The ground-truth fixture makes kill criteria measurable.

### Open Items

- ~~[question] Persistence format~~ → RESOLVED: JSON in `.code-visualizer/` per project
- ~~[question] Semantic search~~ → RESOLVED: BM25 only
- ~~[question] AI chat~~ → RESOLVED: No chat, MCP-only
- ~~[gap] MCP HTTP transport~~ → RESOLVED: Dual transport, two McpServer instances
- ~~[gap] Next-step hints~~ → RESOLVED: `src/mcp/hints.ts`
- ~~[risk] Orphan function nodes~~ → RESOLVED: remove from file graph
- ~~[risk] Louvain needs undirected~~ → RESOLVED: undirected projection
- ~~[risk] analyze_forces dead params~~ → RESOLVED: fix in Phase 1
- ~~[risk] file_context class type bug~~ → RESOLVED: fix in Phase 1
- ~~[gap] Call edge confidence~~ → RESOLVED: `CallEdge.confidence` field
- ~~[gap] Kill criteria measurement~~ → RESOLVED: ground-truth fixture in Phase 0
- ~~[gap] Persistence too late~~ → RESOLVED: moved to Phase 3
- ~~[gap] TDD approach~~ → RESOLVED: RED → GREEN → REFACTOR, every scope item
- ~~[gap] E2E testing~~ → RESOLVED: real fixture codebase, no mocking
- ~~[gap] API/MCP first~~ → RESOLVED: pipeline → MCP → API → UI, always
- ~~[risk] graphology-communities-louvain validated in Phase 0~~ → RESOLVED: v2.0.2 works with graphology@0.25.4, accepts both directed and undirected graphs
- ~~[risk] Codex HTTP/SSE transport compatibility~~ → RESOLVED: SDK 1.26.0 exports `StreamableHTTPServerTransport`. Claude Code + Claude Desktop: full HTTP. SSEServerTransport deprecated. Codex: limited docs, stdio primary.

## Notes

**Plan-review applied 2026-02-28.** 5-perspective review. PASS_WITH_CHANGES. All issues resolved.

**TDD + E2E + API-first applied 2026-02-28.** Every phase restructured: RED (failing tests) → GREEN (implement) → REFACTOR. All tests against real fixture codebase. API/MCP tools built before UI. UI consumes API only.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 0.1 | Create fixture-codebase/ (16 .ts files, 5 modules) | [x] Complete | 1 |
| 0.2 | Design fixture patterns (13 patterns covered) | [x] Complete | 1 |
| 0.3 | Init git repo (3 commits) | [x] Complete | 1 |
| 0.4 | Write expected/ ground truth (4 JSON files) | [x] Complete | 1 |
| 0.5 | Write tests/helpers/pipeline.ts | [x] Complete | 1 |
| 0.6 | Verify graphology-communities-louvain@2.0.2 | [x] Complete | 1 |
| 0.7 | Research HTTP/SSE transport (StreamableHTTPServerTransport in SDK 1.26.0) | [x] Complete | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-02-28T00:00:00Z | - | Created |
| plan-review | 2026-02-28T00:00:00Z | - | 5-perspective, PASS_WITH_CHANGES |
| tdd-e2e-api-first | 2026-02-28T00:00:00Z | - | TDD + E2E fixture + API-first restructure |
| ship-phase-0 | 2026-02-28 | ~1h | All 7 scope items complete. 105 tests passing (12 new). |
