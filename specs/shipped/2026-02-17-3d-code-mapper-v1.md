---
title: Codebase Intelligence V1
status: shipped
shipped: 2026-02-18
created: 2026-02-17
estimate: 10h
tier: standard
---

# Codebase Intelligence V1

## Context

Developers waste hours understanding unfamiliar codebases by reading files one-by-one. No open-source tool provides a 3D interactive graph of a TypeScript codebase at function-level granularity with both visual (browser) and programmatic (MCP) access. This npm package generates a 3D force-directed graph of files, functions, and their dependencies — served via a local web server for human exploration and an MCP server for LLM-assisted code understanding.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/parser/` | CREATE | TypeScript AST parser — extracts files, functions, imports, exports, dependencies |
| `src/graph/` | CREATE | Graph builder — transforms parsed data into nodes + edges with metrics |
| `src/analyzer/` | CREATE | Graph analysis — PageRank, betweenness centrality, coupling, cohesion, tension, escape velocity |
| `src/server/` | CREATE | Express web server — serves 3D UI + REST API for graph data |
| `src/mcp/` | CREATE | MCP server — exposes graph queries as MCP tools for LLMs |
| `src/renderer/` | CREATE | Client-side 3D visualization — 3d-force-graph + Three.js |
| `src/cli.ts` | CREATE | CLI entry point — `npx codebase-intelligence ./src` |
| `package.json` | CREATE | Package config, bin entry, dependencies |
| `tsconfig.json` | CREATE | TypeScript config |
| `vitest.config.ts` | CREATE | Test runner config |

**Files:** 10+ create | 0 modify | 0 affected
**Reuse:** None (greenfield)
**Breaking changes:** None (new package)
**New dependencies:**
- `typescript` — AST parsing (official compiler API, no alternative matches accuracy)
- `3d-force-graph` — 3D force-directed graph rendering (wraps Three.js + d3-force-3d, 1.5k GitHub stars)
- `graphology` — graph data structure + algorithms (lightweight, TypeScript, good for analysis)
- `express` — web server (ubiquitous, minimal)
- `@modelcontextprotocol/sdk` — MCP server SDK (official Anthropic SDK)
- `commander` — CLI framework (standard choice)
- `open` — open browser (cross-platform)

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer exploring an unfamiliar TypeScript codebase
GOAL: Visually understand codebase structure, find important files/functions, identify bottlenecks
PRECONDITION: Node.js installed, target codebase exists on disk

1. User runs `npx codebase-intelligence ./src` (or `npx codebase-intelligence --mcp ./src` for LLM mode)
   -> System parses all `.ts`/`.tsx` files in `./src`
   -> System extracts files, exported functions, imports, dependencies
   -> User sees terminal: "Parsed 142 files, 387 functions, 612 dependencies"

2a. [Browser mode — default] System builds graph and starts web server
   -> System calculates metrics (PageRank, betweenness, coupling, cohesion, tension, escape velocity)
   -> System starts Express server on `localhost:3333`
   -> User sees terminal: "3D map ready at http://localhost:3333"

2b. [MCP mode — `--mcp` flag] System builds graph and starts stdio MCP server
   -> System calculates same metrics
   -> MCP server starts on stdio (no HTTP, no browser)
   -> Ready for LLM connections via MCP client config

3. Browser opens with 3D force-directed graph
   -> User sees nodes (files = large spheres, functions = small spheres)
   -> User sees edges (import links, colored by type)
   -> User sees node size proportional to importance (PageRank)

4. User interacts with the graph
   -> User rotates/zooms the 3D scene
   -> User clicks a node -> sees detail panel (file path, LOC, dependencies, dependents)
   -> User searches for a file/function name -> graph highlights matching nodes
   -> User sees color legend (file type, coupling level)

5. User switches between views using view selector
   -> User selects "Dependency Flow" -> graph re-layouts as top-down DAG
   -> User selects "Hotspot" -> nodes recolor by coupling/risk metric
   -> User selects "Focus" on a node -> everything except 2-hop neighborhood fades
   -> User selects "Force Analysis" -> modules show centripetal/centrifugal forces, tension files glow

6. User connects an LLM via MCP (stdio)
   -> User adds MCP config to their AI tool:

   Claude Code (~/.claude/settings.json):
   ```json
   { "mcpServers": { "codebase-intelligence": {
       "command": "npx", "args": ["codebase-intelligence", "--mcp", "./src"]
   }}}
   ```

   Cursor / VS Code (mcp.json):
   ```json
   { "servers": { "codebase-intelligence": {
       "command": "npx", "args": ["codebase-intelligence", "--mcp", "./src"]
   }}}
   ```

   -> LLM calls `codebase_overview` -> gets compact architecture summary
   -> LLM calls `file_context("src/auth/login.ts")` -> gets exports, imports, dependents, metrics
   -> LLM calls `find_hotspots(metric: "coupling", limit: 10)` -> gets riskiest files
   -> LLM calls `analyze_forces` -> gets cohesion, tension files, extraction candidates

POSTCONDITION: User has mental model of codebase architecture, knows key files and bottlenecks

### CLI Modes

```
npx codebase-intelligence <path>          # Browser mode (default) — opens 3D visualization
npx codebase-intelligence --mcp <path>    # MCP mode — stdio server for LLM integration
npx codebase-intelligence --help          # Usage info

