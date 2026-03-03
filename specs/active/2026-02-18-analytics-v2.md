---
title: Advanced Analytics V2 + LLM Knowledge Base
status: active
created: 2026-02-18
estimate: 8h
tier: standard
---

# Advanced Analytics V2 + LLM Knowledge Base

## Context

Current metrics are static-analysis-only (PageRank, betweenness, coupling, cohesion). Missing behavioral data (git churn), quality signals (test coverage, dead exports), complexity metrics (cyclomatic), and impact analysis (blast radius). Also no docs/ folder — LLMs helping build this tool lack structured knowledge base context.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/types/index.ts` | MODIFY | Add 5 new fields to `FileMetrics`, extend `ParsedFile`, add `ParsedExport.complexity` |
| `src/parser/index.ts` | MODIFY | Add cyclomatic complexity counter (AST branch walk), test file detection, git churn extraction |
| `src/analyzer/index.ts` | MODIFY | Add `computeBlastRadius()`, `findDeadExports()`, map churn/complexity/coverage to FileMetrics |
| `src/mcp/index.ts` | MODIFY | Extend `find_hotspots` enum with new metrics, add `find_dead_exports` tool |
| `src/server/api.ts` | MODIFY | Extend `/hotspots` switch, add `blastRadius` to `/file/*` response |
| `public/index.html` | MODIFY | Add 2 new views (Churn, Coverage), extend detail panel with new metrics |
| `docs/` | CREATE | New folder: architecture, metrics, MCP tools, contributing, data model docs |
| `CLAUDE.md` | MODIFY | Add docs/ section describing KB structure |
| `src/**/*.test.ts` | MODIFY | New tests for each metric computation |

**Files:** 1 create (docs/) | 7 modify | 4 affected (test files)
**Reuse:** Existing `healthColor()` for new views, `find_hotspots` pattern for new metrics, `el()` safe DOM helper
**Breaking changes:** None — additive only. New fields default to 0.
**New dependencies:** None — git churn via `child_process.execSync`, complexity via existing TS Compiler API

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer monitoring a TypeScript codebase
GOAL: Identify highest-risk files using behavioral + structural signals
PRECONDITION: Codebase parsed and server running

1. User opens browser to 3D visualization
   → System loads graph with all metrics (including churn, coverage, complexity, blast radius)
   → User sees existing views + 2 new view tabs (Churn, Coverage)

2. User clicks "Churn" view tab
   → System renders nodes sized by churn frequency, colored by churn intensity (green=stable, red=volatile)
   → User sees which files change most often

3. User clicks "Coverage" view tab
   → System renders nodes colored by test coverage (red=untested, green=has tests)
   → User sees untested critical-path files

4. User clicks any node in any view
   → System shows detail panel with ALL metrics (including new: churn, complexity, blast radius, dead exports, test status)
   → User sees full file health profile

5. User queries MCP tool `find_hotspots` with `metric: "churn"`
   → System returns top N files by git churn count
   → LLM uses this to prioritize refactoring recommendations

6. User queries MCP tool `find_dead_exports`
   → System returns unused exports grouped by module
   → LLM uses this to suggest cleanup

POSTCONDITION: User/LLM has actionable data on file health from both structural AND behavioral perspectives

### Primary Journey B: LLM KB

ACTOR: LLM (Claude) helping build codebase-intelligence
GOAL: Understand architecture, metrics, patterns to assist development
PRECONDITION: docs/ folder exists in repo

1. LLM reads `docs/architecture.md`
   → Understands full pipeline: Parser → Graph → Analyzer → Server/MCP
   → Can make informed suggestions about where to add features

2. LLM reads `docs/metrics.md`
   → Understands every metric: definition, formula, thresholds, use cases
   → Can explain metrics to users, suggest improvements

3. LLM reads `docs/mcp-tools.md`
   → Understands all MCP tool schemas, responses, use cases
   → Can help extend or debug MCP tools

4. LLM reads `docs/data-model.md`
   → Understands all TypeScript interfaces and their relationships
   → Can add new types correctly

POSTCONDITION: LLM has structured context to assist development without reading every source file

### Error Journeys

E1. Git not available (churn metric)
   Trigger: Codebase directory is not a git repo or git not installed
   1. Parser attempts `git log` for churn
      → System catches error
      → Churn defaults to 0 for all files
   2. User sees churn view with all nodes gray (no data)
      → Legend shows "Git data unavailable"
   Recovery: Churn gracefully degrades, all other metrics work normally

E2. No test files found (coverage metric)
   Trigger: No `*.test.ts` or `*.spec.ts` files in codebase
   1. Analyzer computes coverage
      → All files marked as "untested"
   2. User sees coverage view all red
      → Detail panel shows "No test files detected"
   Recovery: Feature works but signals 0% coverage accurately

### Edge Cases

EC1. Monorepo with multiple package.json: git churn computed per-file, works across packages
EC2. File renamed (git mv): churn tracks current path only, not history across renames
EC3. Very large repo (10k+ files): git log per-file is O(n) git calls — may be slow
EC4. Circular re-exports: dead export detection must handle re-export chains

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING — all must pass to ship)

- [ ] AC-1: GIVEN a git repo WHEN parsed THEN each file has a `churn` count (commits touching it)
- [ ] AC-2: GIVEN parsed files WHEN analyzed THEN each exported function has a `cyclomaticComplexity` score (branch count)
- [ ] AC-3: GIVEN a built graph WHEN analyzed THEN each file has a `blastRadius` count (transitive dependent files)
- [ ] AC-4: GIVEN a built graph WHEN analyzed THEN unused exports are identified per file as `deadExports: string[]`
- [ ] AC-5: GIVEN parsed files WHEN analyzed THEN each file has `hasTests` boolean and `testFile` path (if found)
- [ ] AC-6: GIVEN the 3D UI WHEN user clicks "Churn" tab THEN nodes are colored/sized by git churn
- [ ] AC-7: GIVEN the 3D UI WHEN user clicks "Coverage" tab THEN nodes are colored by test coverage status
- [ ] AC-8: GIVEN MCP tool `find_hotspots` WHEN called with `metric: "churn"` THEN returns top files by churn
- [ ] AC-9: GIVEN MCP tool `find_hotspots` WHEN called with `metric: "complexity"` THEN returns top files by cyclomatic complexity
- [ ] AC-10: GIVEN MCP tool `find_dead_exports` WHEN called THEN returns unused exports grouped by module
- [ ] AC-11: GIVEN `docs/` folder WHEN LLM reads it THEN it contains architecture, metrics, data model, and MCP tools docs
- [ ] AC-12: GIVEN any file detail panel WHEN user clicks a node THEN new metrics (churn, complexity, blast radius, dead exports, test status) are displayed

### Error Criteria (BLOCKING — all must pass)

- [ ] AC-E1: GIVEN a non-git directory WHEN parsed THEN churn defaults to 0 and no crash occurs
- [ ] AC-E2: GIVEN no test files exist WHEN analyzed THEN coverage is 0% and feature degrades gracefully
- [ ] AC-E3: GIVEN a file with 0 exports WHEN analyzed THEN deadExports is empty array, no error

### Should Have (ship without, fix soon)

- [ ] AC-13: GIVEN the detail panel WHEN showing blast radius THEN clicking expands to show affected file paths
- [ ] AC-14: GIVEN docs/ WHEN architecture changes THEN docs are updated in same PR

## Scope

- [ ] 1. Types: add `churn`, `cyclomaticComplexity`, `blastRadius`, `deadExports`, `hasTests`, `testFile` to FileMetrics + ParsedFile → AC-1, AC-2, AC-3, AC-4, AC-5
- [ ] 2. Parser: add cyclomatic complexity counter (AST branch walk per export) → AC-2
- [ ] 3. Parser: add git churn extraction (`git log --oneline -- <file>` line count) → AC-1
- [ ] 4. Parser: add test file detection (match `*.test.ts` / `*.spec.ts` to source files) → AC-5
- [ ] 5. Analyzer: add `computeBlastRadius()` — BFS transitive dependent count per file → AC-3
- [ ] 6. Analyzer: add `findDeadExports()` — cross-reference exports vs edge symbols → AC-4
- [ ] 7. Analyzer: wire churn, complexity, coverage into FileMetrics → AC-1, AC-2, AC-5
- [ ] 8. MCP: extend `find_hotspots` with `churn`, `complexity`, `coverage` metrics → AC-8, AC-9
- [ ] 9. MCP: add `find_dead_exports` tool → AC-10
- [ ] 10. API: extend `/hotspots` switch for new metrics, add new fields to `/file/*` and `/graph` → AC-8, AC-12
- [ ] 11. UI: add Churn view (color by churn intensity, size by LOC) → AC-6
- [ ] 12. UI: add Coverage view (red=untested, green=tested) → AC-7
- [ ] 13. UI: extend detail panel with churn, complexity, blast radius, dead exports, test status → AC-12
- [ ] 14. Error handling: graceful degradation for non-git dirs and missing test files → AC-E1, AC-E2, AC-E3
- [ ] 15. Tests: add tests for each new metric computation (parser + analyzer) → all ACs
- [ ] 16. Create `docs/` folder with architecture.md, metrics.md, data-model.md, mcp-tools.md → AC-11
- [ ] 17. Update CLAUDE.md to reference docs/ structure → AC-11

### Out of Scope

- Istanbul/c8 instrumentation-based coverage (we pattern-match test files only)
- Git blame / ownership analysis (future V3)
- Git rename tracking for churn (current path only)
- Staleness metric (future V3)
- React/framework migration of frontend

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing 75 tests
- [ ] Error states handled (non-git, no tests, 0 exports)
- [ ] No hardcoded secrets or credentials
- [ ] git churn uses `execSync` with proper error catching (no shell injection)
- [ ] New metrics default to safe values (0, false, []) when data unavailable
- [ ] New MCP tools follow existing registration pattern (Zod schema + async handler)
- [ ] New views use safe DOM construction (`el()` helper, no innerHTML)
- [ ] docs/ are accurate to current codebase (not aspirational)

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] Code follows existing project patterns (ESM, .js imports, strict types)
- [ ] New tests cover both happy path and error paths
- [ ] docs/ cross-reference each other where relevant

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Git churn O(n) calls slow on large repos | MED | MED | Batch with `git log --name-only` single call, parse output |
| Dead export detection misses re-exports | LOW | MED | Only flag direct exports not found in any edge symbol list |
| Cyclomatic complexity too coarse (file-level vs function-level) | LOW | LOW | Store per-export, aggregate to file avg |
| Shell injection via file paths in git commands | HIGH | LOW | Use `execFileSync` (no shell), never interpolate paths |
| Docs become stale | MED | MED | CLAUDE.md rule: "update docs when behavior changes" |

**Kill criteria:** If git churn takes >30s on a 500-file repo, switch to single `git log --all --name-only` approach or drop churn to backlog.

## State Machine

**Status**: N/A — Stateless feature

**Rationale**: All new metrics are computed once during parse/analyze pipeline (no state transitions). Views are pure renders from computed data. Docs are static files.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| Git history is available for churn | Most users run on git repos | Could be a tarball or non-git VCS | VALID — graceful fallback handles it |
| Test file naming follows `*.test.ts` / `*.spec.ts` | Standard convention in TS ecosystem | Some projects use `__tests__/` dirs or custom patterns | RISKY — should also check `__tests__/` dirs |
| Dead export = export not in any edge symbol list | Graph edges track all imported symbols | Re-exports and barrel files may consume without direct edge | RISKY — barrel files may cause false positives |
| One git log per file is acceptable perf | Small repos (<200 files) are fast | 1000+ file repos = 1000+ git calls | RISKY — batch approach needed for scale |
| Cyclomatic complexity at function level is useful | Industry standard metric | Can be misleading (high CC in a switch isn't necessarily bad) | VALID — useful as one signal among many |

### Blind Spots

1. **[Performance]** Git churn extraction is O(n) subprocess calls. On 1000-file repos this could take 10-30s. Batch `git log --all --name-only --format="%H"` and count per-file from output = single git call.
   Why it matters: Parser becomes the bottleneck, bad first impression.

2. **[Data Quality]** Dead export detection won't catch exports consumed via `import * as X` or dynamic imports. These create edges without specific symbol names.
   Why it matters: False "dead" flags on actually-used exports erode trust in the tool.

3. **[Integration]** Docs folder needs a maintenance contract. Without CI validation or CLAUDE.md enforcement, docs will drift from code within weeks.
   Why it matters: Stale docs are worse than no docs for LLMs — they produce confidently wrong suggestions.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Git churn uses `execSync` per file | Parser takes >30s on large repos | O(n) process spawns are expensive | HIGH | Batch: single `git log --all --name-only`, parse output. Add in scope. |
| Dead exports flags barrel re-exports as dead | Users see false positives | `export { X } from './x'` creates edge but re-export itself isn't "consumed" | MED | Filter: skip exports that appear as re-exports in other files |
| Docs written once and never updated | LLM gets wrong context, suggests broken patterns | No enforcement mechanism | MED | CLAUDE.md rule + PR checklist item |

### The Real Question

Confirmed — spec solves the right problem. Static analysis alone misses the human dimension (what changes, what's tested, what's dead weight). These 5 metrics fill the gap between "graph structure" and "actionable intelligence". The docs KB ensures LLMs can help iterate on this tool effectively.

**One reframe:** Git churn should use batch extraction (single git call), not per-file. Updated scope item 3 to reflect this.

### Open Items

- [improvement] Batch git churn: single `git log --all --name-only` → parse output → `no action` (already in scope item 3 description)
- [risk] Barrel file false positives in dead export detection → `update spec` (added EC4)
- [gap] `__tests__/` directory convention not handled → `update spec` (add to scope item 4: also check `__tests__/` dirs)
- [question] Should docs/ be included in npm package or .npmignore'd? → `question` (ask user)

## Notes

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-02-18T19:25:00Z | - | Created |
