# Fix: Dead Export Detection False Positives

**Issue**: [#6](https://github.com/bntvllnt/codebase-intelligence/issues/6)
**Branch**: `fix/dead-export-false-positives`
**Date**: 2026-03-10
**Spec review**: Applied 2026-03-10 (7 items from 4-perspective adversarial review)

## Problem

`find_dead_exports` has ~33% false positive rate (2/6). Two bugs:

1. **Duplicate imports dropped** — second import to same target silently skipped, losing symbols
2. **Same-file calls invisible** — parser skips intra-file calls, analyzer only checks import edges

### False Positives

| Export | File | Why Not Dead |
|--------|------|-------------|
| `SearchIndex` | `search/index.ts` | `import type` in `mcp/index.ts:8` |
| `registerTools` | `mcp/index.ts` | Called at line 812 within `startMcpServer()` |

### True Positives (4)

`tokenize`, `setGraph`, `getGraph`, `detectEntryPoints`

## Semantics Change

**Old definition**: dead = "no external file imports this symbol"
**New definition**: dead = "no import edges AND no call edges reference this symbol (including same-file)"

This means exports like `tokenize` (used only within `search/index.ts`) will no longer be flagged dead. This is intentional — if an export is called anywhere, removing it requires code changes, so it's not safe to delete.

## Root Cause (Confirmed)

```
BUG 1: Duplicate edge dropped          BUG 2: Same-file calls skipped
────────────────────────────────        ──────────────────────────────
mcp/index.ts:                           mcp/index.ts:
  L7: import {A,B,C} from search  ──▶ edge created, symbols:[A,B,C]
  L8: import type {X} from search ──▶ SKIPPED (edge exists)         parser/index.ts:345
                                        X never enters consumed       declRelPath !== callerFile → skip
                                                                      same-file calls never recorded

graph/index.ts:65                       analyzer/index.ts:36-40
  if (!graph.hasEdge(src, tgt))           consumedSymbols from edges only
    → only FIRST edge per pair              → no call graph integration
```

## Implementation

### Task 1: Merge duplicate edge symbols (Graph)

**File**: `src/graph/index.ts:59-81`

When edge already exists for source→target, merge new symbols into existing edge instead of skipping. **Must update BOTH the graphology edge attributes AND the `edges[]` array atomically** — dead export detection reads `edges[]`, PageRank reads graphology.

```
Current (line 65):
  if (!graph.hasEdge(src, target)) { addEdge(...) }

Fix:
  if (!graph.hasEdge(src, target)) {
    addEdge(...)
  } else {
    // Find existing edge entry in edges[]
    const existing = edges.find(e => e.source === src && e.target === target)
    // Merge symbols (union, no duplicates)
    const merged = [...new Set([...existing.symbols, ...imp.symbols])]
    existing.symbols = merged
    existing.weight = merged.length || 1
    // isTypeOnly: false if EITHER import is value (not type-only)
    existing.isTypeOnly = existing.isTypeOnly && imp.isTypeOnly
    // Update graphology edge attributes to match
    graph.setEdgeAttribute(src, target, 'symbols', merged)
    graph.setEdgeAttribute(src, target, 'weight', merged.length || 1)
    graph.setEdgeAttribute(src, target, 'isTypeOnly', existing.isTypeOnly)
  }
```

**Merge rules:**
- `symbols`: union (deduplicated)
- `weight`: `mergedSymbols.length || 1`
- `isTypeOnly`: `existing && new` (only true if BOTH imports are type-only)

**Side effect**: PageRank scores shift slightly for files with previously-dropped duplicate imports. Weight increases → hub files get marginally higher PageRank. Acceptable — more accurate than before.

Fixes: `SearchIndex` false positive.

### Task 2: Include same-file calls in parser (Parser)

**File**: `src/parser/index.ts:345`

Remove the `declRelPath !== callerFile` guard so same-file calls are recorded in `callSites`.

```
Current (line 345):
  if (declRelPath !== callerFile && !declRelPath.startsWith("..") && ...)

Fix:
  if (!declRelPath.startsWith("..") && !path.isAbsolute(declRelPath))
```

**Side effects** (all beneficial or neutral):
- `symbol_context` — shows intra-file callers/callees (more complete)
- `impact_analysis` — blast radius includes same-file dependents (more accurate but noisier)
- `get_processes` — `detectEntryPoints` may return fewer results (internal helpers gain inbound edges, losing "entry point" status). Verify existing tests still pass.
- `callEdges` / `symbolNodes` arrays grow. Negligible perf impact for typical codebases.

### Task 3: Use call graph for dead export detection (Analyzer) — BLOCKED BY Task 2

**File**: `src/analyzer/index.ts:36-41`

After building `consumedSymbols` from import edges, also add symbols consumed via call graph edges. `callEdges` are already available in `built: BuiltGraph` (confirmed: `BuiltGraph.callEdges` at `graph/index.ts:10`).

```typescript
// After existing consumedSymbols loop (line 41):
// Also count symbols consumed via call graph (includes same-file calls from Task 2)
for (const callEdge of built.callEdges) {
  // Extract file path from callEdge.target ("file::symbol" format)
  const sepIdx = callEdge.target.indexOf("::");
  if (sepIdx === -1) continue;
  const targetFile = callEdge.target.substring(0, sepIdx);

  // Normalize: class method "AuthService.validate" → class name "AuthService"
  const rawSymbol = callEdge.calleeSymbol;
  const consumedName = rawSymbol.includes(".") ? rawSymbol.split(".")[0] : rawSymbol;

  const existing = consumedSymbols.get(targetFile) ?? new Set<string>();
  existing.add(consumedName);
  consumedSymbols.set(targetFile, existing);
}
```

**Critical: class method normalization.** `calleeSymbol` for method calls is `"ClassName.methodName"` but exports only contain `"ClassName"`. Must strip method suffix or class exports remain false positives.

Fixes: `registerTools` false positive.

### Task 4: Regression tests

**File**: `src/analyzer/index.test.ts`

Real fixture files through real pipeline (no mocks):

| Test | Fixture | Assert |
|------|---------|--------|
| Type-only import consumed | A: `import type { X } from "./b"`, B: exports `X` | `X` NOT in deadExports |
| Duplicate import merged | A: `import { Y }` + `import type { Z }` from B | both `Y`, `Z` NOT dead |
| Same-file call consumed | A: exports `foo`, `bar`; `bar` calls `foo` | `foo` NOT dead |
| Class method consumed | A: `new B().method()`, B: exports class `B` | `B` NOT dead |
| Truly dead export | A: exports `baz`, nobody imports or calls it | `baz` IS dead |
| Mixed dead/alive | File with some consumed, some dead exports | only dead ones reported |
| Edge merge sync | After merge, graphology attrs === edges[] entry | symbols, weight, isTypeOnly match |

**Fixture dir**: `tests/fixtures/dead-exports/`

### Task 5: Self-analysis verification

Run `find_dead_exports` against this repo after fix:
- Expected: `registerTools` and `SearchIndex` NOT flagged
- Expected: `setGraph`, `getGraph` still flagged (truly dead)
- `tokenize` and `detectEntryPoints` may no longer be dead (if called same-file) — correct per new semantics

## Expected True Dead Exports After Fix

| Export | File | Status |
|--------|------|--------|
| `setGraph` | `server/graph-store.ts` | DEAD (exported, never imported or called) |
| `getGraph` | `server/graph-store.ts` | DEAD (exported, never imported or called) |
| `tokenize` | `search/index.ts` | Likely NOT dead (called same-file by `createSearchIndex`) |
| `detectEntryPoints` | `process/index.ts` | Likely NOT dead (called same-file by `traceProcesses`) |

## State Machine

N/A — stateless computation fix.

## Files to Change

| File | Change | Lines |
|------|--------|-------|
| `src/graph/index.ts` | Merge duplicate edge symbols (both stores) | ~65-81 |
| `src/parser/index.ts` | Include same-file calls | ~345 |
| `src/analyzer/index.ts` | Add call graph to consumed check + class normalization | ~36-41 |
| `src/analyzer/index.test.ts` | Dead export regression tests | new |
| `tests/fixtures/dead-exports/` | Fixture .ts files | new |

## Quality Gates

- [ ] Lint (changed files)
- [ ] Typecheck (full project)
- [ ] Build
- [ ] Tests (all + new regression)
- [ ] Self-analysis: 0 false positives on known cases

## Risks

| Risk | Mitigation |
|------|-----------|
| Dual store desync (graphology vs edges[]) | Task 4 regression test asserts both match after merge |
| Class method `calleeSymbol` doesn't match export name | Task 3 normalizes: strip `.method` suffix |
| `isTypeOnly` collision on merge | Merge rule: `false` if either import is value |
| PageRank shift from weight changes | Acceptable — more accurate. Existing tests may need threshold adjustment |
| `get_processes` returns fewer entry points | Verify existing tests. Internal helpers losing entry status is correct |
| Same-file calls inflate `impact_analysis` blast radius | Accept — more accurate. Document in tool description if noisy |

## Known Gaps (Out of Scope)

These false positive categories are NOT addressed by this fix:

| Gap | Description | Tracking |
|-----|------------|---------|
| Barrel `export *` | `symbols: ['*']` never matches concrete export names | File as separate issue |
| Interface dispatch | Polymorphic calls resolve to interface, not implementation | Inherent TS limitation |
| Dynamic calls | `obj[method]()`, HOF parameters — unresolvable statically | Accept |
| Destructured requires | `const { foo } = require(...)` — not tracked | Rare in ESM codebases |

## Task Dependencies

```
Task 1 (graph merge) ──────────┐
                                ├──▶ Task 3 (analyzer) ──▶ Task 4 (tests) ──▶ Task 5 (verify)
Task 2 (parser same-file) ─────┘
         BLOCKS Task 3
```

Tasks 1 and 2 are independent. Task 3 BLOCKS on both (hard dependency). Task 4 validates all.