Options:
  --mcp              Start as MCP stdio server (no browser, no HTTP)
  --port <number>    Web server port (default: 3333, browser mode only)
  --depth <number>   Max directory depth to parse (default: unlimited)
  --filter <glob>    Filter files to include (default: **/*.ts,**/*.tsx)
```

### Error Journeys

E1. Invalid path
   Trigger: User provides non-existent directory
   1. User runs `npx codebase-intelligence ./nonexistent`
      -> System checks path exists
      -> User sees error: "Directory not found: ./nonexistent"
   Recovery: User corrects path and re-runs

E2. Empty codebase (no TS files)
   Trigger: Directory has no `.ts`/`.tsx` files
   1. User runs `npx codebase-intelligence ./assets`
      -> System finds 0 parseable files
      -> User sees error: "No TypeScript files found in ./assets"
   Recovery: User points to correct directory

E3. Parse error in file
   Trigger: File has syntax errors or unsupported constructs
   1. System encounters parse error in `broken.ts`
      -> System logs warning: "Skipped broken.ts: SyntaxError at line 42"
      -> System continues parsing remaining files
   Recovery: Graceful degradation — partial graph rendered

E4. Port conflict
   Trigger: Port 3333 already in use
   1. System detects port conflict
      -> System tries next port (3334, 3335...)
      -> User sees "3D map ready at http://localhost:3334"
   Recovery: Auto-fallback to available port

### Edge Cases

EC1. Single file codebase: renders 1 node, no edges — still useful for function-level view
EC2. Circular dependencies: handled naturally by force-directed layout (cycles visible as loops)
EC3. Very large codebase (>1000 files): warn user, suggest `--depth` or `--filter` flag
EC4. Re-exports / barrel files: follow through to actual source
EC5. Dynamic imports: skip with warning (static analysis only)
EC6. No exported functions in a file: still show file node, mark as "leaf"

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING - all must pass to ship)

**Parser + Graph:**
- [ ] AC-1: GIVEN a TypeScript project directory WHEN user runs `npx codebase-intelligence ./src` THEN system parses all `.ts`/`.tsx` files and outputs count of files, functions, and dependencies
- [ ] AC-2: GIVEN parsed codebase WHEN graph is built THEN every import relationship between files creates an edge in the graph

**Web Server + Views:**
- [ ] AC-3: GIVEN graph is built WHEN web server starts THEN browser opens to `localhost:3333` showing interactive 3D force-directed graph (Galaxy View)
- [ ] AC-4: GIVEN 3D graph is displayed WHEN user clicks a node THEN detail panel shows file path, LOC, exports, dependency count, dependent count
- [ ] AC-5: GIVEN Galaxy View is displayed WHEN user selects "Dependency Flow" THEN graph re-layouts as top-down DAG showing architectural layers
- [ ] AC-6: GIVEN any view WHEN user selects "Hotspot" THEN nodes recolor by coupling metric (green→red scale)
- [ ] AC-7: GIVEN any view WHEN user clicks a node and selects "Focus" THEN only 2-hop neighborhood is visible, rest fades to 10% opacity
- [ ] AC-8: GIVEN any view WHEN user selects "Module View" THEN files cluster by directory with aggregated cross-module edges

**Force Analysis View:**
- [ ] AC-9: GIVEN any view WHEN user selects "Force Analysis" THEN modules show centripetal (inward arrows, blue) and centrifugal (outward arrows, red) force indicators proportional to cohesion/coupling ratio
- [ ] AC-10: GIVEN Force Analysis view WHEN a file has tension score > 0.5 THEN node glows yellow and shows pull-lines to competing modules
- [ ] AC-11: GIVEN Force Analysis view WHEN a module has escape velocity > threshold THEN module border turns dashed with outward arrow indicating extraction candidate

**MCP Tools (stdio):**
- [ ] AC-12: GIVEN graph data WHEN LLM calls `codebase_overview` THEN receives structured JSON with modules, entry points, metrics, top depended files (~500 tokens)
- [ ] AC-13: GIVEN graph data WHEN LLM calls `file_context(filePath)` THEN receives exports, imports, dependents, metrics (incl. betweenness, tension) for that file
- [ ] AC-14: GIVEN graph data WHEN LLM calls `get_dependents(filePath, depth)` THEN receives direct + transitive dependents with through-paths
- [ ] AC-15: GIVEN graph data WHEN LLM calls `find_hotspots(metric, limit)` THEN receives ranked list with scores, reasons, and summary (metrics include: coupling, pagerank, fan_in, fan_out, betweenness, tension, escape_velocity)
- [ ] AC-16: GIVEN graph data WHEN LLM calls `get_module_structure(depth)` THEN receives module map with cross-module deps, circular deps, and per-module cohesion score
- [ ] AC-17: GIVEN graph data WHEN LLM calls `analyze_forces` THEN receives centrifuge analysis: cohesion per module, tension files, bridge files, extraction candidates

### Error Criteria (BLOCKING - all must pass)

- [ ] AC-E1: GIVEN non-existent directory WHEN user runs CLI THEN exit with error message "Directory not found: {path}"
- [ ] AC-E2: GIVEN directory with no TS files WHEN user runs CLI THEN exit with error message "No TypeScript files found in {path}"
- [ ] AC-E3: GIVEN file with syntax errors WHEN parser encounters it THEN skip file with warning and continue parsing
- [ ] AC-E4: GIVEN invalid filePath WHEN LLM calls any MCP tool with filePath THEN returns error JSON `{ error: "File not found in graph: {path}" }`

### Should Have (ship without, fix soon)

- [ ] AC-18: GIVEN 3D graph WHEN user types in search box THEN matching nodes highlight and camera focuses on them
- [ ] AC-19: GIVEN graph data WHEN MCP server is running THEN LLM can call `find_path(from, to)` to trace dependency chain between two files
- [ ] AC-20: GIVEN large codebase (>500 files) WHEN graph renders THEN frame rate stays above 20fps with LOD optimization

## Scope

**Parser + Graph Engine:**
- [ ] 1. TypeScript parser: extract files, functions, imports/exports using TS compiler API -> AC-1, AC-E3
- [ ] 2. Graph builder: create nodes (file + function) and edges (import/export relationships) with metrics -> AC-2
- [ ] 3. Graph analyzer — core metrics: PageRank, betweenness centrality, coupling, fan-in/fan-out, circular dep detection -> AC-15, AC-16
- [ ] 4. Graph analyzer — centrifuge forces: cohesion score per module, tension score per file, escape velocity per module/file -> AC-9, AC-10, AC-11, AC-17

**Human Views (browser):**
- [ ] 5. Web server: Express server serving 3D UI + graph data REST API -> AC-3
- [ ] 6. Galaxy View: 3D force-directed graph with node click detail panel (default view) -> AC-3, AC-4
- [ ] 7. Dependency Flow View: DAG layout showing architectural layers + circular dep highlighting -> AC-5
- [ ] 8. Hotspot View: recolor nodes by coupling/health metric (green→red) -> AC-6
- [ ] 9. Focus View: click node to show 2-hop neighborhood, fade rest -> AC-7
- [ ] 10. Module View: cluster by directory, show aggregated cross-module edges -> AC-8
- [ ] 11. Force Analysis View: centripetal/centrifugal force indicators, tension files glowing, extraction candidates with dashed borders -> AC-9, AC-10, AC-11

**MCP Tools (stdio):**
- [ ] 12. `codebase_overview` tool: structured codebase summary -> AC-12
- [ ] 13. `file_context` tool: file exports, imports, dependents, metrics (incl. betweenness, tension) -> AC-13
- [ ] 14. `get_dependents` tool: blast radius with transitive paths -> AC-14
- [ ] 15. `find_hotspots` tool: ranked hotspots by any metric (coupling, pagerank, betweenness, tension, escape_velocity) -> AC-15
- [ ] 16. `get_module_structure` tool: module map with cross-deps + cohesion scores -> AC-16
- [ ] 17. `analyze_forces` tool: centrifuge analysis — cohesion, tension files, bridges, extraction candidates -> AC-17

**Infrastructure:**
- [ ] 18. CLI entry point: parse args, orchestrate parse -> build -> serve pipeline -> AC-1, AC-E1, AC-E2
- [ ] 19. Error handling: graceful degradation for parse errors, port conflicts, invalid MCP inputs -> AC-E1, AC-E2, AC-E3, AC-E4

### Out of Scope

- Multi-language support (JavaScript CommonJS, Python, Go, etc.) — V2
- Function-call tracing (only import/export relationships in V1) — V2
- Real-time file watching / hot reload — V2
- Export to image/video/JSON — V2
- CI integration / diff mode — V2
- Custom themes / layout algorithms — V2
- Authentication on web server — not needed (localhost only)
- Search functionality (AC-18 is Should Have) — can ship without
- `find_path` MCP tool (AC-19 is Should Have) — can ship without

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing tests
- [ ] Error states handled (not just happy path)
- [ ] No hardcoded secrets or credentials
- [ ] Parser handles real-world TS patterns (re-exports, type-only imports, default exports)
- [ ] 3D rendering works in Chrome, Firefox, Safari (WebGL required)
- [ ] MCP server follows MCP protocol specification correctly
- [ ] Package publishes to npm without errors (`npm pack` test)

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] Code follows consistent project patterns
- [ ] CLI has `--help` with usage examples
- [ ] README with install, usage, MCP setup instructions

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| TS compiler API is slow on large codebases (>1000 files) | HIGH | MEDIUM | Stream parsing, show progress bar, support `--filter` glob |
| 3D rendering chokes on large graphs (>5000 nodes) | HIGH | MEDIUM | LOD: cluster files by directory at high zoom, expand on zoom-in |
| MCP SDK has breaking changes or is poorly documented | MEDIUM | LOW | Pin SDK version, wrap in adapter layer |
| Force-directed layout produces tangled mess for large graphs | MEDIUM | HIGH | Cluster by directory, use DAG mode for hierarchical layout |
| Re-exports / barrel files create misleading graph | MEDIUM | MEDIUM | Follow import chains to actual source file |
| npm package size too large (Three.js is big) | LOW | MEDIUM | Three.js is client-side only, tree-shake unused modules |

**Kill criteria:** If TypeScript compiler API cannot parse real-world codebases (Next.js, Express apps) with >80% accuracy within 30s, switch to tree-sitter. If 3d-force-graph cannot render 500+ nodes at >15fps, pivot to 2D with optional 3D mode.

## State Machine

**Status**: N/A - Stateless feature

**Rationale**: CLI is a one-shot pipeline: parse -> build -> serve. No persistent state transitions. The web server is stateless (serves pre-built graph data). MCP server is stateless (queries against in-memory graph).

```
┌─────────┐   parse    ┌──────────┐   build    ┌──────────┐   serve    ┌─────────┐
│  CLI    │───────────>│  Parser  │───────────>│  Graph   │───────────>│  Server │
│  (args) │            │  (AST)   │            │  (nodes  │            │  (HTTP  │
│         │            │          │            │  +edges) │            │  +MCP)  │
└─────────┘            └──────────┘            └──────────┘            └─────────┘
                            │                                              │
                       [parse error]                                  [port conflict]
                            │                                              │
                       skip + warn                                  try next port
