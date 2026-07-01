# MCP Tools Reference

22 tools available via MCP stdio.

Operation tools return JSON text payloads. Invalid operation inputs return `isError: true` with `{ "error": "..." }` using the same descriptor validation messages as CLI bad-argument exits.

## 1. codebase_overview

High-level summary of the entire codebase.

**Input:** `{ depth?: number }`
**Returns:** totalFiles, totalFunctions, totalDependencies, modules (sorted by size), topDependedFiles (top 5 by fanIn), metrics (avgLOC, maxDepth, circularDeps), analysis (mode, callGraphPrecision, fullProgramFileLimit)

**Use when:** First exploring a codebase. "What does this project look like?"
**Not for:** Module details (use get_module_structure) or data flow (use analyze_forces).

## 2. file_context

Detailed context for a single file.

**Input:** `{ filePath: string }` (relative path)
**Returns:** path, loc, exports (with additive `typeFacts` when known), imports (with symbols, isTypeOnly, weight), dependents (with symbols, isTypeOnly, weight), metrics (all FileMetrics including churn, complexity, blastRadius, deadExports, totalExports, package-entrypoint metadata, hasTests, testFile)

**Path normalization:** Backslashes are normalized to forward slashes. The exact graph path is tried first; if not found, common prefixes (`src/`, `lib/`, `app/`) are stripped once from the leading position and retried. If the file is not found, the error includes up to 3 suggested similar paths.

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
**Returns:** moduleCohesion (with verdicts), tensionFiles (with pull details + recommendations), bridgeFiles (with connections), extractionCandidates (with recommendations), shallowModules, deepModules, seamCandidates, localityRisks, summary

**Use when:** "What's architecturally wrong?" "Which modules are coupled?" "What files should be moved?"
**Not for:** File-level metrics (use find_hotspots).

## 7. find_dead_exports

Find unused exports across the codebase.

**Input:** `{ module?: string, limit?: number }` (default limit: 20)
**Returns:** totalDeadExports, files (with path, module, deadExports[], totalExports, confidence, package-entrypoint metadata), summary

Package public entrypoints from `exports`, `main`, `types`, and `bin` are reported as low confidence because external consumers may use them.

**Use when:** Cleaning up dead code, reducing API surface.
**Not for:** Finding used exports (use file_context).

## 8. find_opportunities

Rank code quality and refactoring opportunities for AI agents.

**Input:** `{ limit?: number }` (default limit: 20)
**Returns:** totalOpportunities, opportunities[] (rank, kind, target, title, priority, score, confidence, why, evidence[], suggestedCommands[]), summary

**Use when:** "What should I improve?" "Find refactoring opportunities." "Which files need tests?"
**Not for:** Raw metric lists only (use find_hotspots or analyze_forces).

## 9. find_duplicates

Detect duplicate function families.

**Input:** `{ mode?: "strict" | "mild" | "weak", minTokens?: number, skipLocal?: boolean, trace?: string }`
**Returns:** mode, minTokens, threshold, totalCandidates, totalFamilies, families[] (id, members[], tokenCount, similarity), optional trace token evidence

**Use when:** Finding copy-paste logic, renamed clones, near-miss drift, or refactor candidates.
**Not for:** Unused code (use find_dead_exports) or module-level cohesion (use analyze_forces).

## 10. get_groups

Top-level directory groups with aggregate metrics.

**Input:** `{}`
**Returns:** groups (rank, name, files, loc, importance%, coupling)

**Use when:** "What are the main areas of this codebase?" High-level grouping overview.
**Not for:** Detailed module metrics (use get_module_structure).

## 11. symbol_context

Callers, callees, and importance metrics for a function, class, or method.

**Input:** `{ name: string }` (e.g., 'AuthService', 'getUserById')
**Returns:** name, file, type, loc, isDefault, complexity, additive `typeFacts` when known, fanIn, fanOut, pageRank, betweenness, callers (with confidence), callees (with confidence)

**Use when:** "Who calls X?" "Trace this function." "What depends on this symbol?"
**Not for:** Text search (use search) or file-level dependencies (use get_dependents).

## 12. search

Search files and symbols by keyword.

**Input:** `{ query: string, limit?: number }` (default limit: 20)
**Returns:** ranked results grouped by file with symbol names, types, LOC, relevance scores, and additive `typeFacts` when known. Type facts are indexed, so shape names can find symbols that consume or produce that shape. Suggests alternatives on empty results.

**Use when:** "Find files related to auth." "Where is getUserById defined?"
**Not for:** Structured call graph queries (use symbol_context).

## 13. detect_changes

Detect changed files from git diff with risk metrics.

**Input:** `{ scope?: "staged" | "unstaged" | "all" }` (default: all)
**Returns:** changedFiles, changedSymbols, affectedFiles, fileRiskMetrics (blastRadius, complexity, churn per file)

**Use when:** Starting a review, triaging changes, "what changed?"
**Not for:** Symbol-level impact (use impact_analysis).

## 14. impact_analysis

Symbol-level blast radius with depth-grouped risk labels.

**Input:** `{ symbol: string }` (e.g., 'getUserById' or 'UserService.getUserById')
**Returns:** levels[] (depth 1: WILL BREAK, depth 2: LIKELY, depth 3+: MAY NEED TESTING), totalAffected

**Use when:** "What breaks if I change getUserById?" Symbol-level impact assessment.
**Not for:** File-level dependencies (use get_dependents).

## 15. rename_symbol

Read-only reference finder for rename planning.

