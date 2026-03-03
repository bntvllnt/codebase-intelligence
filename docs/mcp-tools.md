# MCP Tools Reference

15 tools available via MCP stdio.

## 1. codebase_overview

High-level summary of the entire codebase.

**Input:** `{ depth?: number }`
**Returns:** totalFiles, totalFunctions, totalDependencies, modules (sorted by size), topDependedFiles (top 5 by fanIn), globalMetrics (avgLOC, maxDepth, circularDepCount)

**Use when:** First exploring a codebase. "What does this project look like?"
**Not for:** Module details (use get_module_structure) or data flow (use analyze_forces).

## 2. file_context

Detailed context for a single file.

**Input:** `{ filePath: string }` (relative path)
**Returns:** path, loc, exports, imports (with symbols, isTypeOnly, weight), dependents (with symbols, isTypeOnly, weight), metrics (all FileMetrics including churn, complexity, blastRadius, deadExports, hasTests, testFile)

**Use when:** Before modifying a file, understand its role, connections, and risk profile.
**Not for:** Symbol-level detail (use symbol_context).

## 3. get_dependents

File-level blast radius analysis — what breaks if this file changes.

**Input:** `{ filePath: string, depth?: number }` (default depth: 2)
**Returns:** directDependents (with symbols), transitiveDependents (with path through), totalAffected, riskLevel (LOW/MEDIUM/HIGH)

**Use when:** "What breaks if I change this file?" Before refactoring an export.
**Not for:** Symbol-level impact (use impact_analysis).

## 4. find_hotspots

Rank files by any metric.

**Input:** `{ metric: string, limit?: number }` (default limit: 10)
**Metrics:** coupling, pagerank, fan_in, fan_out, betweenness, tension, escape_velocity, churn, complexity, blast_radius, coverage
**Returns:** ranked files with score + reason, summary

**Use when:** "What are the riskiest files?" "Which files need tests?" "Most complex files?"
**Not for:** Module-level analysis (use get_module_structure).

## 5. get_module_structure

Module-level architecture with cross-module dependencies.

**Input:** `{ depth?: number }`
**Returns:** modules (with all ModuleMetrics), crossModuleDeps (from→to with weight), circularDeps (with severity)

**Use when:** Understanding module boundaries, finding tightly coupled modules, identifying circular module dependencies.
**Not for:** Emergent clusters (use get_clusters) or file-level metrics (use find_hotspots).

## 6. analyze_forces

Architectural force analysis — module health, misplaced files, bridge files.

**Input:** `{ cohesionThreshold?: number, tensionThreshold?: number, escapeThreshold?: number }`
**Returns:** moduleCohesion (with verdicts), tensionFiles (with pull details + recommendations), bridgeFiles (with connections), extractionCandidates (with recommendations), summary

**Use when:** "What's architecturally wrong?" "Which modules are coupled?" "What files should be moved?"
**Not for:** File-level metrics (use find_hotspots).

## 7. find_dead_exports

Find unused exports across the codebase.

**Input:** `{ module?: string, limit?: number }` (default limit: 20)
**Returns:** totalDeadExports, files (with path, module, deadExports[], totalExports), summary

**Use when:** Cleaning up dead code, reducing API surface.
**Not for:** Finding used exports (use file_context).

## 8. get_groups

Top-level directory groups with aggregate metrics.

**Input:** `{}`
**Returns:** groups (rank, name, files, loc, importance%, coupling)

**Use when:** "What are the main areas of this codebase?" High-level grouping overview.
**Not for:** Detailed module metrics (use get_module_structure).

## 9. symbol_context

Callers, callees, and importance metrics for a function, class, or method.

**Input:** `{ name: string }` (e.g., 'AuthService', 'getUserById')
**Returns:** name, file, type, loc, isDefault, complexity, fanIn, fanOut, pageRank, betweenness, callers (with confidence), callees (with confidence)