```

## MCP Tools (Top 5 — LLM Output)

Designed for compact, structured output. Each tool returns JSON that fits in ~500-1000 tokens.

### 1. `codebase_overview` — "What is this codebase?"

The entry point. LLM calls this first to orient itself.

```
Input: none (or { depth: 1 })
Output: {
  name: "my-app",
  rootDir: "./src",
  totalFiles: 142,
  totalFunctions: 387,
  totalDependencies: 612,
  modules: [
    { path: "src/auth/", files: 12, loc: 1840, avgCoupling: 0.7 },
    { path: "src/api/",  files: 23, loc: 3200, avgCoupling: 0.4 },
    ...
  ],
  entryPoints: ["src/index.ts", "src/server.ts"],
  topDependedFiles: ["src/utils/helpers.ts (47 dependents)", ...],
  metrics: { avgLOC: 89, maxDepth: 7, circularDeps: 3 }
}
```

**Why this matters for LLMs:** Gives immediate context without reading any files. LLM knows what modules exist, what's big, what's central.

### 2. `file_context` — "Tell me everything about this file"

The "spotlight" tool. LLM calls this when reasoning about a specific file.

```
Input: { filePath: "src/auth/login.ts" }
Output: {
  path: "src/auth/login.ts",
  loc: 142,
  exports: [
    { name: "loginUser", type: "function", loc: 45 },
    { name: "LoginParams", type: "type", loc: 8 }
  ],
  imports: [
    { from: "src/db/users.ts", symbols: ["findUser", "User"] },
    { from: "src/auth/hash.ts", symbols: ["verifyPassword"] }
  ],
  dependents: [
    { path: "src/api/auth-routes.ts", symbols: ["loginUser"] },
    { path: "src/auth/index.ts", symbols: ["loginUser", "LoginParams"] }
  ],
  metrics: {
    pageRank: 0.034,
    betweenness: 0.12,
    fanIn: 2,
    fanOut: 4,
    coupling: 0.6,
    tension: 0.0,
    isBridge: false
  }
}
```

**Why this matters for LLMs:** Everything needed to understand one file's role in the system. No need to read the actual file for structural understanding.

### 3. `get_dependents` — "What breaks if I change this?"

The "blast radius" tool. Critical for safe refactoring.

```
Input: { filePath: "src/utils/helpers.ts", depth: 2 }
Output: {
  file: "src/utils/helpers.ts",
  directDependents: [
    { path: "src/api/users.ts", symbols: ["formatDate"] },
    { path: "src/api/orders.ts", symbols: ["formatDate", "slugify"] },
    ...
  ],
  transitiveDependents: [
    { path: "src/pages/dashboard.tsx", throughPath: ["src/api/users.ts"], depth: 2 },
    ...
  ],
  totalAffected: 23,
  riskLevel: "HIGH"
}
```

**Why this matters for LLMs:** Before suggesting a change, LLM knows exactly what it would break. Enables confident refactoring suggestions.

### 4. `find_hotspots` — "Where are the problems?"

The "health check" tool. No input needed — returns top issues.

```
Input: { metric: "coupling" | "pagerank" | "fan_in" | "fan_out" | "betweenness" | "tension" | "escape_velocity", limit: 10 }
Output: {
  metric: "coupling",
  hotspots: [
    { path: "src/utils/helpers.ts", score: 0.94, reason: "47 dependents, 3 circular deps" },
    { path: "src/db/connection.ts", score: 0.87, reason: "used by every module" },
    { path: "src/api/middleware.ts", score: 0.82, reason: "fan-out: 12 imports" },
    ...
  ],
  summary: "3 files have coupling > 0.8. Consider splitting src/utils/helpers.ts."
}
```

**Why this matters for LLMs:** Instantly identifies where to focus attention. The `summary` field gives actionable advice the LLM can relay to the user.

### 5. `get_module_structure` — "Show me the architecture"

The "map" tool. Shows how the codebase is organized.

```
Input: { depth: 2 }
Output: {
  modules: [
    {
      path: "src/auth/",
      files: 8, loc: 1200,
      exports: 12, internalDeps: 15, externalDeps: 6,
      cohesion: 0.71,
      escapeVelocity: 0.12,
      dependsOn: ["src/db/", "src/utils/"],
      dependedBy: ["src/api/", "src/pages/"]
    },
    ...
  ],
  crossModuleDeps: [
    { from: "src/api/", to: "src/auth/", weight: 8 },
    { from: "src/pages/", to: "src/api/", weight: 14 },
    ...
  ],
  circularDeps: [
    { cycle: ["src/auth/", "src/db/", "src/auth/"], severity: "LOW" }
  ]
}
```

**Why this matters for LLMs:** High-level architecture map. LLM understands module boundaries, coupling direction, and circular dependencies without reading any source code.

### 6. `analyze_forces` — "What wants to be together and what wants apart?"

The "centrifuge" tool. Reveals architectural forces no other tool surfaces.

```
Input: { cohesionThreshold: 0.5, tensionThreshold: 0.3, escapeThreshold: 0.7 }
Output: {
  moduleCohesion: [
    { module: "src/auth/", cohesion: 0.71, internalDeps: 15, externalDeps: 6, verdict: "COHESIVE" },
    { module: "src/utils/", cohesion: 0.23, internalDeps: 3, externalDeps: 28, verdict: "JUNK_DRAWER" },
    ...
  ],
  tensionFiles: [
    {
      file: "src/shared/adapter.ts",
      tension: 0.82,
      pulledBy: [
        { module: "src/auth/", strength: 0.45, symbols: ["validateToken"] },
        { module: "src/billing/", strength: 0.40, symbols: ["chargeUser"] }
      ],
      recommendation: "Split into auth-adapter.ts and billing-adapter.ts"
    },
    ...
  ],
  bridgeFiles: [
    {
      file: "src/api/middleware.ts",
      betweenness: 0.67,
      connects: ["src/auth/", "src/db/", "src/logging/"],
      role: "Bridge between 3 otherwise-disconnected modules"
    },
    ...
  ],
  extractionCandidates: [
    {
      target: "src/logger/",
      escapeVelocity: 0.89,
      internalDeps: 1, externalDeps: 0,
      dependedByModules: 6,
      recommendation: "Extract to standalone @org/logger package — 0 deps on host codebase"
    },
    ...
  ],
  summary: "2 junk-drawer modules (utils, shared). 3 tension files need splitting. logger/ ready for extraction."
}
```

**Why this matters for LLMs:** No other tool provides this. LLM can tell a developer: "your utils/ is a junk drawer — split it" or "logger/ has zero internal deps — extract it as a package." Actionable architectural advice, not just visualization.

### Metric Definitions

| Metric | Formula | Range | What It Reveals |
|--------|---------|-------|-----------------|
| **PageRank** | Recursive link importance (damping=0.85) | 0→1 | "What's important?" — most-referenced files |
| **Betweenness** | Fraction of shortest paths through node | 0→1 | "What bridges clusters?" — remove it and clusters disconnect |
| **Coupling** | externalDeps / (internalDeps + externalDeps) per file | 0→1 | "How tangled?" — 1 = all deps are external |
| **Cohesion** | internalDeps / (internalDeps + externalDeps) per module | 0→1 | "Does this module belong together?" — 1 = fully internal |
| **Tension** | evenness of pull from 2+ modules (entropy-based) | 0→1 | "Is this file torn between modules?" — 1 = equally pulled by 2+ |
| **Escape Velocity** | (externalDependedBy) / totalDeps, low internalDeps | 0→1 | "Should this be its own package?" — 1 = everyone uses it, it uses nothing |

## Human Views (Top 6 — Browser Visualization)

All views share the same graph data. Switching views changes layout algorithm + visual encoding.

### 1. Galaxy View (Default) — "What's the shape of this codebase?"

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         ○ ○                                     │
│        ○ ● ○      ← auth cluster                │
│         ○ ○           (red)                     │
│           \                                     │
│            \                                    │
│     ○ ○ ○───●───○ ○ ○  ← api cluster (blue)    │
│      utils /    \ pages                         │
│       (green)    (purple)                       │
│                                                 │
│  ● = high PageRank (large)                      │
│  ○ = normal file (small)                        │
│  ─ = import edge                                │
└─────────────────────────────────────────────────┘
```

