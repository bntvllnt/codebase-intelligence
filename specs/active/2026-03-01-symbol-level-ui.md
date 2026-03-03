---
title: Symbol-Level UI
status: active
created: 2026-03-01
estimate: 7h
tier: standard
---

# Symbol-Level UI

## Context

Pipeline computes rich symbol data (symbolNodes, callEdges, symbolMetrics with pageRank/betweenness/fanIn/fanOut) but the UI only shows file-level nodes. Developers can't see function call graphs, type dependencies, or per-export metrics. This upgrade surfaces symbol-level data in the 3D visualizer.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `app/api/symbol-graph/route.ts` | CREATE | Bulk endpoint: symbolNodes + callEdges + symbolMetrics |
| `lib/types.ts` | MODIFY | Add SymbolApiNode, CallApiEdge, SymbolGraphResponse, extend ViewType |
| `lib/views.ts` | MODIFY | Add symbolView() + typesView() derivation functions, LEGENDS entries |
| `hooks/use-symbol-data.ts` | CREATE | Lazy SWR hook for /api/symbol-graph (only fetches when symbol view active) |
| `components/symbol-detail.tsx` | CREATE | Detail panel for selected symbol: callers, callees, metrics |
| `components/graph-canvas.tsx` | MODIFY | Handle "symbols" and "types" view types in render switch |
| `components/graph-provider.tsx` | MODIFY | Add selectedSymbol state + setter to context |
| `components/detail-panel.tsx` | MODIFY | Enrich Exports section with per-symbol fanIn/fanOut/pageRank |
| `app/api/file/[...path]/route.ts` | MODIFY | Join symbolMetrics onto functions[] response |
| `app/api/symbols/[name]/route.ts` | MODIFY | Add loc, type, pageRank, betweenness to response |
| `app/page.tsx` | MODIFY | Render SymbolDetailPanel, add view tabs for new views |
| `tests/phase7-red.test.ts` | CREATE | RED tests for symbol-graph API + enriched file API |

**Files:** 4 create | 8 modify | 0 affected
**Reuse:** Existing graph-store getGraph() already returns all symbol data. SWR pattern from use-graph-data.ts. View derivation pattern from lib/views.ts.
**Breaking changes:** None — all additive
**New dependencies:** None

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer exploring a codebase in the 3D visualizer
GOAL: Understand function-level call relationships and identify high-importance symbols
PRECONDITION: Codebase parsed and server running with graph loaded

1. User clicks "Symbols" view tab
   → System lazy-loads symbol graph from /api/symbol-graph
   → User sees 3D graph of functions/classes/types as nodes, call edges as links

2. User observes node sizes (pageRank) and colors (symbol type)
   → System renders: functions=blue, classes=green, interfaces=purple, types=orange, enums=yellow
   → User identifies high-pageRank hub symbols (largest nodes)

3. User clicks a symbol node
   → System shows SymbolDetailPanel with: name, type, file, loc, fanIn, fanOut, pageRank, betweenness, callers list, callees list
   → User sees who calls this symbol and what it calls

4. User clicks "Types" view tab
   → System filters symbol graph to only interface/type/enum nodes
   → User sees the type backbone of the codebase

5. User clicks a file node in any existing view (Galaxy, Hotspot, etc.)
   → System shows enriched detail panel with per-export metrics (fanIn, fanOut, pageRank)
   → User sees which exports are heavily used vs dead

POSTCONDITION: Developer has symbol-level understanding of codebase architecture

### Error Journeys

E1. Empty symbol graph
   Trigger: Codebase has no exported symbols (unlikely but possible)
   1. User clicks "Symbols" tab
      → System fetches /api/symbol-graph, gets empty arrays
      → User sees "No symbols found" placeholder
   Recovery: User switches back to file-level views

E2. Large symbol graph (>5000 nodes)
   Trigger: Large codebase produces massive symbol graph
   1. User clicks "Symbols" tab
      → System loads large dataset
      → User sees loading state, then graph renders (may be slow)
   Recovery: System renders with force-graph's built-in LOD; user can filter via search

### Edge Cases

