---
title: Next.js + Tailwind/shadcn Migration
status: active
created: 2026-02-18
estimate: 6h
tier: standard
---

# Next.js + Tailwind/shadcn Migration

## Context

Migrate codebase-intelligence from Express+vanilla HTML to Next.js App Router with Tailwind CSS and shadcn/ui. Full rewrite of the 3D rendering layer (3d-force-graph CDN → react-force-graph-3d npm), Express API routes → Next.js Route Handlers, MCP tools → Next.js API integration. Pipeline code (parser/graph/analyzer) stays untouched.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `package.json` | MODIFY | Add next, react, react-dom, tailwindcss, shadcn deps; remove express, open; add react-force-graph-3d |
| `tsconfig.json` | MODIFY | Merge with Next.js defaults (jsx: preserve, next plugin) |
| `eslint.config.js` | MODIFY | Add next/core-web-vitals, react-hooks rules |
| `app/` | CREATE | Next.js App Router: layout, page, API routes |
| `app/api/graph/route.ts` | CREATE | Replace Express GET /api/graph |
| `app/api/file/[...path]/route.ts` | CREATE | Replace Express GET /api/file/* |
| `app/api/modules/route.ts` | CREATE | Replace Express GET /api/modules |
| `app/api/hotspots/route.ts` | CREATE | Replace Express GET /api/hotspots |
| `app/api/forces/route.ts` | CREATE | Replace Express GET /api/forces |
| `app/api/meta/route.ts` | CREATE | Replace Express GET /api/meta |
| `app/api/ping/route.ts` | CREATE | Replace Express GET /api/ping |
| `app/api/mcp/route.ts` | CREATE | MCP tool invocation via HTTP |
| `components/` | CREATE | ~12 React components decomposed from index.html |
| `components/graph-canvas.tsx` | CREATE | react-force-graph-3d wrapper with imperative API |
| `components/view-tabs.tsx` | CREATE | 8 view tabs |
| `components/project-bar.tsx` | CREATE | Title + stats panel |
| `components/detail-panel.tsx` | CREATE | Right-side file detail drawer |
| `components/settings-panel.tsx` | CREATE | Config sliders (shadcn Slider, Checkbox) |
| `components/search-input.tsx` | CREATE | Graph search with camera fly |
| `components/legend.tsx` | CREATE | Per-view color legend |
| `components/debug-log.tsx` | CREATE | Collapsible debug overlay |
| `hooks/use-graph-data.ts` | CREATE | SWR/fetch hook for graph + forces + meta |
| `hooks/use-graph-config.ts` | CREATE | Graph config state (replaces cfg object) |
| `hooks/use-module-clouds.ts` | CREATE | THREE.js module cloud management |
| `lib/graph-store.ts` | CREATE | Server-side CodebaseGraph singleton for Route Handlers |
| `lib/views.ts` | CREATE | 8 view derivation functions (pure: nodes+config → colors/sizes) |
| `tailwind.config.ts` | CREATE | Tailwind config |
| `components.json` | CREATE | shadcn config |
| `app/globals.css` | CREATE | Tailwind base + custom vars |
| `src/server/index.ts` | DELETE | Express server replaced by Next.js |
| `src/server/api.ts` | DELETE | Routes moved to app/api/ |
| `src/server/api.test.ts` | MODIFY | Rewrite for Next.js Route Handler testing |
| `src/cli.ts` | MODIFY | Web mode: launch Next.js dev/start instead of Express |
| `public/index.html` | DELETE | Replaced by React components |
| `src/parser/index.ts` | UNAFFECTED | Pipeline code stays |
| `src/graph/index.ts` | UNAFFECTED | Pipeline code stays |
| `src/analyzer/index.ts` | UNAFFECTED | Pipeline code stays |
| `src/mcp/index.ts` | AFFECTED | Keep stdio mode; add HTTP adapter for Next.js API |
| `vitest.config.ts` | MODIFY | Add jsdom environment for React component tests |

**Files:** ~20 create | ~6 modify | ~3 delete | ~4 unaffected
**Reuse:** All pipeline code (parser, graph, analyzer) reused as-is. View logic from index.html translates to pure functions in `lib/views.ts`. API route logic from `api.ts` directly portable.
**Breaking changes:** CLI `--server` mode behavior changes (launches Next.js instead of Express). Package no longer works as pure Express server.
**New dependencies:** next, react, react-dom, @types/react, @types/react-dom, tailwindcss, @tailwindcss/postcss, react-force-graph-3d (React wrapper for 3d-force-graph), three (peer dep), swr (data fetching). shadcn components installed via CLI.

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Developer analyzing a TypeScript codebase
GOAL: Visualize codebase structure in an interactive 3D graph with modern UI
PRECONDITION: TypeScript project exists, codebase-intelligence installed

1. User runs `codebase-intelligence ./src`
   -> System parses codebase, builds graph, starts Next.js server
   -> User sees "Server ready at http://localhost:3333" + browser opens

2. User sees modern UI: project bar (title + stats), 8 view tabs, 3D graph canvas
   -> System renders Galaxy view by default with Tailwind-styled panels
   -> User sees shadcn-styled settings panel with config sliders

3. User clicks view tabs (Galaxy, DepFlow, Hotspot, Focus, Module, Forces, Churn, Coverage)
   -> System re-renders graph with view-specific colors/sizes/layout
   -> User sees view legend update, graph transitions

4. User clicks a node in the graph
   -> System shows detail panel (shadcn Sheet) with all metrics
   -> User sees file path, all metrics, imports, dependents, focus button

5. User searches for a file
   -> System flies camera to matching node
   -> User sees the node highlighted

6. User adjusts settings (opacity, size, repulsion, etc.)
   -> System live-updates graph rendering
   -> User sees immediate visual feedback

7. User runs `codebase-intelligence ./src --mcp`
   -> System starts MCP stdio server (unchanged behavior)
   -> LLM tools work as before

POSTCONDITION: Full 3D visualization with modern UI, all 8 views working, MCP mode operational

### Error Journeys

E1. Next.js server port conflict
    Trigger: Port 3333 already in use
    1. System detects port conflict
       -> System tries ports 3334-3337
       -> User sees "Server ready at http://localhost:{available_port}"
    Recovery: Server starts on next available port

E2. No TypeScript files found
    Trigger: Target directory has no .ts files
    1. System completes parsing with 0 files
       -> System shows empty graph with message "No TypeScript files found"
    Recovery: User can re-run with correct path

E3. Graph data fetch failure
    Trigger: API route returns error
    1. Client fetch fails
       -> System retries with exponential backoff (3 retries)
       -> User sees loading state during retries
    2. After 3 failures
       -> User sees error message with retry button
    Recovery: User clicks retry or refreshes page

### Edge Cases

EC1. Very large codebase (1000+ files): Graph renders but may be slow; settings panel allows reducing visual complexity
EC2. Circular dependencies: Highlighted in DepFlow view, graph still renders
EC3. No git history: Churn metrics show 0, churn view still renders with uniform sizing

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN a TS project WHEN user runs `codebase-intelligence ./src` THEN Next.js server starts and browser opens with 3D graph
- [ ] AC-2: GIVEN the app is loaded WHEN user clicks each of the 8 view tabs THEN graph re-renders with correct view-specific styling (colors, sizes, layout)
- [ ] AC-3: GIVEN a graph is rendered WHEN user clicks a node THEN shadcn-styled detail panel shows with all file metrics
- [ ] AC-4: GIVEN the settings panel WHEN user adjusts any slider/checkbox THEN graph updates in real-time
- [ ] AC-5: GIVEN the search input WHEN user types a filename THEN camera flies to matching node
- [ ] AC-6: GIVEN the app WHEN loaded THEN project bar shows title + all 9 stats (files, functions, deps, circular, coverage, dead exports, avg complexity, tension, bridges)
- [ ] AC-7: GIVEN each view WHEN rendered THEN correct color legend displays
- [ ] AC-8: GIVEN the app WHEN running THEN all API routes return same data as current Express routes
- [ ] AC-9: GIVEN `--mcp` flag WHEN user runs CLI THEN MCP stdio server starts with all 7 tools working
- [ ] AC-10: GIVEN the app WHEN running THEN MCP tools are accessible via HTTP API route

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN port conflict WHEN server starts THEN auto-finds next available port (3333-3337)
- [ ] AC-E2: GIVEN API fetch failure WHEN client loads THEN shows retry with exponential backoff
- [ ] AC-E3: GIVEN empty codebase WHEN parsed THEN shows empty graph with informative message

### Should Have

- [ ] AC-11: GIVEN the UI WHEN viewed THEN all panels use Tailwind CSS classes (no inline styles)
- [ ] AC-12: GIVEN the UI WHEN viewed THEN interactive elements use shadcn components (Button, Slider, Sheet, Input)
- [ ] AC-13: GIVEN dev mode WHEN files change THEN Next.js hot-reloads (tsx watch replaced by next dev)

## Scope

- [x] 1. Initialize Next.js + Tailwind + shadcn in project -> AC-11, AC-12
- [x] 2. Create graph singleton + API Route Handlers (7 routes) -> AC-8
- [x] 3. Create MCP HTTP API route -> AC-10
- [x] 4. Create GraphCanvas component (react-force-graph-3d wrapper) -> AC-1, AC-2
- [x] 5. Create 8 view derivation functions (pure: data+config -> visual props) -> AC-2
- [x] 6. Create ViewTabs + Legend components -> AC-2, AC-7
- [x] 7. Create ProjectBar component (title + 9 stats) -> AC-6
- [x] 8. Create DetailPanel component (shadcn Sheet) -> AC-3
- [x] 9. Create SettingsPanel component (shadcn sliders/checkbox) -> AC-4
- [x] 10. Create SearchInput component with camera fly -> AC-5
- [x] 11. Create module clouds hook (THREE.js imperative) -> AC-2
- [x] 12. Create data fetching hooks (SWR) -> AC-E2
- [x] 13. Wire main page layout (app/page.tsx) -> AC-1, AC-6
- [x] 14. Update CLI to launch Next.js server -> AC-1, AC-E1
- [x] 15. Update MCP to keep stdio mode working -> AC-9
- [x] 16. Migrate API tests to Next.js Route Handler tests -> AC-8
- [ ] 17. Add React component tests -> AC-2, AC-3, AC-4
- [x] 18. Delete Express server code + public/index.html -> AC-1

### Out of Scope

- SSR/SSG for the 3D graph (WebGL is client-only by nature)
- Authentication/multi-user (stays single-user local tool)
- Database/persistence (stays in-memory graph)
- React Native/mobile
- Deployment to Vercel/cloud (stays local CLI tool)
- Dark/light theme toggle (keep current dark theme)

## Quality Checklist

### Blocking

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All 8 views render correctly with proper colors/sizes
- [ ] No regressions in pipeline tests (parser, graph, analyzer)
- [ ] API routes return identical data to current Express routes
- [ ] MCP stdio mode works unchanged
- [ ] No hardcoded secrets or credentials
- [ ] No innerHTML usage (React handles this; verify no dangerouslySetInnerHTML)
- [ ] Build succeeds (`next build`)
- [ ] TypeScript strict mode passes
- [ ] ESLint passes

### Advisory

- [ ] All Should Have ACs passing
- [ ] shadcn components used for all interactive elements
- [ ] Consistent Tailwind class patterns (no mixed styling approaches)
- [ ] Bundle size reasonable (< 500KB initial JS)
- [ ] 3D graph performance comparable to vanilla version

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| react-force-graph-3d missing features vs vanilla 3d-force-graph | HIGH | MED | Test imperative API access early (scope item 4); fallback to vanilla wrapper if React wrapper insufficient |
| Graph singleton state in Next.js Route Handlers | MED | LOW | Module-level singleton works for single-process `next start`; tested in scope item 2 |
| THREE.js module clouds conflict with React lifecycle | MED | MED | Isolate in custom hook with cleanup; use refs not state for THREE.js objects |
| Performance regression from React overhead on 3D canvas | MED | LOW | React only wraps the canvas; 3d-force-graph manages its own render loop |
| Large migration scope exceeds estimate | HIGH | MED | Scope items ordered by dependency; ship incrementally (API first, then components) |

**Kill criteria:** If react-force-graph-3d cannot expose imperative API (scene(), d3Force(), graphData()) → abort React wrapper approach, use vanilla 3d-force-graph in a React ref instead.

## State Machine

**Status**: N/A — Stateless feature

**Rationale**: The migration changes implementation but not state behavior. The app remains: load data -> render graph -> respond to user interactions. No new stateful flows introduced. View switching, settings, and detail panel are React state transitions managed by React's built-in state system.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| react-force-graph-3d exposes same imperative API as vanilla | It's the official React wrapper from the same author; docs show ref-based API access | Some advanced features (scene(), custom THREE.js objects) may need workarounds | RISKY |
| Module-level singleton works for graph data in Next.js | Works in single-process `next start`; common pattern for in-memory caches | Next.js dev mode may restart modules; serverless deployments would break (but we're local-only) | VALID |
| shadcn components work well with 3D canvas overlay | shadcn uses Radix primitives with z-index management | 3D canvas may capture pointer events, interfering with UI overlays | RISKY |
| SWR is the right data-fetching choice | Built-in caching, revalidation, error retry; widely used with Next.js | Data is static after initial load (parsed once) — SWR's revalidation is overkill; simple fetch + useState may suffice | VALID |
| CLI can launch Next.js dev server programmatically | `next dev` is a CLI command; can spawn as child process | Programmatic API for Next.js server is not well-documented; may need child_process.spawn | RISKY |

### Blind Spots

1. **[Integration]** How react-force-graph-3d handles the module clouds (custom THREE.js objects added to scene)
   Why it matters: Module clouds are a key visual feature. If the React wrapper isolates the THREE.js scene, adding custom meshes/sprites may break.

2. **[DX]** Dev mode experience: `tsx watch` is instant; `next dev` has cold start + HMR overhead
   Why it matters: Current dev experience is fast; Next.js dev mode may feel slower for a tool that's primarily a CLI utility.

3. **[Ops]** Package size increase: Next.js + React + Tailwind adds significant node_modules bloat to what's currently a lean CLI tool
   Why it matters: This is an npm package installed globally; users may not want 200MB+ of Next.js deps for a visualization tool.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| react-force-graph-3d doesn't expose .scene() | Module clouds feature breaks | React wrapper may abstract away THREE.js scene access | HIGH | Test in scope item 4; fallback: use vanilla 3d-force-graph with useRef |
| Next.js dev server is slow to start (>5s) | Poor DX for CLI tool users who expect instant startup | Next.js compilation overhead | MED | Use `next start` (pre-built) for production; accept dev mode overhead |
| Pointer events conflict between shadcn overlays and WebGL canvas | UI panels unclickable when overlapping canvas | WebGL canvas may capture all pointer events | MED | Use pointer-events-none on canvas container; explicit pointer-events-auto on panels |

### The Real Question

Confirmed — spec solves the right problem. The current vanilla HTML approach works but doesn't scale for UI complexity (settings, multiple panels, component reuse). Next.js + React provides proper component architecture. The risk is scope: this is a full rewrite of the client layer with server restructuring.

**Recommendation:** Proceed, but validate react-force-graph-3d imperative API access first (scope item 4 is the highest-risk item).

### Open Items

- [risk] react-force-graph-3d scene access for module clouds -> explore (spike before full implementation)
- [question] Should CLI `codebase-intelligence ./src` run `next dev` or `next start` (pre-built)? -> question
- [improvement] Consider keeping Express as fallback for environments where Next.js is too heavy -> no action (out of scope)

## Notes

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Init Next.js + Tailwind + shadcn | pending | - |
| 2 | Graph singleton + API routes | pending | - |
| 3 | MCP HTTP API route | pending | - |
| 4 | GraphCanvas component | pending | - |
| 5 | View derivation functions | pending | - |
| 6 | ViewTabs + Legend | pending | - |
| 7 | ProjectBar | pending | - |
| 8 | DetailPanel | pending | - |
| 9 | SettingsPanel | pending | - |
| 10 | SearchInput | pending | - |
| 11 | Module clouds hook | pending | - |
| 12 | Data fetching hooks | pending | - |
| 13 | Main page layout | pending | - |
| 14 | Update CLI for Next.js | pending | - |
| 15 | MCP stdio mode | pending | - |
| 16 | Migrate API tests | pending | - |
| 17 | React component tests | pending | - |
| 18 | Delete Express + HTML | pending | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-02-18T00:00:00Z | - | Created |
