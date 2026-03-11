# Metrics Reference

All metrics are computed per-file and stored in `FileMetrics`. Module-level aggregates in `ModuleMetrics`.

## Per-File Metrics

| Metric | Type | Range | Source | Description |
|--------|------|-------|--------|-------------|
| **pageRank** | number | 0-1 | graphology-metrics | Importance in dependency graph. Higher = more central. |
| **betweenness** | number | 0-1 | graphology-metrics | How often file bridges shortest paths between others. Normalized. |
| **fanIn** | number | 0-N | graph in-degree | Count of files that import this file. |
| **fanOut** | number | 0-N | graph out-degree | Count of files this file imports. |
| **coupling** | number | 0-1 | derived | `fanOut / (max(fanIn, 1) + fanOut)`. 0=pure dependency. Leaf consumers (fan_in=0) score < 1.0. |
| **tension** | number | 0-1 | entropy | Evenness of pulls from multiple modules. >0.3 = tension. |
| **isBridge** | boolean | - | derived | `betweenness > 0.1`. Bridges separate clusters. |
| **churn** | number | 0-N | git log | Number of commits touching this file. 0 if not a git repo. |
| **cyclomaticComplexity** | number | 1-N | AST | Avg cyclomatic complexity of exported functions. Counts: if, case, catch, for, while, do, &&, \|\|, ??. |
| **blastRadius** | number | 0-N | BFS | Count of transitive dependents. If this file changes, N files are potentially affected. |
| **deadExports** | string[] | - | cross-ref | Export names not consumed by any edge in the graph. |
| **hasTests** | boolean | - | filename match | Whether a matching `.test.ts`/`.spec.ts`/`__tests__/` file exists. |
| **testFile** | string | - | filename match | Relative path to the test file, if found. |
| **isTestFile** | boolean | - | parser | Whether this file IS a test file (`.test.`/`.spec.`/`__tests__/`). Used to filter test files from coverage and coupling hotspots. |

## Module Metrics

| Metric | Type | Range | Description |
|--------|------|-------|-------------|
| **cohesion** | number | 0-1 | `internalDeps / (internalDeps + externalDeps)`. 1=fully internal. |
| **escapeVelocity** | number | 0-1 | Readiness for extraction. High = few internal deps, many external consumers. |
| **verdict** | string | COHESIVE/MODERATE/JUNK_DRAWER | Cohesion >= 0.6 = COHESIVE, >= 0.4 = MODERATE, else JUNK_DRAWER. |

## Force Analysis

| Signal | Threshold | Meaning |
|--------|-----------|---------|
| **Tension file** | tension > 0.3 | File pulled by 2+ modules with roughly equal strength. Split candidate. |
| **Bridge file** | betweenness > 0.05, connects 2+ modules | Removing it disconnects parts of the graph. Critical path. |
| **Junk drawer** | module cohesion < 0.4 | Module with mostly external deps. Needs restructuring. |
| **Extraction candidate** | escapeVelocity >= 0.5 | Module with 0 internal deps, consumed by many others. Extract to package. |

## Complexity Scoring

Cyclomatic complexity counts decision points in exported functions:

| AST Node | Count |
|----------|-------|
| `if` statement | +1 |
| `case` clause | +1 |
| `catch` clause | +1 |
| `for`/`for-in`/`for-of` | +1 |
| `while`/`do-while` | +1 |
| `&&`/`\|\|`/`??` operators | +1 |
| Ternary `? :` | +1 |

Base = 1 (the function itself). Stored per-export, averaged to file-level `cyclomaticComplexity`.

## Risk Trifecta

The most dangerous files have all three:
- **High churn** (changes often)
- **High coupling** (many dependents)
- **Low coverage** (no tests)

Use `find_hotspots` with different metrics to find these files, or visually compare Churn and Coverage views.