**Use when:** "Who calls X?" "Trace this function." "What depends on this symbol?"
**Not for:** Text search (use search) or file-level dependencies (use get_dependents).

## 10. search

Search files and symbols by keyword.

**Input:** `{ query: string, limit?: number }` (default limit: 20)
**Returns:** ranked results grouped by file with symbol names, types, LOC, and relevance scores. Suggests alternatives on empty results.

**Use when:** "Find files related to auth." "Where is getUserById defined?"
**Not for:** Structured call graph queries (use symbol_context).

## 11. detect_changes

Detect changed files from git diff with risk metrics.

**Input:** `{ scope?: "staged" | "unstaged" | "all" }` (default: all)
**Returns:** changedFiles, changedSymbols, affectedFiles, fileRiskMetrics (blastRadius, complexity, churn per file)

**Use when:** Starting a review, triaging changes, "what changed?"
**Not for:** Symbol-level impact (use impact_analysis).

## 12. impact_analysis

Symbol-level blast radius with depth-grouped risk labels.

**Input:** `{ symbol: string }` (e.g., 'getUserById' or 'UserService.getUserById')
**Returns:** levels[] (depth 1: WILL BREAK, depth 2: LIKELY, depth 3+: MAY NEED TESTING), totalAffected

**Use when:** "What breaks if I change getUserById?" Symbol-level impact assessment.
**Not for:** File-level dependencies (use get_dependents).

## 13. rename_symbol

Read-only reference finder for rename planning.

**Input:** `{ oldName: string, newName: string, dryRun?: boolean }` (default dryRun: true)
**Returns:** references[] (file, symbol, confidence), totalReferences. Does not modify files.

**Use when:** Planning a rename, finding all usages of a symbol.
**Not for:** Call graph analysis (use symbol_context).

## 14. get_processes

Trace execution flows from entry points through the call graph.

**Input:** `{ entryPoint?: string, limit?: number }`
**Returns:** processes[] (name, entryPoint, steps[], depth, modulesTouched), totalProcesses

**Use when:** "How does this app start?" "Trace request flow." "What are the entry points?"
**Not for:** Static file dependencies (use get_dependents).

## 15. get_clusters

Community-detected clusters of related files.

**Input:** `{ minFiles?: number }`
**Returns:** clusters[] (id, name, files, fileCount, cohesion), totalClusters

**Use when:** "What files are related?" "Find natural groupings." Discovering emergent groupings that differ from directory structure.
**Not for:** Directory-based modules (use get_module_structure).

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `detect_impact` | Guided analysis: impact of changing a symbol — chains impact_analysis + file_context |
| `generate_map` | Guided analysis: generate mental map of codebase — chains overview + modules + hotspots |

## MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Clusters | `codebase://clusters` | Community-detected file clusters |
| Processes | `codebase://processes` | Execution flow traces from entry points |
| Setup | `codebase://setup` | Onboarding guide with available tools and getting-started hints |

## Tool Selection Guide

| Question | Tool |
|----------|------|
| "What does this codebase look like?" | `codebase_overview` |
| "Tell me about file X" | `file_context` |
| "What breaks if I change file X?" | `get_dependents` |
| "What breaks if I change function X?" | `impact_analysis` |
| "What are the riskiest files?" | `find_hotspots` (coupling, churn, or blast_radius) |
| "Which files need tests?" | `find_hotspots` (coverage) |
| "What can I safely delete?" | `find_dead_exports` |
| "How are modules organized?" | `get_module_structure` |
| "What's architecturally wrong?" | `analyze_forces` |
| "Who calls this function?" | `symbol_context` |
| "Find files related to X" | `search` |
| "What changed?" | `detect_changes` |
| "Find all references to X" | `rename_symbol` |
| "How does data flow through the app?" | `get_processes` |
| "What files naturally belong together?" | `get_clusters` |
| "What are the main areas?" | `get_groups` |
