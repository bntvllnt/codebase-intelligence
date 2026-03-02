# Codebase Visualizer - Claude Code Rules

## Project Overview

npm package that generates 3D interactive maps of TypeScript codebases. Two modes: browser (3D visualization) and MCP stdio (LLM integration).

## Architecture

```
src/
  types/index.ts      <- All TypeScript interfaces (single source of truth)
  parser/index.ts     <- TS Compiler API parser (files, functions, imports)
  graph/index.ts      <- graphology graph builder + circular dep detection
  analyzer/index.ts   <- Metrics engine (PageRank, betweenness, cohesion, tension, churn, complexity, blast radius, dead exports)
  mcp/index.ts        <- MCP stdio server (7 tools)
  server/index.ts     <- Express web server
  server/api.ts       <- REST API routes
  cli.ts              <- CLI entry point (commander)
public/
  index.html          <- Client-side 3D renderer (8 views, uses 3d-force-graph from CDN)
docs/
  architecture.md     <- Pipeline, module map, data flow, design decisions
  data-model.md       <- All TypeScript interfaces with field descriptions
  metrics.md          <- Per-file + module metrics, force analysis, complexity scoring
  mcp-tools.md        <- 7 MCP tools: inputs, outputs, use cases, selection guide
specs/
  active/             <- Current spec
```

## Pipeline

```
CLI args -> Parser (TS AST) -> Graph Builder (graphology) -> Analyzer (metrics) -> Server (Express | MCP stdio)
```

## Key Conventions

### TypeScript
- ESM modules (`"type": "module"`)
- Bundler module resolution
- Strict mode enabled
- All internal imports use `.js` extension (ESM convention)
- Types defined in `src/types/index.ts` — import from there, never duplicate
- `import type` for type-only imports (enforced by ESLint)

### Dependencies
- **graphology** — graph data structure. Import as `import Graph from "graphology"`. Use as both constructor and type.
- **graphology-metrics** — PageRank, betweenness. Default imports from subpaths.
- **@modelcontextprotocol/sdk** — MCP server. Uses `McpServer` class with `server.tool()` registration.
- **express** — web server. Routes in `server/api.ts`, static files from `public/`.
- **typescript** — used as a library (Compiler API), not just a dev tool.
- **zod** — MCP tool input validation.

### Quality Gates

```bash
npm run lint        # ESLint (strict typescript-eslint)
npm run typecheck   # tsc --noEmit
npm run build       # tsc
npm run test        # vitest
```

All four must pass before shipping. Run in order: lint -> typecheck -> build -> test.

## Release Protocol

### Version Bumping

| Change Type | Bump | Example |
|-------------|------|---------|
| New MCP tools, new views, new metrics | minor | 1.0.1 → 1.1.0 |
| Bug fixes, description changes, doc sync | patch | 1.1.0 → 1.1.1 |
| Breaking: removed tool, changed tool params | major | 1.1.0 → 2.0.0 |

### Release Flow

```
1. All quality gates pass (lint → typecheck → build → test)
2. Bump version in package.json
3. Commit: "chore(release): bump to vX.Y.Z"
4. Tag: git tag vX.Y.Z
5. Push: git push origin main --tags
6. Publish: pnpm publish:npm
```

### Commands

```bash
# Bump version (edit package.json, then:)
git add package.json && git commit -m "chore(release): bump to vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags

# Publish to npm (runs lint → typecheck → build → test → publish)
pnpm publish:npm
```

### Prerequisites
- `npm login` completed on your machine
- npm account/package permissions set
- if npm 2FA is enabled, provide OTP during publish

### What `pnpm publish:npm` does
1. lint
2. typecheck
3. build
4. test
5. `npm publish --access public`

### ESLint Rules
- Strict type-checked config (`strictTypeChecked`)
- No `any` — use `unknown` + type guards
- No unused vars (except `_` prefix)
- Consistent type imports enforced
- Explicit return types on non-expression functions
- MCP handlers exempt from `require-await` and `no-deprecated` (SDK constraints)