**Input:** `{ oldName: string, newName: string, dryRun?: boolean }` (default dryRun: true)
**Returns:** references[] (file, symbol, confidence), totalReferences. Does not modify files.

**Use when:** Planning a rename, finding all usages of a symbol.
**Not for:** Call graph analysis (use symbol_context).

## 16. get_processes

Trace execution flows from entry points through the call graph.

**Input:** `{ entryPoint?: string, limit?: number }`
**Returns:** processes[] (name, entryPoint, steps[], depth, modulesTouched), totalProcesses

**Use when:** "How does this app start?" "Trace request flow." "What are the entry points?"
**Not for:** Static file dependencies (use get_dependents).

## 17. get_codebase_map

Build a deterministic focused graph plus context pack.

**Input:** `{ focus?: string, scope?: string, depth?: number, format?: "json" | "markdown" | "dot" | "graphml", contextBudget?: number }`
**Returns:** overview, focus node, nodes, edges, evidence, contextPack, summary

**Use when:** Preparing an LLM task context, visualizing symbol/file neighborhoods, or exporting a structured codebase map.
**Not for:** Raw execution flow listing (use get_processes) or route convergence analysis (use analyze_highways).

## 18. get_scope_graph

File/scope/test view derived from `get_codebase_map`.

**Input:** same as `get_codebase_map`
**Returns:** overview, focus node, file/test/scope nodes, imports/tests edges, evidence, summary

**Use when:** An agent needs topology without symbol-level detail.
**Not for:** Full context selection (use get_context_pack).

## 19. get_context_pack

Token-bounded context pack derived from `get_codebase_map`.

**Input:** same as `get_codebase_map`
**Returns:** tokenBudget, tokenEstimate, rankedFiles, rankedSymbols, tests, evidenceIds, nextCommands

**Use when:** Passing compact, ranked code context to an LLM.
**Not for:** Visual graph export (use get_codebase_map).

## 20. analyze_highways

Detect repeated entry-to-sink routes that should converge on one canonical operation path.

**Input:** `{ operation?: string, shape?: string, minRoutes?: number, propose?: boolean, trace?: string }`
**Returns:** totalRoutes, totalSinks, totalOpportunities, opportunities[] (id, kind, operation, shape, sink, canonicalNode, routes[], bypassRoutes[], duplicatedCallees?, proposal?, evidence[], blastRadius, recommendation, contextPack), optional trace. With `propose: true`, no-canonical route groups can return `kind: "synthesis"` with proposed name/file/signature/skeleton/reroutePlan/cycleSafety.

**Use when:** Enforcing dataflow discipline, finding ad-hoc routes, or planning canonical shared paths.
**Not for:** Raw execution flow listing (use get_processes).

## 21. get_clusters

Community-detected clusters of related files.

**Input:** `{ minFiles?: number }`
**Returns:** clusters[] (id, name, files, fileCount, cohesion), totalClusters

**Use when:** "What files are related?" "Find natural groupings." Discovering emergent groupings that differ from directory structure.
**Not for:** Directory-based modules (use get_module_structure).

## 22. check

Run the configurable rules engine and gate on findings.

**Input:** `{}` (uses the loaded graph + discovered config)
**Returns:** `{ verdict: "pass"|"warn"|"fail", summary: { error, warn, suppressed, staleSuppressions, rules }, configPath, suppressions[], findings[] }`. Each finding has ruleId, severity, file, line, column, message, fingerprint, optional `kind`, optional `confidence`, optional `evidence[]`, and optional advisory `actions[]` (the tool is read-only — actions are hints, never applied). Each suppression records directive, status, file, line, targetLine, matched rule IDs, and suppressed count.

Rules: `no-comments` (off by default), `no-circular-deps` (error), `no-dead-exports` (warn), `no-stale-suppressions` (warn), and opt-in cleanup gates `no-dead-files`, `no-unused-types`, `no-unused-members`, `no-unused-deps`. Dependency findings are scoped to the nearest `package.json` / workspace manifest and include unused, unlisted, type-only, test-only, and runtime-from-devDependencies drift. `ci-ignore-file`, `ci-ignore-next-line`, and JSDoc `@expected-unused` suppressions are reported as active/stale; JSDoc `@public` protects exported cleanup declarations while `@internal` remains checkable. Configure severities and options in `codebase-intelligence.json` (validated by `schema.json`).

**Use when:** Linting a codebase or enforcing a CI gate. "What rule violations exist?"
**Not for:** Architecture metrics (use analyze_forces).

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
| "What should I improve first?" | `find_opportunities` |
| "Find refactoring opportunities." | `find_opportunities` |
| "Where is logic duplicated?" | `find_duplicates` |
| "What can I safely delete?" | `find_dead_exports` |
| "How are modules organized?" | `get_module_structure` |
| "What's architecturally wrong?" | `analyze_forces` |
| "Who calls this function?" | `symbol_context` |
| "Find files related to X" | `search` |
| "What changed?" | `detect_changes` |
| "Find all references to X" | `rename_symbol` |
| "How does data flow through the app?" | `get_processes` |
| "What context should I give an LLM for this task?" | `get_context_pack` |
| "Show a focused codebase graph" | `get_codebase_map` |
| "Show only file/scope topology" | `get_scope_graph` |
| "Which routes bypass canonical dataflow?" | `analyze_highways` |
| "What files naturally belong together?" | `get_clusters` |
| "What are the main areas?" | `get_groups` |
| "What rule violations exist? Lint this." | `check` |