- **Layout:** 3D force-directed (default)
- **Node color:** directory/module membership
- **Node size:** PageRank (importance)
- **Edge:** import relationship (opacity = weight)
- **Use case:** First impression. "What does this codebase look like?"

### 2. Dependency Flow — "What's the architecture layering?"

```
┌─────────────────────────────────────────────────┐
│  ENTRY POINTS (top)                             │
│  ┌──────┐  ┌──────────┐                        │
│  │index │  │ server   │                         │
│  └──┬───┘  └────┬─────┘                        │
│     │           │                               │
│  ┌──▼───────────▼──┐                            │
│  │   API ROUTES    │  ← middleware layer         │
│  └──┬──────┬───┬───┘                            │
│     │      │   │                                │
│  ┌──▼──┐ ┌─▼─┐ ┌▼────┐                         │
│  │auth │ │db │ │utils│  ← core modules          │
│  └─────┘ └───┘ └─────┘                          │
│                                                 │
│  ↓ = dependency direction (top depends on bot)  │
│  ↑ back-edge = circular dependency (RED)        │
└─────────────────────────────────────────────────┘
```

- **Layout:** DAG (directed, top-to-bottom)
- **Node position:** vertical = dependency depth
- **Back-edges:** highlighted in red (circular deps)
- **Use case:** "Show me the layers. Where are the cycles?"

