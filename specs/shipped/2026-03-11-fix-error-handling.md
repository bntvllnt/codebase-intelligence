---
title: "Fix inconsistent error handling + LOC off-by-one"
status: active
created: 2026-03-11
estimate: 1h
tier: mini
reviewed: 2026-03-11
---

# Fix inconsistent error handling + LOC off-by-one

**Issue**: [#8](https://github.com/bntvllnt/codebase-intelligence/issues/8)

## Codebase Impact

| Area | Impact | Detail |
|------|--------|--------|
| `src/impact/index.ts` | MODIFY | Add `notFound` flag to `ImpactResult` return value when symbol not found (line 71-72) |
| `src/mcp/index.ts` | MODIFY | Check `impactAnalysis` result for `notFound`, return `isError: true` (line 616-624) |
| `src/parser/index.ts` | MODIFY | Fix LOC fencepost error (line 160): use `getEnd() === 0 ? 0 : getLineAndCharacterOfPosition(getEnd() - 1).line + 1` |
| `tests/mcp-tools.test.ts` | MODIFY | Update existing `impact_analysis` unknown symbol test (line 264-267) to expect `isError: true` instead of `totalAffected: 0` |
| `tests/` | CREATE | Regression tests for both bugs + LOC edge cases |

**Files:** 0 create | 3 modify | 1 test create
**Reuse:** Error pattern from `symbol_context` handler (`src/mcp/index.ts:443-448`) and `file_context` handler (`src/mcp/index.ts:74-78`)
**Breaking changes:** none (MCP response shape change only affects error case, which previously returned misleading empty data)
**New dependencies:** none

## User Journey

ACTOR: LLM calling MCP tools
GOAL: Get consistent error responses for nonexistent entities
PRECONDITION: Codebase graph is loaded

1. User calls `impact_analysis` with nonexistent symbol
   -> System detects symbol not in graph
   -> User sees `{"error": "Symbol not found: <name>"}` with `isError: true`

2. User calls `file_context` on a file
   -> System reports correct LOC (no off-by-one)
   -> User sees accurate line count matching `wc -l`

Error: User calls `impact_analysis` with valid symbol that has zero callers
   -> System returns `{"symbol": "...", "levels": [], "totalAffected": 0}` (not an error)

POSTCONDITION: All three entity-lookup tools (`file_context`, `symbol_context`, `impact_analysis`) return consistent `isError` responses for missing entities

## Acceptance Criteria

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN a loaded graph WHEN `impact_analysis` is called with a nonexistent symbol THEN response contains `{"error": "Symbol not found: <name>"}` with `isError: true`
- [ ] AC-2: GIVEN a loaded graph WHEN `impact_analysis` is called with a valid symbol that has zero callers THEN response contains `{"levels": [], "totalAffected": 0}` (not an error)
- [ ] AC-3: GIVEN a file ending with a trailing newline WHEN `file_context` reports LOC THEN LOC matches `wc -l` (no off-by-one)
- [ ] AC-4: GIVEN a file WITHOUT a trailing newline WHEN parsed THEN LOC equals number of content lines (fix must not regress no-newline case)
- [ ] AC-5: GIVEN an empty file (0 bytes) WHEN parsed THEN LOC equals 0 (no crash from `getEnd() - 1`)
- [ ] AC-6: GIVEN a single-line file (with or without trailing newline) WHEN parsed THEN LOC equals 1
- [ ] AC-7: GIVEN a file with only comments WHEN parsed THEN LOC equals number of lines (comments count as LOC in this tool)

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN a loaded graph WHEN any entity-lookup tool receives a nonexistent entity THEN it returns `isError: true` with a descriptive message (consistency across `file_context`, `symbol_context`, `impact_analysis`)

## Scope

- [ ] 1. Add `notFound` flag to `ImpactResult` in `impactAnalysis` return value (`src/impact/index.ts:71-72`) -- return `{ symbol: symbolQuery, levels: [], totalAffected: 0, notFound: true }` when targetIds empty -> AC-1, AC-2
- [ ] 2. Add error check in `impact_analysis` MCP handler (`src/mcp/index.ts:616-624`): if `result.notFound`, return `{ error: "Symbol not found: ${symbol}" }` with `isError: true`, matching `symbol_context` pattern -> AC-1, AC-E1
- [ ] 3. Fix LOC fencepost in `parseFile` (`src/parser/index.ts:160`): replace `sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1` with `sourceFile.getEnd() === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd() - 1).line + 1` -> AC-3, AC-4, AC-5, AC-6, AC-7
- [ ] 4. Update existing test `tests/mcp-tools.test.ts:264-267` ("returns empty levels for unknown symbol") to assert `isError: true` instead of `totalAffected: 0` -> AC-1
- [ ] 5. Regression tests for error handling and LOC edge cases -> AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-E1

### Out of Scope

- `rename_symbol` error handling for nonexistent symbols (see Analysis -- flagged for future work, separate issue)
- Auditing other MCP tools for error consistency beyond `impact_analysis`
- Changing the error response format (keep existing `{"error": "..."}` + `isError` pattern)

## Quality Checklist

### Blocking

- [ ] All ACs passing
- [ ] No regressions in existing tests (note: existing `impact_analysis` unknown symbol test MUST be updated -- see scope item 4)
- [ ] Error states handled
- [ ] LOC fix doesn't break export-level LOC counting (`extractExports` uses `endLine - startLine + 1`, separate logic)
- [ ] Empty file edge case guarded (`getEnd() === 0 ? 0 : ...`)

### Advisory

- [ ] Error message format matches existing tools exactly (`"Symbol not found: ${name}"`)
- [ ] `rename_symbol` error handling inconsistency tracked for future fix

## Test Strategy

Runner: vitest | E2E: none needed (logic-level fix) | TDD: RED -> GREEN per AC

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Integration (MCP) | Call `impact_analysis` via MCP client with nonexistent symbol, assert `isError: true` and `error` contains "Symbol not found" |
| AC-1 | Integration (function) | Call `impactAnalysis(graph, "nonexistent")` directly, assert `notFound: true` |
| AC-2 | Integration (MCP) | Call `impact_analysis` with valid symbol with zero callers, assert `isError` is absent/falsy, `levels: []`, `totalAffected: 0` |
| AC-3 | Integration (parser) | Create fixture file with trailing newline, parse, assert `loc` equals `wc -l` count |
| AC-4 | Integration (parser) | Create fixture file WITHOUT trailing newline, parse, assert `loc` equals content line count |
| AC-5 | Integration (parser) | Create empty `.ts` file (0 bytes), parse, assert `loc === 0` -- no crash |
| AC-6 | Integration (parser) | Create single-line file with trailing newline, parse, assert `loc === 1`; same without trailing newline |
| AC-7 | Integration (parser) | Create comments-only file, parse, assert `loc` equals line count |
| AC-E1 | Integration (MCP) | Call `file_context`, `symbol_context`, `impact_analysis` each with nonexistent input, assert all three return `isError: true` with `{"error": "...not found..."}` shape |

Mocks: none (real parser, real graph, real analyzer per project rules)

### Existing Test Updates

The test at `tests/mcp-tools.test.ts:264-267` currently asserts:
```typescript
it("returns empty levels for unknown symbol", async () => {
  const r = await callTool("impact_analysis", { symbol: "nonexistent_xyz_123" });
  expect(r).toHaveProperty("totalAffected", 0);
});
```
This MUST be updated to assert `isError: true` instead, since the behavior is intentionally changing. This is NOT a regression -- it's correcting the test to match the new correct behavior.

## Analysis

### Assumptions Challenged

| # | Assumption | Evidence For | Evidence Against | Verdict | Action |
|---|------------|-------------|-----------------|---------|--------|
| 1 | `sourceFile.getEnd()` points past the final newline, causing `+1` to double-count | TS API docs: `getEnd()` returns position after last character. Empirically verified: 3-line file with trailing newline gives `loc=4` (should be 3) | None | VALID | -> no action |
| 2 | `impactAnalysis` is the only tool with inconsistent error handling | `file_context`, `symbol_context`, `get_dependents` all check and return `isError` | **WRONG**: `rename_symbol` MCP handler (lines 636-644) does NOT check for empty results. Calling with nonexistent symbol returns `{ references: [], totalReferences: 0 }` without `isError`. The spec originally claimed `rename_symbol` checks and returns `isError` -- this is false. | WRONG | -> flagged for future fix, kept out of this spec's scope to avoid scope creep |
| 3 | Export-level LOC in `extractExports` (line 201: `endLine - startLine + 1`) is unaffected by the fix | Different calculation using span delta, not file-level `getEnd()` | None | VALID | -> no action |
| 4 | The LOC fix `getEnd() - 1` handles all edge cases | Works for trailing newline (3 lines: 4->3), no trailing newline (3->3), single line (1->1) | **Crashes on empty files**: `getEnd() === 0`, so `getEnd() - 1 === -1` causes invalid position. Empirically verified. | RISKY | -> update scope to include empty file guard (done) |
| 5 | No existing tests will break | AC-1 changes behavior for unknown symbol case | **WRONG**: Existing test at `mcp-tools.test.ts:264-267` asserts `totalAffected: 0` for unknown symbol. This WILL break. | WRONG | -> update spec to include test update (done, scope item 4) |

### Blind Spots

| # | Category | Blind Spot | Impact If Ignored | Suggested Spec Change |
|---|----------|-----------|-------------------|----------------------|
| 1 | [data] | Files without trailing newlines may report LOC differently after fix | False -- empirically verified fix is correct for both cases (3 lines -> 3 either way) | Added AC-4 to test explicitly |
| 2 | [integration] | Downstream consumers caching old LOC values (persistence layer) may show stale data until re-analyzed | Low -- users re-analyze on demand, stale data is expected behavior | N/A |
| 3 | [testing] | Empty file, single-line file, comments-only file LOC edge cases not tested | Parser crash on empty file; silent incorrect counts on edge cases | Added AC-5, AC-6, AC-7 with dedicated tests |
| 4 | [consistency] | `rename_symbol` has same missing error handling as `impact_analysis` | LLM callers get empty result instead of clear error for nonexistent symbols in rename | Flagged for future issue, not in this spec's scope |
| 5 | [testing] | Spec had no test for existing test update | Build would fail on unchanged test asserting old behavior | Added scope item 4 to update existing test |

### Failure Hypotheses

| # | IF | THEN | BECAUSE | Severity | Mitigation Status |
|---|-----|------|---------|----------|-------------------|
| 1 | LOC fix uses `getEnd() - 1` without guard | Empty file (0 bytes) crashes with invalid position | `getEnd() === 0`, so `getEnd() - 1 === -1` | HIGH | Added -- guard in scope item 3 |
| 2 | Existing test not updated | CI fails with test regression | Test at line 264-267 asserts old behavior (`totalAffected: 0`) | HIGH | Added -- scope item 4 |
| 3 | `impactAnalysis` returns `notFound` but MCP handler doesn't check it | Unknown symbol silently returns empty result (current broken behavior persists) | Implementation misses the handler-level check | MED | Explicit in scope items 1+2 |

### The Real Question

Confirmed -- spec solves the right problems. Both are clear bugs with deterministic fixes. The LOC fix was empirically verified across 8 edge cases (trailing newline, no trailing newline, empty file, single newline, single line with/without newline, comments-only, multi-line). The `rename_symbol` inconsistency is real but correctly scoped out to avoid creep.

### Open Items

- [risk] `rename_symbol` has same missing error handling as `impact_analysis` -> file separate issue for future fix
- ~~[gap] Empty file edge case for LOC fix -> update scope item 3 to include guard~~ RESOLVED: guard added to scope item 3
- ~~[gap] Existing test will break -> update scope~~ RESOLVED: scope item 4 added

## Notes

Spec review applied: 2026-03-11

### Review Findings Applied

1. **WRONG assumption corrected**: `rename_symbol` does NOT have error handling -- the original spec falsely claimed it did. Flagged for future work.
2. **Existing test breakage identified**: `tests/mcp-tools.test.ts:264-267` must be updated (scope item 4 added).
3. **LOC fix empirically verified**: `getEnd() === 0 ? 0 : getLineAndCharacterOfPosition(getEnd() - 1).line + 1` passes all 8 edge cases tested.
4. **Edge case ACs added**: AC-4 (no trailing newline), AC-5 (empty file), AC-6 (single-line), AC-7 (comments-only).
5. **Test strategy expanded**: Every AC now has a specific test intention with real pipeline, no mocks.

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-11 | - | Created |
| spec-review | 2026-03-11 | - | Adversarial review: 2 wrong assumptions found, 5 blind spots, 3 failure hypotheses, 4 ACs added, 1 scope item added |
