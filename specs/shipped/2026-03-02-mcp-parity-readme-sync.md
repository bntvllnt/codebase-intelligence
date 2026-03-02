---
title: MCP Tool Parity + README Sync
status: shipped
created: 2026-03-02
estimate: 3h
tier: standard
---

# MCP Tool Parity + README Sync

## Context

Analysis reveals MCP tools expose ~70% of computed data. Symbol metrics (pageRank, betweenness), process traces, and clusters are computed but only accessible via REST or resources — not MCP tools. README.md is stale: documents 8 MCP tools (actual: 13), 9 API routes (actual: 13), and omits symbol-level features, search, processes, clusters, and HTTP transport.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/mcp/index.ts` | MODIFY | Enhance `symbol_context` (+4 fields), fix `analyze_forces` (wire threshold params), enrich `detect_changes` (+metrics), add `get_processes` + `get_clusters` tools |
| `src/types/index.ts` | NONE | All needed types already exist |
| `README.md` | MODIFY | Rewrite MCP, REST API, Features, Metrics, Limitations sections to match reality |
| `docs/mcp-tools.md` | MODIFY | Add tools 8-15, update tool selection guide |
| `tests/mcp.test.ts` or equiv | MODIFY | Add tests for new/enhanced tools |

**Files:** 0 create | 3 modify | 1 affected (tests)
**Reuse:** `graph.processes`, `graph.clusters`, `graph.symbolMetrics` — all computed, just need tool wrappers
**Breaking changes:** None — all additive (new fields + new tools)
**New dependencies:** None

## User Journey (MANDATORY)

### Primary Journey

ACTOR: LLM agent using MCP tools to understand a codebase
GOAL: Get complete data about symbols, processes, clusters, and changes

1. LLM calls `symbol_context("getUserById")`
   -> System returns name, file, fanIn, fanOut, **pageRank, betweenness, loc, type, callers (with confidence), callees (with confidence)**
   -> LLM can now assess symbol importance + trust call chain quality

2. LLM calls `get_processes()`
   -> System returns entry points with BFS-traced execution flows, steps, modules touched
   -> LLM can trace how requests flow through the codebase

3. LLM calls `get_clusters()`
   -> System returns Louvain-detected communities with files + cohesion
   -> LLM understands natural groupings beyond directory structure

4. LLM calls `detect_changes()`
   -> System returns changed files **with blastRadius, complexity, churn** per file
   -> LLM can triage changes by risk without extra tool calls

5. LLM calls `analyze_forces({ tensionThreshold: 0.5 })`
   -> System filters tension files to those above 0.5 (previously hardcoded at 0.3)
   -> LLM gets customized force analysis

POSTCONDITION: LLM has complete parity with REST API data through MCP tools

### Error Journeys

E1. Symbol not found in `symbol_context`
  Trigger: LLM passes invalid symbol name
  -> System returns `{ error: "Symbol not found: X" }` with `isError: true`
  Recovery: LLM uses `search` to find correct name

E2. No processes detected
  Trigger: Codebase has no detectable entry points
  -> System returns `{ processes: [], message: "No entry points detected" }`
  Recovery: LLM falls back to `codebase_overview`

### Edge Cases

EC1. `get_clusters` on codebase with 1 file: returns single cluster
EC2. `detect_changes` with no git changes: returns empty arrays with metrics context
EC3. `analyze_forces` threshold = 0: returns all files (unfiltered)
EC4. `symbol_context` with ambiguous name matching multiple symbols: returns first match (existing behavior)

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [x] AC-1: GIVEN `symbol_context` called with valid name WHEN response returned THEN includes `pageRank`, `betweenness`, `loc`, `type` fields + callers/callees include `confidence`
- [x] AC-2: GIVEN `get_processes` tool called WHEN codebase has entry points THEN returns `ProcessFlow[]` with name, entryPoint, steps, depth, modulesTouched
- [x] AC-3: GIVEN `get_clusters` tool called WHEN codebase has >1 file THEN returns `Cluster[]` with id, name, files, cohesion
- [x] AC-4: GIVEN `detect_changes` called WHEN files have changed THEN each changed file includes `blastRadius`, `complexity`, `churn` from fileMetrics
- [x] AC-5: GIVEN `analyze_forces` called with `tensionThreshold: 0.8` WHEN response returned THEN only tension files with tension > 0.8 are included
- [x] AC-6: GIVEN README.md WHEN read THEN MCP section lists all 15 tools with accurate descriptions
- [x] AC-7: GIVEN README.md WHEN read THEN REST API section lists all current routes
- [x] AC-8: GIVEN `docs/mcp-tools.md` WHEN read THEN documents all 15 tools with inputs/outputs/use cases

### Error Criteria (BLOCKING)

- [x] AC-E1: GIVEN `get_processes` called WHEN no entry points exist THEN returns empty array, not error
- [x] AC-E2: GIVEN `get_clusters` called WHEN graph has 0 clusters THEN returns empty array, not error

### Should Have

- [x] AC-9: GIVEN README.md WHEN read THEN Features section mentions symbol-level analysis, BM25 search, process tracing, community detection
- [x] AC-10: GIVEN README.md WHEN read THEN Limitations section is updated (remove "no internal function calls" — symbol-level graph exists now)

## Scope

- [x] 1. Enhance `symbol_context` — add pageRank, betweenness, loc, type, confidence on callers/callees -> AC-1
- [x] 2. Fix `analyze_forces` — wire cohesionThreshold, tensionThreshold, escapeThreshold params to implementation -> AC-5
- [x] 3. Enrich `detect_changes` — include fileMetrics (blastRadius, complexity, churn) per changed file -> AC-4
- [x] 4. Add `get_processes` tool — wrap `graph.processes` -> AC-2, AC-E1
- [x] 5. Add `get_clusters` tool — wrap `graph.clusters` -> AC-3, AC-E2
- [x] 6. Update `docs/mcp-tools.md` — document all 15 tools -> AC-8
- [x] 7. Update `README.md` — sync MCP, REST API, Features, Metrics, Limitations sections -> AC-6, AC-7, AC-9, AC-10
- [x] 8. Add/update tests for enhanced and new MCP tools -> all ACs

### Out of Scope

- Composite hotspot score (churn x complexity x blastRadius) — separate feature
- `check_staleness` tool — staleness already in `codebase://setup` resource, low priority
- File-to-cluster reverse lookup — nice-to-have, not blocking
- Renaming `rename_symbol` to `find_references` — separate breaking change discussion
- Per-symbol PageRank in `find_hotspots` — Phase 6 roadmap item
- New MCP prompts or resources