### 3. Hotspot View — "Where are the problems?"

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         ○ ○                                     │
│        ○ ◉ ○     ← RED = high coupling          │
│         ○ ○                                     │
│           \                                     │
│            \                                    │
│     ○ ○ ○───◉───○ ○ ○  ← ORANGE = many deps    │
│            /                                    │
│       ◉                  ← RED = bottleneck     │
│                                                 │
│  Color scale: GREEN (healthy) → ORANGE → RED    │
│  Size: LOC (lines of code)                      │
│  Pulsing: circular dependency participant        │
└─────────────────────────────────────────────────┘
```

- **Layout:** same as Galaxy (force-directed)
- **Node color:** health metric (green=low coupling → red=high coupling)
- **Node size:** LOC
- **Animation:** pulsing nodes = circular dependency participants
- **Use case:** "Where should I worry? What needs refactoring?"

### 4. Focus View — "What connects to this file?"

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  (everything else faded to 10% opacity)         │
│                                                 │
│     ○ login.ts                                  │
│      ↗                                          │
│  ○ auth-routes.ts  →  ● SELECTED FILE  → ○ db  │
│      ↘                  (login.ts)        ○ hash│
│     ○ index.ts                                  │
│                                                 │
│  LEFT = dependents (who imports me)             │
│  RIGHT = dependencies (what I import)           │
│  Click another node to shift focus              │
└─────────────────────────────────────────────────┘
```