## Security Rules

### Client-side (public/index.html)
- **NEVER use innerHTML with dynamic data** — use DOM API (`createElement` + `textContent`)
- **NEVER use inline onclick attributes** — use `addEventListener`
- All node data from the API must be treated as untrusted (file paths can contain HTML metacharacters)
- Use the `el()` helper for safe DOM construction

### Server-side
- Validate and clamp all query parameters (especially `limit`)
- API routes should return JSON 404s, not HTML
- No filesystem access beyond the parsed graph data

## File Conventions

- New analysis metrics go in `src/analyzer/index.ts`
- New MCP tools go in `src/mcp/index.ts` (register with `server.tool()`)
- New REST endpoints go in `src/server/api.ts`
- New browser views go in `public/index.html` (add render function + view tab)
- Types always in `src/types/index.ts`

## Common Pitfalls

- graphology's `getNodeAttribute()` returns `unknown` — always cast with `as Type | undefined`
- `path.sep` differs on Windows vs Linux — normalize to forward slashes for cross-platform
- Parser's `walkDir` tracks visited dirs to prevent symlink loops
- Circular dep detection uses iterative DFS (not recursive) to avoid stack overflow
- MCP tool handlers must be async (SDK requirement) even if they don't await

## Documentation (`docs/`)

LLM knowledge base for building this tool. Single source of truth per topic:

| Doc | Covers | Update When |
|-----|--------|-------------|
| `docs/architecture.md` | Pipeline, module map, data flow, design decisions | New module or pipeline change |
| `docs/data-model.md` | All TypeScript interfaces (mirrors `src/types/index.ts`) | Type changes |
| `docs/metrics.md` | Per-file + module metrics, force analysis, complexity scoring | New metric added |
| `docs/mcp-tools.md` | 7 MCP tools with inputs/outputs/use cases | New tool or param change |

## Testing (BLOCKING)

- Test runner: vitest
- Test files: `src/**/*.test.ts`
- Run: `npm test` or `npx vitest run`

### Coverage Policy (ENFORCE)

- Every new function, endpoint, or behavior MUST have tests
- Every bug fix MUST include a regression test
- Target: maximum coverage — if code exists, it should be tested
- No feature or fix ships without corresponding tests

### Real Environment Tests (MANDATORY)

- **NEVER mock internal modules** — use real parser, real graph, real analyzer
- **NEVER mock Express** — use `supertest` against the real app
- **NEVER mock graphology** — build real graphs with real data
- **NEVER mock filesystem for parser tests** — use real fixture directories with real `.ts` files
- **Only mock external third-party APIs** that require network/auth (none currently)
- Integration tests > unit tests. Test the pipeline, not isolated functions.

### Test Patterns

| Layer | Test Approach |
|-------|--------------|
| Parser | Real `.ts` fixture files on disk, assert parsed output |
| Graph | Real parsed files -> real graph builder, assert nodes/edges |
| Analyzer | Real graph -> real metrics, assert values |
| API | `supertest` against real Express app with real graph data |
| MCP | Real MCP server instance, assert tool responses |
| CLI | Real process execution where feasible |

### Visual Verification (MANDATORY for UI changes)

- After ANY UI change (HTML/CSS/client JS), start the server and verify in a browser
- Start server: `node dist/cli.js ./src --port 3333`
- Verify: page loads, graph renders, changed feature works visually
- Check browser console for JavaScript errors
- Kill server after verification
- If browser agent is available, use it for automated visual verification

### Anti-Patterns (NEVER)

- NEVER use `jest.mock()` or `vi.mock()` for internal modules
- NEVER create fake/stub graph objects — build them through the real pipeline
- NEVER skip tests because "it's just UI" or "it's just config"
- NEVER write tests that pass regardless of implementation (test behavior, not existence)
- NEVER ship UI changes without visual verification in a real browser
