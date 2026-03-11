---
title: "Fix: coverage and coupling metrics miscount test files"
status: active
created: 2026-03-11
estimate: 2h
tier: standard
issue: "[#7](https://github.com/bntvllnt/codebase-intelligence/issues/7)"
---

# Fix: coverage and coupling metrics miscount test files

## Context

Two metrics in `find_hotspots` produce misleading results because test files are not filtered from rankings meant for source files. Coverage reports test files as "needs tests" (score: 1), and coupling ranks test files / entry points highest because `fan_in: 0` yields `coupling: 1.0`. Both pollute top-N results with noise.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/mcp/index.ts:207-258` | MODIFY | Filter test files from coverage + coupling hotspot results |
| `src/analyzer/index.ts:66` | MODIFY | Adjust coupling formula to deprioritize leaf consumers (fan_in=0) |
| `src/types/index.ts:84-98` | MODIFY | Add `isTestFile` to `FileMetrics` so MCP layer can filter without path matching |
| `src/analyzer/index.ts:83-97` | MODIFY | Populate `isTestFile` on `FileMetrics` from `ParsedFile.isTestFile` |
| `src/analyzer/index.test.ts:93-107` | MODIFY | Update coupling assertions to match new formula (line 103 asserts `coupling === 1` for fan_in=0) |
| `tests/` or `src/**/*.test.ts` | CREATE | Regression tests for both bugs |
| `tests/fixture-codebase/src/` | CREATE | Add `.spec.ts` fixture file to test spec-pattern filtering |
| `docs/metrics.md:13` | AFFECTED | Coupling formula description needs update |
| `docs/data-model.md:60-79` | AFFECTED | `FileMetrics` documented here -- add `isTestFile` field |
| `src/persistence/index.ts:72` | AFFECTED | `importGraph` casts `FileMetrics` from JSON -- old caches lack `isTestFile` field |

**Files:** 0-1 create (test file + fixture) | 4 modify | 3 affected
**Reuse:** `ParsedFile.isTestFile` already computed by parser (`src/parser/index.ts:482-486`). Pattern: `.test.` / `.spec.` / `__tests__/`.
**Breaking changes:** Coupling scores will change for all files (formula adjustment). This is a bug fix, not a semantic break. Existing test at `src/analyzer/index.test.ts:103` WILL break and must be updated.
**Persistence compatibility:** Old `.code-visualizer/` cache files lack `isTestFile` on `FileMetrics`. `importGraph` uses `as PersistedGraph` cast, so `isTestFile` will be `undefined`. Either default to `false` on import or accept undefined (falsy = treated as source file, which is safe).
**New dependencies:** None.

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer using MCP tools via LLM
GOAL: Find files that need test coverage or have problematic coupling
PRECONDITION: Codebase parsed and graph built

1. User calls `find_hotspots(metric='coverage')`
   -> System filters out test files, scores only source files
   -> User sees list of source files missing tests (no `.test.ts` / `.spec.ts` in results)

2. User calls `find_hotspots(metric='coupling')`
   -> System excludes test files from coupling rankings
   -> System scores coupling with adjusted formula (leaf consumers deprioritized)
   -> User sees source files ranked by meaningful coupling (hub files, not leaf consumers)

POSTCONDITION: Hotspot results contain only actionable source files

### Error Journeys

E1. Codebase has ONLY test files (no source files)
   Trigger: All parsed files are test files
   1. User calls `find_hotspots(metric='coverage')`
      -> System returns empty hotspot list
      -> User sees "No significant coverage hotspots found."
   Recovery: Normal -- empty result is correct

### Edge Cases

EC1. File in `__tests__/` directory: filtered as test file (already handled by parser)
EC2. Source file with zero fan_in AND zero fan_out (isolated): coupling = 0 (unchanged)
EC3. Mixed codebase with few source files: results truncated to available source files
EC4. `.spec.ts` / `.spec.tsx` files: filtered as test file (parser uses `.spec.` includes)
EC5. `.test.tsx` / `.test.jsx` files: filtered as test file (parser uses `.test.` includes)
EC6. Files in `tests/` root dir WITHOUT `.test.`/`.spec.` in name (e.g., `tests/helpers.ts`): NOT filtered (parser only matches `__tests__/`, not `tests/`). This is by design -- `tests/helpers.ts` is ambiguous.
EC7. Entry point files (`cli.ts`, `index.ts`) with fan_in=0: coupling formula must NOT rank them at 1.0 but they should still appear in coupling results (not filtered)
EC8. Codebase with only test files: coupling hotspot also returns empty (same as coverage)
EC9. Persistence: old cache imported without `isTestFile` field -- `undefined` is falsy, treated as source file (safe default)

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN a parsed codebase with test files WHEN `find_hotspots(metric='coverage')` is called THEN no file with `isTestFile=true` appears in results
- [ ] AC-2: GIVEN a parsed codebase WHEN `find_hotspots(metric='coupling')` is called THEN no file with `isTestFile=true` appears in results
- [ ] AC-3: GIVEN a file with `fan_in: 0, fan_out: > 0` WHEN coupling is computed THEN its score is strictly lower than a file with `fan_in > 0, fan_out > 0` and the same total degree
- [ ] AC-4: GIVEN `FileMetrics` for a test file WHEN accessed THEN `isTestFile` is `true`
- [ ] AC-4b: GIVEN `FileMetrics` for a source file WHEN accessed THEN `isTestFile` is `false`
- [ ] AC-6: GIVEN the existing analyzer test at `src/analyzer/index.test.ts` WHEN all tests run THEN no regressions (test assertions updated to match new formula)

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN a codebase with only test files WHEN `find_hotspots(metric='coverage')` is called THEN result is empty with appropriate summary message
- [ ] AC-E2: GIVEN a codebase with only test files WHEN `find_hotspots(metric='coupling')` is called THEN result is empty with appropriate summary message

### Should Have

- [ ] AC-5: GIVEN the coupling formula change WHEN all files are scored THEN existing hub files (high fan_in + fan_out) still rank highest
- [ ] AC-7: GIVEN a `.spec.ts` file in the parsed codebase WHEN coverage/coupling hotspots are called THEN it is excluded (same as `.test.ts`)

## Scope

- [ ] 1. Add `isTestFile` to `FileMetrics` interface and populate it from `ParsedFile.isTestFile` in analyzer -> AC-4, AC-4b
- [ ] 2. Filter test files from coverage hotspot results in MCP handler -> AC-1, AC-E1
- [ ] 3. Filter test files from coupling hotspot results in MCP handler -> AC-2, AC-E2
- [ ] 4. Adjust coupling formula in analyzer to deprioritize leaf consumers -> AC-3, AC-5
- [ ] 4b. Update existing analyzer test assertions to match new coupling formula -> AC-6
- [ ] 5. Add regression tests for both bugs (all AC variations) -> AC-1, AC-2, AC-3, AC-4, AC-4b, AC-7
- [ ] 5b. Add `.spec.ts` fixture file to `tests/fixture-codebase/src/` to cover spec-pattern filtering -> AC-7
- [ ] 6. Update `docs/metrics.md` with new coupling formula -> AC-5
- [ ] 6b. Update `docs/data-model.md` to add `isTestFile` to `FileMetrics` documentation

### Coupling Formula Decision (PIN BEFORE IMPLEMENTATION)

Current: `fanOut / (fanIn + fanOut)` -- fan_in=0 always yields 1.0.

Recommended: `fanOut / (max(fanIn, 1) + fanOut)` -- clamps denominator so fan_in=0 files get `fanOut / (1 + fanOut)` instead of 1.0. This:
- Deprioritizes leaf consumers (score < 1.0 when fan_in=0)
- Preserves 0 for pure dependencies (fan_out=0)
- Preserves ranking order for hub files (high fan_in + fan_out)
- Entry points with fan_in=0, fan_out=10 get `10/11 = 0.91` instead of `1.0`
- Hub files with fan_in=5, fan_out=5 get `5/10 = 0.5` (unchanged from old formula)

Alternative: exclude fan_in=0 entirely from coupling metric. Rejected -- loses information about entry point coupling.

### Out of Scope

- Filtering test files from OTHER metrics (pagerank, fan_in, etc.) -- those are informational, not misleading
- Changing the `ParsedFile.isTestFile` detection logic
- Adding new MCP tool parameters (e.g., `include_tests` flag)
- Files in `tests/` root dir without `.test.`/`.spec.` in name (not matched by parser, by design)

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing (AC-1 through AC-6)
- [ ] All Error Criteria ACs passing (AC-E1, AC-E2)
- [ ] All scope items implemented (1 through 6b)
- [ ] No regressions in existing tests (run full suite)
- [ ] Error states handled (empty result set for all-test codebases)
- [ ] No hardcoded secrets or credentials
- [ ] Existing analyzer test `src/analyzer/index.test.ts:103` updated to new expected coupling value
- [ ] `isTestFile` added to `FileMetrics` without breaking consumers or persistence
- [ ] `.spec.ts` fixture file added and tested
- [ ] `docs/data-model.md` updated with `isTestFile` field

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing (AC-5, AC-7)
- [ ] Code follows existing project patterns (switch-case in MCP, formula in analyzer)
- [ ] `docs/metrics.md` updated with coupling formula explanation
- [ ] Old cache import tested (undefined isTestFile treated as source file)

## Test Strategy (MANDATORY)

### Test Environment

| Component | Status | Detail |
|-----------|--------|--------|
| Test runner | detected | vitest |
| E2E framework | not configured | N/A for MCP tools |
| Test DB | none | In-memory graph |
| Mock inventory | 0 | No mocks (project policy) |

### AC -> Test Mapping

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Integration | Build real graph with test+source files (using `makeFile` with `isTestFile:true`), call coverage hotspot via MCP, assert no test files in results |
| AC-2 | Integration | Build real graph with test+source files, call coupling hotspot via MCP, assert no test files in results |
| AC-3 | Integration | Build graph with fan_in=0 file + fan_in>0 file (same fan_out), compute via analyzer, assert fan_in=0 has strictly lower coupling |
| AC-4 | Integration | Build analyzer output from `ParsedFile` with `isTestFile:true`, assert `FileMetrics.isTestFile === true` |
| AC-4b | Integration | Build analyzer output from `ParsedFile` with `isTestFile:false`, assert `FileMetrics.isTestFile === false` |
| AC-6 | Regression | Run existing `src/analyzer/index.test.ts` after formula change, verify updated assertions pass |
| AC-E1 | Integration | Build graph with only test files (`isTestFile:true`), call coverage hotspot, assert empty results |
| AC-E2 | Integration | Build graph with only test files, call coupling hotspot, assert empty results |
| AC-7 | Integration | Build graph including `.spec.ts` file, call coverage+coupling hotspots, assert `.spec.ts` excluded |

### Failure Mode Tests (MANDATORY)

| Source | ID | Test Intention | Priority |
|--------|----|----------------|----------|
| Error Journey | E1 | Integration: all-test-file codebase returns empty coverage hotspots | BLOCKING |
| Error Journey | E2 | Integration: all-test-file codebase returns empty coupling hotspots | BLOCKING |
| Edge Case | EC2 | Unit: isolated file (0 fan_in, 0 fan_out) still gets coupling=0 | BLOCKING |
| Edge Case | EC7 | Integration: entry point files (fan_in=0) appear in coupling results but score < 1.0 | BLOCKING |
| Edge Case | EC9 | Integration: old cache without `isTestFile` imports without error (undefined is safe) | Advisory |
| Failure Hypothesis | FH-1 (HIGH) | Integration: coupling formula change doesn't invert ranking of real hub files | BLOCKING |
| Failure Hypothesis | FH-2 (MED) | Integration: isTestFile=false for source files in `__tests__` sibling dirs | BLOCKING |
| Failure Hypothesis | FH-3 (MED) | Integration: `.spec.ts` files are filtered same as `.test.ts` files | BLOCKING |
| Existing Test | ET-1 (HIGH) | `src/analyzer/index.test.ts:93-107` coupling assertions updated and passing | BLOCKING |

### Test Implementation Approach

Tests MUST use the real pipeline (parser -> graph -> analyzer) per project CLAUDE.md policy. No mocks of internal modules.

For MCP-level tests (AC-1, AC-2, AC-E1, AC-E2, AC-7): Use real `McpServer` + `InMemoryTransport` pattern from `tests/mcp-tools.test.ts`. Build graph through pipeline, register tools, call via MCP client.

For analyzer-level tests (AC-3, AC-4, AC-4b, EC2, EC7): Use `makeFile()` + `buildGraph()` + `analyzeGraph()` pattern from `src/analyzer/index.test.ts`.

For fixture-based tests (FH-2, FH-3): Use `getFixturePipeline()` from `tests/helpers/pipeline.ts` after adding `.spec.ts` fixture file.

### Mock Boundary

No mocks. Build real graphs through the parser->graph->analyzer pipeline per project testing rules.

### TDD Commitment

All tests written BEFORE implementation (RED -> GREEN -> REFACTOR).

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Coupling formula change alters existing test assertions | MED | **CERTAIN** | `src/analyzer/index.test.ts:103` asserts `coupling === 1` for fan_in=0. MUST update to new expected value. Scope item 4b. |
| `isTestFile` on `FileMetrics` breaks persistence/serialization | LOW | LOW | Checked: `importGraph` uses `as` cast. `undefined` is falsy = treated as source file (safe). No code change needed. |
| Filtering in MCP layer masks deeper issue (test files in graph at all) | LOW | LOW | Out of scope -- test files ARE legitimate graph nodes for other analyses |
| Formula `max(fan_in, 1)` still ranks entry points high (0.91 for fan_out=10) | LOW | MED | Acceptable -- entry points ARE coupled. Only test files should be filtered out. |
| `docs/data-model.md` gets out of sync with `FileMetrics` | LOW | HIGH | Added scope item 6b. Documented in Codebase Impact. |
| Test files with non-standard naming (e.g., `tests/helpers.ts`) slip through filter | LOW | MED | Parser only matches `.test.`/`.spec.`/`__tests__/`. Documented in Out of Scope. Matches industry standard. |

**Kill criteria:** If filtering test files requires changes to the graph builder or parser beyond populating `isTestFile`, scope is wrong -- reassess.

## State Machine

**Status**: N/A -- Stateless feature

**Rationale**: Pure data transformation fix. No state transitions, no async flows. Input (graph) -> filter/compute -> output (hotspot list).

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| `isTestFile` is reliably set by parser | Parser sets it at `index.ts:482-486` using `.test.`/`.spec.`/`__tests__/` patterns | Misses `tests/helpers.ts` (non-`__tests__` test dir, no `.test.`/`.spec.` in name) | VALID -- covers standard conventions. `tests/helpers.ts` is ambiguous (could be test utility or source helper). |
| Filtering at MCP layer is sufficient | MCP is the only consumer of hotspot rankings | Analyzer still computes coupling for test files internally | VALID -- coupling formula fix addresses root cause at computation layer; MCP filter is presentation layer cleanup |
| Coupling formula `fan_out/(fan_in+fan_out)` is the root cause | Files with fan_in=0 always get 1.0; these are leaf consumers by design | Could also weight by absolute values (fan_out=1 vs fan_out=20) | VALID -- `max(fan_in, 1)` formula addresses the 1.0 ceiling; absolute weighting is a separate enhancement |
| Existing coupling test at line 103 asserts `coupling === 1` | Confirmed by reading `src/analyzer/index.test.ts:103` | Formula change makes this `2/3 = 0.667` with `max(fan_in,1)` | WILL BREAK -- must update assertion (scope item 4b) |
| Persistence is backward-compatible | `importGraph` uses `as` cast; `undefined` is falsy | Technically `isTestFile` will be `undefined` not `false` for old caches | SAFE -- `undefined` is falsy, same behavior as `false` for filtering. No code change needed. |
| Fixture codebase covers all test file patterns | Has `__tests__/auth-service.test.ts` | No `.spec.ts` fixture files exist | GAP -- add `.spec.ts` fixture for coverage (scope item 5b) |

### Blind Spots

1. **[data] RESOLVED** Persistence layer serializes `FileMetrics` via JSON spread. Adding `isTestFile` is safe -- old caches return `undefined` (falsy = source file). No migration needed.

2. **[integration]** Other MCP tools iterating `fileMetrics` (e.g., `file_context`, `codebase_overview`) may also expose test file noise
   Why it matters: Fix is scoped to `find_hotspots` only; other tools may have similar issues
   Action: no action for this spec (document for future)

3. **[testing] NEW** Existing test `src/analyzer/index.test.ts:93-107` asserts exact coupling values that WILL change. Must be identified and updated as part of implementation.
   Why it matters: Tests will fail immediately after formula change if not updated in same commit.

4. **[docs] NEW** `docs/data-model.md` documents `FileMetrics` (lines 60-79) but doesn't have `isTestFile`. Adding the field requires updating this doc.
   Why it matters: Data model doc is single source of truth for LLM context.

5. **[testing] NEW** Fixture codebase at `tests/fixture-codebase/src/` has only one test file (`__tests__/auth-service.test.ts`). No `.spec.ts` files exist. Tests relying on `getFixturePipeline()` won't exercise spec-pattern filtering.
   Why it matters: AC-7 (spec files excluded) can't be validated against fixture pipeline without adding a fixture.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Coupling formula is changed to `fanOut / (max(fanIn,1) + fanOut)` | Entry points get 0.91 instead of 1.0 (for fan_out=10) | `max(fan_in,1)` clamps but doesn't eliminate | MED | Acceptable -- entry points ARE coupled. Test files filtered separately. |
| `isTestFile` is not on `FileMetrics` and we pattern-match filePath instead | Logic duplicates parser's test detection | Two sources of truth for "is this a test file" | MED | Add `isTestFile` to `FileMetrics` (scope item 1) |
| All tests for coverage hotspot pass but real codebase still shows test files | Parser didn't mark files as `isTestFile` for some pattern | Unconventional project structure | LOW | Document supported patterns; out of scope |
| Existing analyzer tests break silently | CI passes but coupling values are wrong | Test updated to wrong expected values | MED | Compute expected values by hand: `fan_in=0, fan_out=2 -> 2/(1+2) = 0.667` |
| Coupling hotspot with all-test-file codebase returns non-empty | Spec only has AC-E1 for coverage | Coupling filter also needed | MED | Added AC-E2 to cover this case |

### The Real Question

Confirmed -- spec solves the right problem. Test files are valid graph nodes but should not rank in metrics designed to surface source-file issues. Filtering at the presentation layer (MCP) + fixing the coupling formula at the computation layer (analyzer) addresses both root causes without disrupting other analyses.

### Open Items

- ~~[gap] Check `src/persistence/index.ts` for `FileMetrics` serialization impact~~ RESOLVED: safe, `undefined` is falsy
- [improvement] Consider `include_tests` param on `find_hotspots` for opt-in test file inclusion -> no action (out of scope)
- ~~[question] Should coupling formula use `max(fan_in, 1)` denominator or exclude fan_in=0 entirely?~~ DECIDED: `max(fan_in, 1)` -- see "Coupling Formula Decision" in Scope section

## Notes

- Spec reviewed adversarially: 2026-03-11. 8 findings applied (3 BLOCKING, 5 improvements). See Analysis section.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Add isTestFile to FileMetrics | pending | - |
| 2 | Filter test files from coverage | pending | - |
| 3 | Filter test files from coupling | pending | - |
| 4 | Adjust coupling formula | pending | - |
| 4b | Update existing analyzer test assertions | pending | - |
| 5 | Regression tests (all ACs) | pending | - |
| 5b | Add .spec.ts fixture file | pending | - |
| 6 | Update docs/metrics.md | pending | - |
| 6b | Update docs/data-model.md | pending | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-11 | - | Created |
| spec-review | 2026-03-11 | - | Adversarial review applied. Added: AC-4b, AC-6, AC-7, AC-E2, EC4-EC9, scope 4b/5b/6b. Pinned coupling formula. Resolved persistence risk. |