- **Layout:** radial from selected node
- **Visible nodes:** selected + 1-2 hop neighborhood
- **Everything else:** faded (10% opacity)
- **Navigation:** click another node to shift focus
- **Use case:** "I'm looking at this file. What's connected?"

### 5. Module View — "How are directories organized?"

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌─────────────────┐   ┌──────────────────┐    │
│  │   src/auth/      │───│   src/api/        │    │
│  │  ○ ○ ● ○        │   │  ○ ○ ○ ● ○ ○     │    │
│  │  8 files, 1.2k   │   │  23 files, 3.2k   │    │
│  └────────┬────────┘   └────────┬─────────┘    │
│           │                     │               │
│  ┌────────▼────────┐   ┌───────▼──────────┐    │
│  │   src/db/        │   │   src/utils/      │    │
│  │  ○ ○ ○           │   │  ○ ● ○ ○          │    │
│  │  5 files, 800    │   │  10 files, 1.5k   │    │
│  └─────────────────┘   └──────────────────┘    │
│                                                 │
│  Boxes = directories (size = total LOC)         │
│  Lines between boxes = cross-module imports     │
│  Line thickness = number of cross-module deps   │
└─────────────────────────────────────────────────┘
```

- **Layout:** grouped clusters (directory = boundary)
- **Cluster size:** proportional to total LOC
- **Cross-cluster edges:** aggregated, thickness = dependency count
- **Click cluster:** expands to show individual files
- **Use case:** "How is this codebase organized? What talks to what?"

### 6. Force Analysis View — "What wants to be together? What wants apart?"

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌─────────────────┐            ┌──────────────────┐       │
│  │   src/auth/      │            │   src/billing/    │       │
│  │  ←← ○ ○ ● ○ ←←  │            │  ←← ○ ○ ○ ←←     │       │
│  │  COHESIVE (0.71)  │            │  COHESIVE (0.65)  │       │
│  │  (blue inward     │            │  (blue inward     │       │
│  │   arrows)         │            │   arrows)         │       │
│  └────────┬──────────┘            └──────┬───────────┘       │
│           │        ╔══════════╗          │                   │
│           └────────║ adapter  ║──────────┘                   │
│                    ║  ★ 0.82  ║                              │
│                    ║ TENSION  ║  ← glowing yellow            │
│                    ╚══════════╝    pull-lines to both         │
│                                    modules                   │
│  ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐         ┌──────────────────┐         │
│  ╎   src/utils/      ╎         │   src/logger/     │→→→→     │
│  ╎  →→ ○ ○ ○ →→     ╎         │  ○ ○              │→→→→     │
│  ╎  JUNK DRAWER      ╎         │  ESCAPE (0.89)    │→→→→     │
│  ╎  (red outward     ╎         │  (dashed border,  │         │
│  ╎   arrows, 0.23)   ╎         │   outward arrows) │         │
│  └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘         └──────────────────┘         │
│                                                             │
│  LEGEND:                                                    │
│  ←← blue  = centripetal (cohesive, belongs together)        │
│  →→ red   = centrifugal (wants to split apart)              │
│  ★ yellow = tension file (torn between modules)             │
│  ╌╌ dashed = junk drawer (low cohesion)                     │
│  →→→→     = escape candidate (extract to package)           │
└─────────────────────────────────────────────────────────────┘
```

