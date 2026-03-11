---
title: Metric Quality Improvements & DX Enhancements
status: active
created: 2026-03-11
estimate: 4h
tier: standard
reviewed: 2026-03-11
---

# Metric Quality Improvements & DX Enhancements

**Issue**: [#9](https://github.com/bntvllnt/codebase-intelligence/issues/9)

## Context

`analyze_forces` produces misleading results: 10/12 modules flagged as `JUNK_DRAWER` when 7 are single-file modules where cohesion math is meaningless (0 internal deps / 0 total deps = 0 cohesion). Additionally, `file_context` rejects valid paths with `src/` prefix, tension analysis recommends splitting design-intentional hub files (`types/index.ts`, `cli.ts`), and `nextSteps` hints are static regardless of result data. Churn metric exists in parser but may silently return 0 when git output paths don't match `relativePath` keys.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/analyzer/index.ts:319-453` | MODIFY | Fix `computeForceAnalysis` — add `LEAF` verdict for single-file modules (excluding test files from count); suppress tension recommendations for type hubs and entry points |
| `src/analyzer/index.ts:327` | MODIFY | **CRITICAL**: Local `CohesionVerdict` type in `computeForceAnalysis` must add `LEAF` — this is where verdicts are actually computed |
| `src/mcp/index.ts:338` | MODIFY | **CRITICAL**: Second `CohesionVerdict` type in `analyze_forces` MCP handler must also add `LEAF` — dual verdict location, both must be updated or `LEAF` from analyzer gets overwritten by MCP handler re-verdict logic |
| `src/types/index.ts:140-146` | MODIFY | Add `"LEAF"` to `ForceAnalysis.moduleCohesion[].verdict` union type |
| `src/mcp/index.ts:68-120` | MODIFY | `file_context` handler — strip `src/`/`lib/`/`app/` prefix from `filePath` before graph lookup; normalize backslashes to forward slashes; improve error message with available paths |
| `src/mcp/hints.ts` | MODIFY | (LOW — defer OK) Replace static `getHints()` with context-aware hint generation accepting result data |
| `src/mcp/index.ts` (all tool handlers) | MODIFY | (LOW — defer OK) Pass result data to `getHints()` for context-aware hints |
| `src/parser/index.ts:439-456` | MODIFY | (LOW — defer OK) Fix churn path matching — `git log --name-only` outputs paths relative to repo root, may not match `relativePath` when project root differs |
| `docs/metrics.md` | MODIFY | Document `LEAF` verdict and updated cohesion scoring |
| `docs/mcp-tools.md` | MODIFY | Document `file_context` path normalization behavior |

**Files:** 0 create | 6 modify | 0 affected
**Reuse:** Existing `ModuleMetrics.files` field already tracks file count per module (used at `analyzer/index.ts:258`). Existing `GraphNode.module` and node metadata sufficient for hub/entry-point detection.
**Breaking changes:** `ForceAnalysis.moduleCohesion[].verdict` adds `"LEAF"` — consumers matching on verdict values may need update. Non-breaking in practice since LLMs consume JSON.
**New dependencies:** None

## User Journey (MANDATORY)

### Primary Journey

ACTOR: LLM agent consuming MCP tools
GOAL: Get accurate architectural insights without false positives

PRECONDITION: Codebase parsed and graph built

1. Agent calls `analyze_forces`
   -> System labels single-file modules (e.g. `community/`, `search/`) as `LEAF` instead of `JUNK_DRAWER`
   -> Agent sees accurate cohesion verdicts, summary reports only real junk-drawer modules

2. Agent calls `analyze_forces` on codebase with `types/index.ts` under tension
   -> System suppresses split recommendation for type hub files and entry points (`cli.ts`)
   -> Agent does not receive misleading "split types-index.ts" advice

3. Agent calls `file_context("src/mcp/index.ts")`
   -> System strips `src/` prefix, resolves to `mcp/index.ts` in graph
   -> Agent receives full file context instead of "File not found"

4. Agent calls `find_hotspots(metric='coupling')` and gets results with all scores > 0.5
   -> System returns context-aware hints mentioning "analyze_forces" for high coupling
   -> Agent gets relevant next-step guidance

POSTCONDITION: Agent receives accurate metrics and actionable hints without false positives

### Error Journeys

E1. Path normalization miss
    Trigger: User passes path not in graph even after prefix stripping (e.g., `foo/bar.ts`)
    1. Agent calls `file_context("foo/bar.ts")`
       -> System strips known prefixes, still no match
       -> Agent sees error with helpful message: "File not found. Did you mean: [top 3 fuzzy matches]?"
    Recovery: Agent retries with correct path from suggestions

E2. Verdict type consumer mismatch
    Trigger: Downstream consumer hardcoded `COHESIVE | MODERATE | JUNK_DRAWER` check
    1. Consumer processes `analyze_forces` response
       -> `LEAF` verdict passes through as valid JSON string
    Recovery: No crash — `LEAF` is a new additive value, not a replacement

### Edge Cases

EC1. Module with exactly 1 non-test file and 0 deps: verdict = `LEAF` (not `JUNK_DRAWER` with cohesion 0)
EC2. Module with 1 non-test file but outgoing deps to other modules: still `LEAF` — cohesion is meaningless for single-file modules regardless of external deps. The file count determines LEAF, not the dependency profile.
EC3. `file_context` with path containing multiple `src/` segments (e.g., `src/src/foo.ts`): strip only leading prefix once
EC4. Type hub detection: file named `types.ts` or `types/index.ts` in any module — suppress split rec
EC5. Entry point detection: `cli.ts`, `main.ts`, `index.ts` at root — suppress split rec
EC6. Module with 2 files where 1 is a test file (e.g., `community/index.ts` + `community/index.test.ts`): count only non-test files for LEAF determination. This module has 1 production file -> `LEAF`.
EC7. Module with 2 production files + 1 test file: 2 non-test files -> NOT `LEAF`, compute cohesion normally.
EC8. `file_context` with Windows backslash path (e.g., `src\mcp\index.ts`): normalize to forward slashes before lookup.
EC9. `analyze_forces` with custom `cohesionThreshold` param: MCP handler re-computes verdicts — must preserve `LEAF` for single-file modules regardless of threshold.
EC10. Tension suppression for `types/index.ts` in a module where types file genuinely has misplaced non-type code: still suppressed (false negative accepted — filename-based heuristic, not content-based).
EC11. Module at root (`.` module from `getModule`): single root-level files like `cli.ts` map to module `.` — if only 1 non-test file in `.` module, it gets `LEAF`. But typically root has multiple files, so this is unlikely.

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN a codebase where a module contains exactly 1 non-test file WHEN `analyze_forces` runs THEN that module's verdict is `LEAF`, not `JUNK_DRAWER`
- [ ] AC-2: GIVEN `types/index.ts` has tension > 0.3 (pulled by multiple modules) WHEN `analyze_forces` runs THEN no split recommendation is generated for type hub files
- [ ] AC-3: GIVEN `cli.ts` has tension > 0.3 WHEN `analyze_forces` runs THEN no split recommendation is generated for entry point files
- [ ] AC-4: GIVEN graph contains file `mcp/index.ts` WHEN `file_context("src/mcp/index.ts")` is called THEN the file is found and full context returned (prefix stripped)
- [ ] AC-5: GIVEN `ForceAnalysis` type WHEN inspected THEN `verdict` union includes `"LEAF"` alongside existing values
- [ ] AC-6: GIVEN `analyze_forces` summary WHEN single-file modules exist THEN summary does not count `LEAF` modules in "junk-drawer" count
- [ ] AC-9: GIVEN `analyze_forces` called with custom `cohesionThreshold` WHEN a module is single-file THEN verdict is still `LEAF` (MCP handler must not re-classify LEAF modules based on threshold)
- [ ] AC-10: GIVEN a module with 2 files where 1 is a test file WHEN `analyze_forces` runs THEN verdict is `LEAF` (test files excluded from production file count)

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN a path not in graph even after prefix stripping WHEN `file_context` called THEN error includes suggestion of similar paths from graph
- [ ] AC-E2: GIVEN a module with 2+ non-test files and 0 internal deps WHEN `analyze_forces` runs THEN verdict is `JUNK_DRAWER` (not incorrectly labeled `LEAF`)

### Should Have (ship without, fix soon)

- [ ] AC-7: GIVEN `find_hotspots` returns results with all scores > threshold WHEN response generated THEN `nextSteps` hints reference relevant follow-up tools based on result data
- [ ] AC-8: GIVEN a git repo with commit history WHEN parser runs THEN churn values are non-zero for files with commits

## Scope

- [ ] 1. Add `LEAF` verdict for single-file modules in `computeForceAnalysis` (count non-test files only) and update `ForceAnalysis` type. **Also update MCP handler's local `CohesionVerdict` type at `mcp/index.ts:338` to preserve LEAF through re-verdict.** -> AC-1, AC-5, AC-6, AC-9, AC-10, AC-E2
- [ ] 2. Suppress tension split recommendations for type hubs and entry points -> AC-2, AC-3
- [ ] 3. Add path normalization to `file_context` handler (prefix stripping + backslash normalization) with fuzzy error suggestions -> AC-4, AC-E1
- [ ] 4. (LOW — defer to follow-up issue) Make `getHints()` context-aware, accepting result data -> AC-7
- [ ] 5. (LOW — defer to follow-up issue) Investigate and fix churn path matching in parser -> AC-8

### Out of Scope

- Changing cohesion formula for multi-file modules
- Adding new MCP tools
- Changing `ModuleMetrics` interface (cohesion field stays numeric)
- `get_dependents` / `impact_analysis` path normalization (follow-up)
- Full `git log --numstat` integration (lines added/removed) — current `--name-only` approach is sufficient if paths match
- Path normalization for monorepo `packages/foo/src/bar.ts` patterns (follow-up — requires understanding monorepo root detection)

## Implementation Details

### 1. LEAF Verdict — Non-Test File Counting

The `getModule()` function at `graph/index.ts:216` assigns modules by directory. Test files (`.test.ts`, `.spec.ts`, `__tests__/`) are included in the graph and counted in `ModuleMetrics.files`. For LEAF determination, count only non-test files.

**Approach**: In `computeForceAnalysis`, after grouping files by module, filter by `isTestFile` flag (available on `ParsedFile`, but NOT on `GraphNode`). Since `computeForceAnalysis` receives `fileNodes: GraphNode[]` (not `ParsedFile[]`), the test-file status must be obtained differently:

- **Option A**: Check filename patterns in `computeForceAnalysis` (`.test.`, `.spec.`, `__tests__/`). Simple, no interface changes. Duplicates parser logic.
- **Option B**: Add `isTestFile` to `GraphNode` type and propagate from `buildGraph`. Cleaner, but modifies more files.
- **Recommended**: Option A — keep change minimal. The filename heuristic is identical to what the parser uses.

```
Non-test file count = files.filter(f => !f.id.includes('.test.') && !f.id.includes('.spec.') && !f.id.includes('__tests__/')).length
If non-test count === 1 -> verdict = LEAF (skip cohesion thresholds)
```

### 2. Dual Verdict Location Problem

Verdicts are computed in TWO places:
1. `analyzer/index.ts:327-330` — `computeForceAnalysis()` computes initial verdicts
2. `mcp/index.ts:338-342` — `analyze_forces` handler RE-COMPUTES verdicts when custom thresholds are provided

Both must handle `LEAF`. The MCP handler must check `m.files` (available since `moduleCohesion` entries extend `ModuleMetrics`) and preserve `LEAF` for single-file modules regardless of threshold.

```
In MCP handler:
const nonTestFiles = ... (same heuristic)
if (nonTestFiles === 1) -> verdict = "LEAF" (bypass threshold logic)
else -> apply threshold as before
```

**PROBLEM**: The MCP handler has access to `ModuleMetrics` (which includes `files` count) but NOT to individual file nodes. It cannot check `isTestFile` or filename patterns per-file.

**Resolution options**:
- **A**: Store the `LEAF` verdict from the analyzer and don't re-compute it in the MCP handler. If `m.verdict === "LEAF"` in stored data, preserve it. Only re-compute for non-LEAF modules.
- **B**: Add `nonTestFiles` count to `ModuleMetrics`.
- **Recommended**: Option A — simplest. The MCP handler can check: `if original verdict was LEAF, keep it; else re-compute with threshold`.

### 3. Path Normalization

Normalize in this order:
1. Replace backslashes with forward slashes
2. Strip leading `src/`, `lib/`, `app/` (one pass, first match only, using `^(src|lib|app)/`)
3. Attempt graph lookup
4. If no match, attempt fuzzy match against all graph file keys

**Fuzzy matching**: Use simple Levenshtein or substring match against `graph.fileMetrics.keys()`. Return top 3 closest matches.

### 4. Tension Suppression Heuristic

Suppress split recommendation (not the tension file entry itself) when:
- File basename matches: `types.ts`, `types/index.ts`, `constants.ts`, `config.ts`
- File is at module root AND named `index.ts`, `cli.ts`, `main.ts`, `app.ts`, `server.ts`
- Detection by filename pattern only — no fan-in threshold (keep simple)

**Set `recommendation` to a descriptive message** instead of omitting:
- `"Type hub — split not recommended (design-intentional shared types)"`
- `"Entry point — split not recommended (CLI/app entry point)"`

This preserves tension data for analysis while preventing misleading action.

**False-negative risk**: A file named `types.ts` that is genuinely misplaced and should be split will have its recommendation suppressed. Accepted trade-off — the tension score itself is still visible, and users can inspect manually. The alternative (content analysis or fan-in thresholds) adds complexity disproportionate to the benefit.

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing (AC-1 through AC-6, AC-9, AC-10)
- [ ] All Error Criteria ACs passing (AC-E1, AC-E2)
- [ ] All scope items 1-3 implemented
- [ ] No regressions in existing tests (especially `analyzer/index.test.ts:180` verdict assertion)
- [ ] Error states handled (not just happy path)
- [ ] No hardcoded secrets or credentials
- [ ] `ForceAnalysis` type change reflected in `docs/metrics.md`
- [ ] `file_context` path normalization documented in `docs/mcp-tools.md`
- [ ] All quality gates pass: lint -> typecheck -> build -> test

### Advisory (should pass, not blocking)

- [ ] Items 4-5 (hints, churn) deferred with tracking issue created
- [ ] Code follows existing project patterns (no new abstractions)

## Test Strategy (MANDATORY)

### Test Environment

| Component | Status | Detail |
|-----------|--------|--------|
| Test runner | detected | vitest |
| E2E framework | not configured | N/A — MCP tool tests use real server instances |
| Test DB | none | In-memory graph |
| Mock inventory | 0 existing mocks | No mocks (project policy) |

### AC -> Test Mapping

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Integration | Build graph with single-file module (non-test) -> `analyzeGraph` -> assert `LEAF` verdict |
| AC-2 | Integration | Build graph where `types/index.ts` has multi-module tension -> assert recommendation says "not recommended" instead of "Split into..." |
| AC-3 | Integration | Build graph where `cli.ts` has multi-module tension -> assert recommendation says "not recommended" |
| AC-4 | Integration | Register MCP tools, call `file_context` with `src/` prefix -> assert success and correct file returned |
| AC-5 | Unit | TypeScript compilation check — `LEAF` in verdict type (validated implicitly by other tests compiling) |
| AC-6 | Integration | Build graph with mix of single-file and multi-file modules -> assert summary text excludes `LEAF` from junk-drawer count |
| AC-9 | Integration | MCP `analyze_forces` with custom `cohesionThreshold` on graph with single-file module -> assert verdict stays `LEAF` |
| AC-10 | Integration | Build graph with module containing 1 `.ts` file + 1 `.test.ts` file -> `analyzeGraph` -> assert `LEAF` verdict |
| AC-E1 | Integration | Call `file_context` with nonexistent path via MCP -> assert error includes path suggestions |
| AC-E2 | Integration | Build graph with 2-file module (both non-test), 0 internal deps -> assert `JUNK_DRAWER` verdict |

### Failure Mode Tests (MANDATORY)

| Source | ID | Test Intention | Priority |
|--------|----|----------------|----------|
| Error Journey | E1 | Integration: `file_context` with bad path returns suggestions, not just "not found" | BLOCKING |
| Error Journey | E2 | Integration: multi-file zero-cohesion module still gets `JUNK_DRAWER` | BLOCKING |
| Edge Case | EC1 | Integration: 1-file 0-dep module -> `LEAF` | BLOCKING |
| Edge Case | EC2 | Integration: 1-file module with outgoing deps -> still `LEAF` | BLOCKING |
| Edge Case | EC3 | Integration: `src/src/foo.ts` strips only one `src/` prefix | BLOCKING |
| Edge Case | EC4 | Integration: `types.ts` in nested module -> suppress split rec | BLOCKING |
| Edge Case | EC6 | Integration: module with prod file + test file -> `LEAF` | BLOCKING |
| Edge Case | EC7 | Integration: module with 2 prod files + 1 test file -> NOT `LEAF` | BLOCKING |
| Edge Case | EC8 | Integration: `file_context` with backslash path -> normalizes and finds file | Advisory |
| Edge Case | EC9 | Integration: MCP `analyze_forces` with custom threshold preserves `LEAF` | BLOCKING |
| Regression | REG-1 | Integration: existing `analyze_forces` tests still pass with new verdict (line 180 assertion must include `LEAF`) | BLOCKING |
| Regression | REG-2 | Integration: existing MCP `analyze_forces` tool test (mcp-tools.test.ts:146-168) still passes | BLOCKING |

### Mock Boundary

| Dependency | Strategy | Justification |
|------------|----------|---------------|
| All internal modules | Real | Project policy: never mock internals |
| Git (churn) | Real git repo fixture or skip | `execFileSync("git")` — use real repo in test fixtures |

### TDD Commitment

All tests written BEFORE implementation (RED -> GREEN -> REFACTOR).
Real parser + graph + analyzer pipeline in tests — no mocks.

### Existing Test Regression Checklist

Tests that WILL need updating after implementation:

| File | Line | Current Assertion | Required Change |
|------|------|-------------------|-----------------|
| `src/analyzer/index.test.ts` | 180 | `["COHESIVE", "MODERATE", "JUNK_DRAWER"].includes(v)` | Add `"LEAF"` to allowed verdicts |

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `LEAF` verdict breaks downstream consumers | LOW | LOW | Additive-only change to union type; JSON consumers handle unknown strings |
| Path normalization strips too aggressively | MED | MED | Strip only known prefixes (`src/`, `lib/`, `app/`), one pass, test edge cases |
| Type hub / entry point detection false positives (suppresses real issues) | MED | LOW | Use filename patterns, not content analysis; keep whitelist small and explicit. Accept false-negative risk — tension score still visible for manual inspection |
| Dual verdict location: MCP handler overwrites analyzer LEAF verdict | HIGH | HIGH | **Must** update both `analyzer/index.ts:327` AND `mcp/index.ts:338`. Spec now explicitly calls this out. AC-9 tests this. |
| Test file counting: modules with only test files get wrong verdict | LOW | LOW | Test files excluded from count; if module has 0 non-test files, it shouldn't exist in practice (parser doesn't create empty modules) |
| Churn fix reveals parser path mismatch bugs | LOW | MED | Scope item 5 deferred to follow-up issue |
| Windows `path.sep` in `getModule`: modules stored with backslashes on Windows, graph lookup fails | MED | MED | Out of scope for this issue but noted — `getModule` uses `path.sep` which produces `\` on Windows. Path normalization in MCP layer handles input but not stored module paths |
| Monorepo paths (`packages/foo/src/bar.ts`): stripping `src/` produces `bar.ts`, not `packages/foo/bar.ts` | MED | LOW | Prefix stripping only removes leading prefixes. Graph keys in monorepo context would be `packages/foo/src/bar.ts` and `src/` wouldn't be leading. Safe for common patterns. |

**Kill criteria:** If cohesion/verdict changes cause >5 existing tests to fail, re-evaluate approach.

## State Machine

N/A — stateless feature. All changes are pure computation adjustments in the analysis pipeline.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| Single-file modules should never be `JUNK_DRAWER` | Cohesion formula: `0 internal / 0 total = 1` but code defaults to `1` only when `totalDeps === 0` (line 293). When a single file has outgoing deps, `internalDeps=0` -> cohesion=0 -> `JUNK_DRAWER`. 7/12 modules are single-file. | A single-file module with many outgoing deps could genuinely be a junk drawer (grab-bag imports) | RISKY — use `LEAF` only when `files === 1`, not when `cohesion > threshold`. A single file with scattered deps is still a valid concern, but the label should be different |
| `types/index.ts` should never get split recommendations | Project convention: type hubs are design-intentional, mentioned in CLAUDE.md | Other projects may have accidental type hubs that should be split | VALID — detect by filename pattern, not content. Applies to this tool's own analysis |
| Churn always returns 0 | Issue says so | Parser has working `getGitChurn` at line 439 using `git log --all --name-only`. Code looks correct. Could be path mismatch (git outputs repo-root-relative, `relativePath` may differ) or running outside git repo | RISKY — needs investigation. May already work in most cases |
| `LEAF` label is correct for single-file modules | It conveys "this is a terminal node, not a problem" — clear semantic. No action needed by consumer. | Could be confused with "leaf node" in graph theory (a node with no outgoing edges). A single-file module with deps is not a leaf node. | MINOR — naming is adequate. `SINGLE_FILE` would be more precise but less evocative. `LEAF` is acceptable. |
| EC2 originally said single-file module with outgoing deps should NOT get LEAF | This was based on the idea that scattered deps indicate a junk drawer | Cohesion is fundamentally meaningless for 1-file modules — there's no "internal" to cohere with. A single file importing 10 modules is high coupling, not low cohesion. The right metric is fan-out, not cohesion verdict. | CHANGED — single-file modules should ALWAYS get `LEAF` regardless of deps. Cohesion math is degenerate. High coupling is surfaced by `find_hotspots(metric='coupling')` instead. |
| Tension suppression won't hide real issues | Most type hub files are design-intentional | A `types.ts` with business logic mixed in IS a real issue that should be flagged. Suppression based on filename alone creates a blind spot. | ACCEPTED — tension score still visible. Only the recommendation text changes. Low risk for a v1 heuristic. |

### Blind Spots

1. **[Integration]** Path normalization in `file_context` but not in `get_dependents`, `find_hotspots`, or other tools accepting `filePath`. Users will hit the same problem in other tools.
   Why it matters: Inconsistent DX — fix in one tool sets expectation for all.
   -> defer to follow-up issue (documented in Out of Scope)

2. **[Data quality]** `LEAF` verdict may hide real problems in single-file modules that are overly coupled. A 500-line single file importing 10 modules is a concern, just not a "cohesion" concern.
   Why it matters: Users lose a signal. Consider adding a different flag for single-file high-coupling.
   -> no action for this spec. `find_hotspots(metric='coupling')` already surfaces this.

3. **[Architecture]** Dual verdict computation (analyzer + MCP handler) is a design smell. The MCP handler re-computes verdicts to support custom thresholds, creating a maintenance trap. Future verdict changes must be applied in two places.
   Why it matters: If someone adds another verdict later and misses the MCP handler, same bug. Consider making MCP handler delegate to a shared function.
   -> update spec scope item 1 to explicitly address both locations. Not refactoring the dual-location pattern in this issue.

4. **[Test gap]** No existing test for `file_context` path normalization behavior. The existing test at `mcp-tools.test.ts:54-78` uses exact graph paths. Need new test for prefix-stripping behavior.
   -> covered by AC-4 test mapping

5. **[Platform]** `getModule` uses `path.sep` which produces `\` on Windows. Graph keys would be `src\parser\` not `src/parser/`. MCP tool inputs likely use `/`. No normalization exists.
   Why it matters: Entire tool chain breaks on Windows. Not this issue's scope but a systemic risk.
   -> no action for this spec. Note in risks table.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Path prefix stripping matches unintended paths | `file_context` returns wrong file's data | `src/` could appear in non-prefix position (unlikely for standard projects) | MED | Strip only leading `src/`, `lib/`, `app/` with regex `^(src|lib|app)/` |
| Hub file detection is too broad | Legitimate tension files get suppressed | Filename pattern `types.ts` or `index.ts` could match non-hub files | MED | Only suppress recommendation text, keep tension data visible. Use narrow filename list. |
| Existing tests assert specific `JUNK_DRAWER` counts | Tests break after adding `LEAF` | Test fixtures may have single-file modules | HIGH | Identified: `analyzer/index.test.ts:180` — update to include `LEAF`. Run existing tests first. |
| MCP handler re-computes verdict and overwrites `LEAF` | AC-1 passes at analyzer level but fails at MCP tool level | MCP handler at `mcp/index.ts:338-342` has its own `CohesionVerdict` type without `LEAF` | HIGH | AC-9 explicitly tests this. Implementation must update both locations. |
| `isTestFile` not available on `GraphNode` | Cannot determine test file status in `computeForceAnalysis` | `GraphNode` does not have `isTestFile` field; only `ParsedFile` does | MED | Use filename pattern matching on `file.id` (matches parser logic). See Implementation Details section. |

### The Real Question

Confirmed — spec solves the right problem. The root cause is the cohesion formula producing mathematically correct but semantically meaningless results for degenerate cases (single-file modules, design-intentional hubs). The fix targets the interpretation layer (verdicts and recommendations), not the underlying math.

**Scope Assessment**: Items 4-5 (context-aware hints, churn fix) add scope without addressing the core issue (#9). They are tangentially related quality improvements. **Recommendation: defer both to separate issues.** The core value is in items 1-3. Shipping 1-3 first gives immediate benefit; items 4-5 can be tracked independently with proper investigation time.

### Open Items

- [improvement] Apply path normalization to `get_dependents` and other `filePath` params -> defer to follow-up issue
- [resolved] Should `LEAF` modules still appear in `moduleCohesion` output, or be filtered? -> include with `LEAF` verdict for transparency
- [deferred] No integration test for `getGitChurn` path matching -> defer with item 5
- [resolved] Should EC2 (single-file with outgoing deps) compute normally or get LEAF? -> LEAF always. Cohesion is degenerate for single files. Coupling is a separate metric.
- [resolved] Items 4-5 scope creep? -> YES. Defer to separate issues. Mark as LOW and defer OK already in spec; make deferral the default, not "implement if time allows".

## Notes

Items 4-5 (context-aware hints, churn fix) are LOW priority per issue. **Deferred to follow-up issues.** Not included in the 4h estimate.

Spec review applied: 2026-03-11

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | LEAF verdict for single-file modules (non-test count) | pending | - |
| 2 | Suppress tension recs for hubs/entry points | pending | - |
| 3 | file_context path normalization + backslash handling | pending | - |
| 4 | Context-aware hints (DEFERRED) | deferred | - |
| 5 | Churn path fix (DEFERRED) | deferred | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-11 | - | Created |
| spec-review | 2026-03-11 | - | Adversarial review applied: 7 new edge cases, 4 new ACs, dual verdict location flagged, test-file counting issue identified, items 4-5 deferred |