## Quality Checklist

### Blocking

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing 155 tests
- [ ] Error states return `isError: true` with descriptive message
- [ ] No hardcoded secrets or credentials
- [ ] lint + typecheck + build + test all pass
- [ ] MCP tool handlers remain async (SDK requirement)
- [ ] New tools registered in `codebase://setup` resource's `availableTools` list
- [ ] `docs/mcp-tools.md` tool count matches actual registered tools

### Advisory

- [ ] All Should Have ACs passing
- [ ] New tool descriptions follow existing pattern (verb + noun + context)
- [ ] README tool table sorted consistently

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| analyze_forces threshold wiring changes existing output | MED | MED | Thresholds default to current hardcoded values (0.6/0.3/0.5) — behavior unchanged unless params passed |
| detect_changes fileMetrics lookup misses files not in graph | LOW | MED | Changed files from git may not be in graph (new unindexed files) — skip metrics for missing files, return `null` |
| README gets out of date again | LOW | HIGH | This is documentation — will drift. Consider generating from code in future. |

**Kill criteria:** If wiring threshold params causes >5 existing test failures, revert and hardcode defaults.

## State Machine

**Status**: N/A — Stateless feature. All tools are request-response with no persistent state transitions.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|------------------|---------|
| MCP resources are invisible to LLMs | Resources require proactive fetch, tools are invocable | Some MCP clients do auto-read resources on connect | RISKY — but tools > resources for discoverability |
| analyze_forces threshold params are broken | Params in Zod schema but `_params` destructured | Could be intentional design (fixed analysis window) | VALID — params should work or be removed |
| detect_changes needs metrics | Returns raw paths, LLM can call file_context per file | Extra round-trips = slower LLM workflow, token waste | VALID — inline metrics saves N tool calls |

### Blind Spots

1. **[integration]** HTTP MCP transport uses per-request McpServer — new tools auto-included via `registerTools()`, but verify `src/mcp/transport.ts` doesn't filter tools
   Why it matters: New tools could silently fail on HTTP transport

2. **[testing]** Existing MCP tests may use fixture data that has no processes/clusters — need fixture with entry points
   Why it matters: Tests would pass vacuously with empty arrays

3. **[docs]** README mentions "8 tools" in Features section bullet — multiple places to update, easy to miss one
   Why it matters: Inconsistent docs erode trust

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| analyze_forces thresholds filter too aggressively | Existing tool consumers see empty results | Default threshold values may differ from hardcoded ones | MED | Default param values = current hardcoded values exactly |
| detect_changes metric lookup uses wrong path format | Metrics return null for all files | git diff paths may not match graph relativePaths | HIGH | Use existing `file.endsWith(e.target)` fallback pattern already in detect_changes |
| README rewrite introduces factual errors about tool params | Users pass wrong params | Manual rewrite of 15 tool descriptions | MED | Cross-reference each tool description against actual Zod schema in code |

### The Real Question

Confirmed — spec solves the right problem. The gap between REST API and MCP tools means browser users get better data than LLM users. That's backwards for a tool whose primary audience is LLM agents.

### Open Items

- [gap] `symbol_context` ambiguity: when multiple symbols match, only first returned — should we add disambiguation? -> no action (existing behavior, separate feature)
- [question] Should `get_processes` accept a filter param (e.g., `entryPoint` name)? -> no action (start simple, add filter later if needed)
- [improvement] `rename_symbol` description says "for renaming" but only does dry-run — clarify description? -> no action (out of scope, noted for future)

## Notes

### Ship Retro (2026-03-02)
**Estimate vs Actual:** 3h → ~2h (150% accuracy)
**What worked:** Analyze-first approach (gap analysis) → spec → ship. Having the exact gap list made implementation trivial.
**What didn't:** Round 2 (100% parity) was unplanned scope creep from the analysis — should have been in the original spec. Minor: pre-existing parser test timeouts create noise in CI.
**Next time:** Include "audit for remaining gaps" as a scope item in parity specs to avoid a separate unplanned round.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Enhance symbol_context | done | 1 |
| 2 | Fix analyze_forces thresholds | done | 1 |
| 3 | Enrich detect_changes | done | 1 |
| 4 | Add get_processes | done | 1 |
| 5 | Add get_clusters | done | 1 |
| 6 | Update docs/mcp-tools.md | done | 1 |
| 7 | Update README.md | done | 1 |
| 8 | Tests | done | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-02T00:00:00Z | - | Created |
| ship | 2026-03-02T00:00:00Z | ~1.5h | Round 1: 8 scope items |
| ship | 2026-03-02T00:00:00Z | ~0.5h | Round 2: 4 parity gaps |
| done | 2026-03-02T23:45:00Z | ~2h total | Shipped |