EC1. Symbol with zero callers and zero callees: renders as isolated small node
EC2. Symbol type not in color map: defaults to grey
EC3. Click symbol from different view: no-op until user switches to symbol view

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [x] AC-1: GIVEN server running WHEN GET /api/symbol-graph THEN response contains symbolNodes[], callEdges[], symbolMetrics[] arrays with correct types
- [x] AC-2: GIVEN symbol view active WHEN graph renders THEN each symbolNode is a 3D node colored by type (function/class/interface/type/enum) and sized by pageRank
- [x] AC-3: GIVEN symbol view active WHEN user clicks a symbol node THEN SymbolDetailPanel shows name, type, file, loc, fanIn, fanOut, pageRank, callers[], callees[]
- [x] AC-4: GIVEN types view active WHEN graph renders THEN only interface/type/enum symbolNodes are shown with their edges
- [x] AC-5: GIVEN any file view WHEN user clicks a file node THEN detail panel Exports section shows per-export fanIn, fanOut, pageRank
- [x] AC-6: GIVEN symbol graph loaded WHEN navigating between views THEN symbol data is cached (no re-fetch)

### Error Criteria (BLOCKING)

- [x] AC-E1: GIVEN codebase with no exported symbols WHEN GET /api/symbol-graph THEN returns { symbolNodes: [], callEdges: [], symbolMetrics: [] } with 200 status
- [x] AC-E2: GIVEN symbol view active with empty symbol graph WHEN view renders THEN shows "No symbols found" placeholder instead of empty canvas

### Should Have

- [x] AC-7: GIVEN /api/symbols/:name WHEN queried THEN response includes loc, type, pageRank, betweenness fields
- [x] AC-8: GIVEN symbol view WHEN user hovers a node THEN tooltip shows symbol name and type

## Scope

### Phase 7A: API + Data Layer (~2h)

- [x] 7A.1 Create GET /api/symbol-graph endpoint → AC-1, AC-E1
- [x] 7A.2 Enrich GET /api/file/[...path] with per-export symbolMetrics → AC-5
- [x] 7A.3 Enrich GET /api/symbols/[name] with loc, type, pageRank, betweenness → AC-7
- [x] 7A.4 Add client types: SymbolApiNode, CallApiEdge, SymbolGraphResponse → AC-1, AC-2

### Phase 7B: Symbol Graph View (~3h)

- [x] 7B.1 Create useSymbolData() hook with lazy SWR fetch → AC-6
- [x] 7B.2 Add symbolView() + typesView() to lib/views.ts → AC-2, AC-4
- [x] 7B.3 Wire "Symbols" and "Types" view tabs in page.tsx + graph-canvas → AC-2, AC-4
- [x] 7B.4 Handle empty symbol graph with placeholder → AC-E2

### Phase 7C: Symbol Detail Panel (~2h)

- [x] 7C.1 Create SymbolDetailPanel component (name, type, file, metrics, callers, callees) → AC-3
- [x] 7C.2 Add selectedSymbol to graph-provider context → AC-3
- [x] 7C.3 Enrich file detail panel Exports section with fanIn/fanOut/pageRank → AC-5
- [x] 7C.4 Add hover tooltip for symbol nodes → AC-8

### Out of Scope

- Animated process flow view (deferred — requires timeline UI)
- Dead export overlay toggle (deferred — separate UX decision)
- Symbol-level search in search bar (current BM25 is file-level, upgrade later)
- Symbol graph filtering/pruning controls
- Class hierarchy (extends/implements) edges
- Cross-file type flow visualization

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing 171 tests
- [ ] Error states handled (empty graph, missing metrics)
- [ ] No hardcoded secrets or credentials
- [ ] Symbol graph endpoint returns valid JSON for fixture codebase
- [ ] Existing 8 views unaffected by new code
- [ ] ForceGraph3D handles both file-level and symbol-level node types

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] Code follows existing view derivation pattern (pure functions)
- [ ] Symbol data lazy-loaded (not bundled into initial /api/graph fetch)
- [ ] Visual verification: symbol graph renders in browser

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Large symbol graphs slow down 3D rendering | HIGH | MEDIUM | Lazy load + ForceGraph3D handles large graphs; can add node count limit later |
| Symbol view confuses users vs file view | MEDIUM | LOW | Clear tab labels, different color scheme, legend |
| symbolMetrics Map serialization to JSON | LOW | LOW | Already handled by existing graph API pattern — iterate Map entries |
| New views break existing view switching | MEDIUM | LOW | Additive code only; existing switch cases untouched |