- **Layout:** Module View base (clusters by directory)
- **Module borders:** solid blue = cohesive | dashed red = junk drawer (cohesion < 0.4)
- **Force arrows:** blue inward = centripetal | red outward = centrifugal (proportional to score)
- **Tension files:** glowing yellow with pull-lines to competing modules
- **Escape candidates:** dashed border with outward arrows, bold label "EXTRACT?"
- **Bridge files:** diamond shape instead of circle, tooltip shows which clusters they connect
- **Use case:** "What architectural refactoring should I do? What's misplaced?"

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| TS compiler API is the best parser choice | Official, 100% accuracy on valid TS, handles all syntax | Slower than tree-sitter/babel, requires `typescript` as dep (~15MB) | VALID — accuracy > speed for V1 |
| 3d-force-graph is production-ready for this use case | 1.5k GitHub stars, wraps Three.js + d3-force-3d, handles interactive 3D graphs | Limited customization, may not handle >5k nodes well | RISKY — need performance testing early |
| Developers will install an npm package for visualization | Madge has 497k weekly downloads, dependency-cruiser 331k | Most devs use VS Code extensions or web tools, not CLIs | VALID — CLI + npx is the standard for dev tools |
| MCP integration adds significant value | LLMs need structured codebase data, MCP is the emerging standard | MCP adoption is still early, not all LLM tools support it | RISKY — value is real but audience is limited today |
| Function-level granularity is needed in V1 | User explicitly requested "every link between functions" | File-level may be sufficient for V1 MVP, function-level adds complexity | VALID — user requirement, but scope risk |

