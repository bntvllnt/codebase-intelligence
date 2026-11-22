---
title: Group Metrics API + Cloud Legend
status: active
created: 2026-02-19
estimate: 2h
tier: standard
---

# Group Metrics API + Cloud Legend

## Context

Cloud grouping now collapses folders to top-level groups (convex, app, components, lib, e2e). But these groups have no aggregate metrics exposed. Users need to understand **what each cloud represents** — its size, importance, coupling. This data should be available via API (for dashboards), MCP (for LLMs), and visually as a legend in the web UI.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/types/index.ts` | MODIFY | Add `GroupMetrics` interface |
| `src/analyzer/index.ts` | MODIFY | Add `computeGroups()` function, call from `analyzeGraph()`, store in `CodebaseGraph` |
| `app/api/groups/route.ts` | CREATE | New `GET /api/groups` endpoint returning group metrics array |
| `src/mcp/index.ts` | MODIFY | Add `get_groups` MCP tool |
| `components/legend.tsx` | MODIFY | Extend to show group color swatches when clouds are visible |
| `components/graph-provider.tsx` | MODIFY | Fetch `/api/groups`, expose via context |
| `hooks/use-graph-data.ts` | MODIFY | Add SWR fetch for `/api/groups` |
| `lib/types.ts` | MODIFY | Add client-side `GroupMetrics` type |
| `lib/views.ts` | MODIFY | Update LEGENDS to include dynamic group entries |
| `app/page.tsx` | MODIFY | Pass group data to Legend |
| `src/analyzer/index.test.ts` | AFFECTED | Need tests for `computeGroups()` |
| `src/server/api-routes.test.ts` | AFFECTED | Need test for `/api/groups` endpoint |
| `src/mcp/index.test.ts` | AFFECTED | Need test for `get_groups` MCP tool |

**Files:** 1 create | 8 modify | 3 affected
**Reuse:** `cloudGroup()` logic from `graph-canvas.tsx` → extract to `lib/views.ts` shared util. `getModuleColor()` already exists for color mapping.
**Breaking changes:** None — additive only (new field on `CodebaseGraph`, new API endpoint, new MCP tool)
**New dependencies:** None

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer exploring a codebase
GOAL: Understand folder-level architecture at a glance
PRECONDITION: Codebase parsed, 3D view loaded with clouds visible

1. User sees 3D graph with colored clouds
   -> System renders clouds with distinct colors per group
   -> User sees **legend** at bottom-left showing: color swatch + group name + file count + importance%

2. Developer calls `GET /api/groups`
   -> System returns JSON array of group metrics sorted by importance
   -> Developer sees: name, files, loc, importance (pageRank sum), coupling (fanIn+fanOut), color

3. LLM calls `get_groups` MCP tool
   -> System returns same data as API in text format
   -> LLM can reason about project architecture

POSTCONDITION: Group metrics available in UI legend, REST API, and MCP

### Error Journeys

E1. No clouds visible (small project or clouds toggled off)
   Trigger: Project has <5 files per group OR user unchecked "Module Clouds"
   -> Legend shows standard view-based legend (existing behavior)
   Recovery: User enables clouds checkbox -> legend updates to show group swatches

### Edge Cases

EC1. Single-group project: legend shows 1 entry
EC2. Root-level files (no directory): grouped as "root"
EC3. Very long group names: truncated in legend

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN parsed codebase WHEN `GET /api/groups` called THEN returns JSON array with fields: name, files, loc, importance, fanIn, fanOut, color, sorted by importance desc
- [ ] AC-2: GIVEN MCP server running WHEN `get_groups` tool called THEN returns group metrics matching API format
- [ ] AC-3: GIVEN web view with clouds visible WHEN page loads THEN legend at bottom-left shows color swatch + group name + file count for each cloud group
- [ ] AC-4: GIVEN web view WHEN user toggles clouds off THEN legend reverts to view-specific legend (no group swatches)
- [ ] AC-5: GIVEN `CodebaseGraph` type WHEN `analyzeGraph()` runs THEN `groups` field contains computed group metrics

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN project with 0 qualifying groups WHEN API called THEN returns empty array (not error)
- [ ] AC-E2: GIVEN cloud checkbox unchecked WHEN legend renders THEN shows only view-specific items (no crash, no empty groups section)

### Should Have

- [ ] AC-6: GIVEN legend with groups WHEN each group shown THEN importance percentage displayed alongside name

## Scope

- [ ] 1. Add `GroupMetrics` type to `src/types/index.ts` and `lib/types.ts` -> AC-5
- [ ] 2. Add `computeGroups()` in analyzer + add `groups` to `CodebaseGraph` -> AC-5
- [ ] 3. Create `app/api/groups/route.ts` endpoint -> AC-1, AC-E1
- [ ] 4. Add `get_groups` MCP tool -> AC-2
- [ ] 5. Update `hooks/use-graph-data.ts` + `graph-provider.tsx` to fetch groups -> AC-3
- [ ] 6. Update `components/legend.tsx` to show group swatches when clouds enabled -> AC-3, AC-4, AC-E2, AC-6
- [ ] 7. Extract `cloudGroup()` to shared util in `lib/views.ts` -> supports all above
- [ ] 8. Tests: analyzer groups, API endpoint, MCP tool -> AC-1 thru AC-5

### Out of Scope

- Clicking on legend entry to fly to that cloud (future)
- Drill-down within groups (subfolders)
- Group-level editing/refactoring suggestions

## Quality Checklist

### Blocking

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing tests
- [ ] Error states handled
- [ ] No hardcoded secrets
- [ ] `cloudGroup()` is DRY (shared between cloud renderer and analyzer)
- [ ] API response is JSON-serializable (no Maps, no undefined)

### Advisory

- [ ] All Should Have ACs passing
- [ ] Legend readable at all zoom levels
- [ ] Colors consistent between clouds and legend swatches

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `cloudGroup()` logic diverges between client and server | MED | MED | Extract to shared util imported by both |
| Group metrics add latency to page load | LOW | LOW | Groups endpoint is small (5-10 items), parallel fetch |
| Legend occludes important UI elements | MED | LOW | Keep legend compact, existing position is bottom-left |

**Kill criteria:** None needed — low-risk additive feature

## State Machine

**Status**: N/A — Stateless feature

**Rationale**: Pure data pipeline (compute -> serve -> render). No state transitions. Legend visibility is derived from existing `config.showModuleBoxes` boolean.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| `cloudGroup()` is the right grouping for metrics | Works well for a mid-size fixture repo (5 clear groups) | Might oversimplify monorepos with packages/ | VALID — handles `packages/` in SOURCE_DIRS |
| Groups should be sorted by importance (PageRank) | Matches what user asked for ("top groups") | Could sort by LOC or coupling instead | VALID — importance is most intuitive |
| Legend should only show when clouds are visible | Avoids clutter when user doesn't want clouds | Could always show groups regardless | VALID — user already has a toggle |

### Blind Spots

1. **[Performance]** Computing groups on every `analyzeGraph()` call adds work. Unlikely to matter (grouping is O(n) over files), but worth noting.
   Why it matters: Could slow startup for huge codebases (10k+ files).

2. **[UX]** Legend might have too many entries for projects with many top-level dirs. a mid-size fixture repo has 5, but a monorepo could have 15+.
   Why it matters: Legend would overflow screen. → Cap at top 8 groups by importance.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Color from `getModuleColor()` doesn't match cloud color | Legend swatches mismatch clouds | `cloudGroup()` name differs from module name passed to `getModuleColor()` | HIGH | Use same `cloudGroup()` + `getModuleColor()` in both paths |
| Group names are full paths in API | API response is verbose and ugly | Forgot to use `cloudGroup()` collapsing | LOW | Use shared `cloudGroup()` function |
| MCP tool output is too verbose | LLMs struggle to parse | Too many fields | LOW | Keep format concise like other MCP tools |

### The Real Question

Confirmed — spec solves the right problem. The user wants to **understand the architecture at a glance**. Groups + legend + API/MCP access achieves that without overcomplicating the UI.

### Open Items

- [improvement] Cap legend at 8 groups max -> update spec scope
- [improvement] Consider adding group-level edges (cross-group dependency count) -> future scope

## Notes

Pending uncommitted: CLI stability fix + 3D clouds overhaul. Commit before shipping this spec.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | GroupMetrics types | [x] Complete | 1 |
| 2 | computeGroups() analyzer | [x] Complete | 1 |
| 3 | /api/groups endpoint | [x] Complete | 1 |
| 4 | get_groups MCP tool | [x] Complete | 1 |
| 5 | Fetch groups in hook/provider | [x] Complete | 1 |
| 6 | Legend with group swatches | [x] Complete | 1 |
| 7 | Extract cloudGroup() shared util | [x] Complete | 1 |
| 8 | Tests | [x] Complete | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-02-19T14:40:00Z | - | Created |