**Kill criteria:** If symbol graph with >2000 nodes causes >5s render time, defer to a filtered/paginated approach.

## State Machine

**Status**: N/A — Stateless feature

**Rationale**: Views are stateless pure function derivations. Selected symbol is a simple state variable (null → SymbolApiNode → null). No state transitions, no guards, no races.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|------------------|---------|
| ForceGraph3D handles symbol-level node count (1000+ nodes) | Library docs claim 100k+ nodes; file-level already renders 549 nodes | Symbol count could be 5-10x file count; WebGL has real limits | RISKY — benchmark on the-forge fixture (603 symbols) before scaling claims |
| Lazy loading prevents initial page slowdown | SWR supports conditional fetching; existing pattern fetches 4 endpoints | User will click "Symbols" and wait; perceived latency shifts not eliminates | VALID — lazy is strictly better than eager for optional data |
| Color-by-type is the best visual encoding | Standard convention in IDE symbol explorers | Could also color by module (consistency with file views) or by pageRank (heatmap) | VALID — type coloring is most intuitive; module coloring available as future option |

### Blind Spots

1. **[Performance]** Symbol graph for large codebases (5k+ files → 50k+ symbols) may exceed browser memory. ForceGraph3D's force simulation scales O(N log N) per tick.
   Why it matters: Could make the tool unusable on large monorepos.

2. **[UX]** No symbol search — user can only find symbols visually or by clicking files. In a 600+ symbol graph, visual search is impractical.
   Why it matters: Reduces the practical value of the symbol view for large codebases.

3. **[Data]** callEdges only have `text-inferred` and `type-resolved` confidence. No visual distinction in the graph means users can't tell reliable edges from guesses.
   Why it matters: Users may trust call graph connections that are actually heuristic guesses.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Symbol graph renders 5000+ nodes | Browser freezes or FPS drops below 10 | ForceGraph3D force simulation is O(N log N) per tick | HIGH | Add node count check; if >3000, show top-N by pageRank with "show all" toggle |
| Users don't understand symbol vs file view | Confusion, bug reports, abandoned feature | Two graph types look similar at a glance | MEDIUM | Clear legend, distinct color scheme, "Symbols" label with icon |
| symbolMetrics Map has entries with stale keys | Detail panel shows "N/A" for valid symbols | symbolId format mismatch between symbolNodes and symbolMetrics | LOW | Validate in API: log warning if symbolNode has no matching metric |

### The Real Question

Confirmed — spec solves the right problem. The pipeline computes symbol data that users can't access. The question isn't IF but HOW MUCH to expose. This spec takes the minimal viable approach: 2 new views + enriched detail panel, lazy-loaded, no filtering controls yet.

### Open Items

- [improvement] Add symbol search to search bar → defer to future spec
- [improvement] Add confidence visual on call edges (solid vs dashed) → defer, explore during 7B
- [risk] Benchmark symbol graph render on the-forge (603 symbols) during 7B → explore during ship
- [question] Should "Types" be a separate view tab or a filter toggle within Symbols view? → ship as separate tab, simpler UX

## Notes

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 7A.1 | Create GET /api/symbol-graph endpoint | [x] Complete | 1 |
| 7A.2 | Enrich file API with symbolMetrics | [x] Complete | 1 |
| 7A.3 | Enrich symbols API with loc/type/pageRank | [x] Complete | 1 |
| 7A.4 | Add client types | [x] Complete | 1 |
| 7B.1 | useSymbolData() hook | [x] Complete | 1 |
| 7B.2 | symbolView() + typesView() | [x] Complete | 1 |
| 7B.3 | Wire view tabs | [x] Complete | 1 |
| 7B.4 | Empty symbol placeholder | [x] Complete | 1 |
| 7C.1 | SymbolDetailPanel component | [x] Complete | 1 |
| 7C.2 | selectedSymbol context | [x] Complete | 1 |
| 7C.3 | Enriched exports section | [x] Complete | 1 |
| 7C.4 | Hover tooltip | [x] Complete | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-01T15:50:00Z | - | Created |