### Blind Spots

1. **[Integration]** How does the MCP server coordinate with the web server? Same process or separate? If same Express server, MCP protocol needs stdio or SSE transport — not HTTP REST.
   Why it matters: Wrong transport choice = MCP doesn't work with Claude Code or other clients

2. **[UX]** No mention of how to stop the server. Ctrl+C? Graceful shutdown? What happens to the browser tab?
   Why it matters: Poor DX if server doesn't clean up properly

3. **[Performance]** Function-level parsing could explode node count. A 200-file codebase could have 2000+ functions = 2200+ nodes + edges. Need aggressive clustering.
   Why it matters: Graph becomes unreadable and slow without LOD

4. **[Packaging]** Three.js + 3d-force-graph are large client-side bundles. How are they served? Bundled into the npm package? CDN? Built at install time?
   Why it matters: npm package size and install experience

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Codebase has >500 files with >2000 functions | 3D graph is unreadable spaghetti | Force-directed layout doesn't scale without clustering | HIGH | Default to file-level view, expand to function-level on click |
| MCP server uses wrong transport | Claude Code / Cursor can't connect | MCP requires stdio transport for local tools, not HTTP | HIGH | Use stdio transport via @modelcontextprotocol/sdk, test with Claude Code |
| User expects "any codebase" but only TS works | Negative first impression, abandoned | Package name suggests universality | MEDIUM | Clear README: "TypeScript/JavaScript V1, more languages planned" |

### The Real Question

Is this primarily a **visualization tool** (humans look at pretty 3D graphs) or an **analysis tool** (LLMs/humans query graph data for insights)?

**Recommendation:** Both — but weight analysis higher. The 3D visualization gets attention (demos well, shareable), but the MCP integration + bottleneck detection delivers daily value. Build the graph/analysis engine solid, treat the 3D renderer as one of multiple output modes.

### Open Items

- [question] MCP transport: stdio (for Claude Code CLI) or SSE (for web-based clients)? -> resolved: stdio for V1
- [gap] No CI/CD or release automation in scope -> no action (V2)
- [improvement] Consider `--json` flag to export graph data without server -> no action (V2)
- [risk] Function-level view may overwhelm users -> resolved: file-level default, expand to function-level on click
- [gap] No tests for parser accuracy against real-world codebases -> update spec (add integration test with fixture project)

## Notes

### Ship Retro (2026-02-18)
**Estimate vs Actual:** 10h -> ~2h (500% faster)
**What worked:** Greenfield build with clear spec — 19/19 scope items shipped in one iteration. Force analysis view and MCP tools were the differentiators. 75-test suite caught edge cases early.
**What didn't:** Nothing major. Config panel + dev mode were unplanned additions (post-V1 polish).
**Next time:** Include DX tooling (tsx watch, auto-reload) in initial scope — it accelerates iteration significantly.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | TypeScript parser | done | 1 |
| 2 | Graph builder | done | 1 |
| 3 | Graph analyzer — core metrics | done | 1 |
| 4 | Graph analyzer — centrifuge forces | done | 1 |
| 5 | Web server | done | 1 |
| 6 | Galaxy View (default) | done | 1 |
| 7 | Dependency Flow View | done | 1 |
| 8 | Hotspot View | done | 1 |
| 9 | Focus View | done | 1 |
| 10 | Module View | done | 1 |
| 11 | Force Analysis View | done | 1 |
| 12 | MCP: codebase_overview | done | 1 |
| 13 | MCP: file_context | done | 1 |
| 14 | MCP: get_dependents | done | 1 |
| 15 | MCP: find_hotspots | done | 1 |
| 16 | MCP: get_module_structure | done | 1 |
| 17 | MCP: analyze_forces | done | 1 |
| 18 | CLI entry point | done | 1 |
| 19 | Error handling | done | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-02-17T15:33:00Z | - | Created |
| done | 2026-02-18T18:39:00Z | ~2h | All 19 scope items, 75 tests, config panel + DX extras |
