# Codebase Intelligence — Roadmap

> Future work only. Deterministic, graph-native codebase intelligence for TypeScript & JavaScript.
> Read-first, agent-native, architecture-aware. No invented findings: every claim is graph-backed evidence a human or agent can inspect.

**Last updated:** 2026-07-01

## Direction

Two tracks:

- **Parity track** — close the static-analysis gaps TS/JS teams expect from a serious code-quality CLI.
- **Differentiation track** — ship graph-native analysis no token-only tool can offer: Highways, content drift, scope maps, and agent-ready context packs.

Guiding constraints for all future work:

1. **Read-only analyzer.** The tool reports and advises; source changes are applied by humans or agents.
2. **Deterministic evidence.** Findings come from AST, type, graph, git, config, and filesystem facts. No LLM-derived findings.
3. **Agent-native outputs.** Every finding needs stable IDs, JSON, evidence, and `actions[]` hints.
4. **Graph-first, visual-second.** 2D/3D views are derived from queryable graph data, never the product source of truth.
5. **CLI help is a product surface.** LLMs will use shell commands; help, examples, errors, and `--json` must stay predictable.
6. **Open-source naming hygiene.** Competitor/product names belong only in documentation comparison sections. Source, tests, CLI help, MCP output, fixtures, and generated agent instructions use generic capability labels unless naming a real dependency, standard, or integration.

---

## 2.5.0 Canary Release Train

`2.5.0` is a multi-PR canary release train, not a single PR. Everything in this roadmap is allowed to land under `2.5.0-canary.*`; stable `2.5.0` is published only after the whole train has soaked in canary mode and the release gates pass.

**Release goal:** ship the full codebase-intelligence direction as one cohesive `2.5.0` stable: cache identity cleanup, analyzer foundations, parity gaps, Highways, map/drift intelligence, agent-ready outputs, CI/dev ergonomics, and ecosystem hardening.

**In scope for `2.5.0`:**

1. P0 Stabilization.
2. P1 Analysis Foundations.
3. P2 Product Parity + Flagship Intelligence.
4. P3 Depth + Ergonomics.
5. P4 Ecosystem Hardening.

**Out of scope for `2.5.0`:**

- Auto-fix or source mutation.
- Production-runtime tracing or hosted cloud analysis.
- Visual-only graph product without structured graph outputs.
- Per-agent analyzer forks.
- Universal framework plugin catalog beyond targeted/configurable awareness.

**Implementation order:**

1. **Stabilization first** — cache migration, docs/help alignment, targeted entry fixes, deterministic tests.
2. **Operation registry second** — reduce CLI/MCP duplication before adding more surfaces.
3. **Analysis foundations third** — Type/Shape, duplication, dead-code expansion, suppression hygiene.
4. **Flagship intelligence fourth** — Highways, scope graph/map, content drift, health, boundaries.
5. **Agent/CI surfaces fifth** — CI wrapper, doctor, output formats, `actions[]`, context packs.
6. **Editor/depth sixth** — cognitive complexity, ownership/cohorting, LSP, architecture recommendations.
7. **Ecosystem hardening seventh** — watch, monorepo scope, migration, hooks, local history, production mode.
8. **Release hardening last** — canary soak, docs sync, real-repo verification, stable publish gates.

**Per-item acceptance contracts:**

| Item | Dev-ready contract |
|---|---|
| Cache migration | All cache states are covered by tests: only legacy, only canonical, both same signature, both different signature, neither. Scanner excludes both folders. Writes go only to `.codebase-intelligence/`. `init --gitignore` is idempotent. JSON surfaces expose `cacheDir`, `legacyCacheDir`, `migrated`, `gitignoreUpdated`, and `warnings[]`. |
| Docs/help alignment | README, CLI help, `docs/cli-reference.md`, `docs/mcp-tools.md`, `docs/data-model.md`, `llms.txt`, and `llms-full.txt` describe `.codebase-intelligence/` as canonical and `.code-visualizer/` as legacy migration input. |
| Test-runner determinism | `pnpm test` exits 0 locally after assertions pass; the Vitest worker `onTaskUpdate` timeout is gone or the runner configuration is made deterministic. |
| Targeted framework fixes | Any remaining framework/config false positive has a minimal fixture proving the bug and a focused fix. No broad plugin framework lands in `2.5.0`. |
| Analysis foundations | Operation registry, Type/Shape, duplication, dead-code expansion, and suppression hygiene each ship with CLI/MCP parity or an explicit documented exception. |
| Flagship intelligence | Highways, map, drift, health, and boundaries produce deterministic JSON with evidence and stable IDs before any visual or prose-only surface is treated as complete. |
| Agent/CI surfaces | CI, doctor, output formats, `actions[]`, and context packs are usable by LLM-driven CLI workflows without scraping human prose. |
| Ecosystem hardening | Watch/monorepo/migration/hooks/history/production mode are gated by fixtures or real-repo verification, not demo-only behavior. |

**2.5.0 release gates:**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm verify:cli-real
```

Every material PR publishes or validates a `2.5.0-canary.*` build before it is considered integrated. `pnpm test` must exit 0 before stable publish. The prior Vitest fork-pool `onTaskUpdate` timeout was reproduced and the release gate now uses the thread pool; any future runner-level timeout after passing assertions still blocks stable publish.

**Docs required before stable:**

- README command list and examples.
- `docs/cli-reference.md`.
- `docs/mcp-tools.md`.
- `docs/data-model.md` for cache migration output fields.
- `llms.txt` and `llms-full.txt`.
- Migration note for `.code-visualizer/` to `.codebase-intelligence/`.
- New command docs for every shipped CLI/MCP surface.
- Upgrade notes for any JSON shape additions.

**Blocked decisions for `2.5.0`:** open decisions below must be resolved before implementing the feature they affect; unresolved late-phase decisions do not block earlier canaries.

---

## 2.5.0 Test Strategy — User Stories + Chained Actions

Purpose: prove the CLI, MCP server, library outputs, docs, CI behavior, and agent workflows work for every user type. Tests should exercise real code paths. Mock only true third-party edges; a mocked own-code seam is a gap.

**Detected surfaces:**

| Surface | Evidence | E2E meaning |
|---|---|---|
| CLI/tool | `package.json` `bin`, `src/cli.ts`, command docs | Spawn the real built binary with real args, assert stdout/stderr/exit/files. |
| MCP server | `src/mcp/`, tool schemas, stdio lifecycle tests | Start real stdio server, call tools with a real MCP client, assert schema/result/error envelopes. |
| Library/package surface | `exports`, `types`, `bin`, package-entrypoint metadata | Import the built package from a tiny consumer fixture and assert public API/types. |
| CI/release | `check`, SARIF, canary publish flow, GitHub Actions | Run the same commands CI runs and assert exit codes/artifacts. |
| Agent docs/instructions | `llms.txt`, `llms-full.txt`, generated agent instructions | An AI-agent persona can discover commands, run them, and parse machine output without scraping prose. |

**Personas:**

| ID | Persona | Surface | Need |
|---|---|---|---|
| US-CLI-HUMAN | Human terminal user | CLI | Clear help, predictable commands, actionable errors. |
| US-CLI-CI | Script/CI runner | CLI/CI | Stable exit codes, non-interactive behavior, machine-readable output. |
| US-CLI-AGENT | AI coding agent | CLI/docs | Deterministic `--json`, small context, next-step hints, no noisy prose in JSON. |
| US-MCP-AGENT | MCP agent client | MCP | Valid tool schemas, stable envelopes, parity with CLI. |
| US-LIB-DEV | Consuming developer | Library/package | Public entrypoints, types, and docs match runtime behavior. |
| US-DOWNSTREAM | Downstream app/runtime | Library/package | Built package works when imported from outside the repo. |
| US-MAINTAINER | Maintainer/releaser | CI/release | Canary/stable gates fail only on real blockers and produce useful artifacts. |
| US-MIGRATOR | Existing user with legacy cache | CLI/filesystem | `.code-visualizer/` migrates safely and never loses data silently. |
| US-ADVERSARY | Hostile input user | CLI/MCP/library | Bad paths, oversized args, malformed config, and hostile JSON fail safely. |

**Surface x persona x layer matrix:**

| Persona | Unit | Integration | E2E | UI | Chaining |
|---|---|---|---|---|---|
| US-CLI-HUMAN | Required | Required | Required | N/A - no TUI | Required |
| US-CLI-CI | Required | Required | Required | N/A - no TUI | Required |
| US-CLI-AGENT | Required | Required | Required | N/A - no TUI | Required |
| US-MCP-AGENT | Required | Required | Required | N/A - protocol surface | Required |
| US-LIB-DEV | Required | Required | Required consumer fixture | N/A - library | Required |
| US-DOWNSTREAM | Required | Required | Required consumer fixture | N/A - library | Required |
| US-MAINTAINER | Required | Required | Required CI command run | N/A - CI | Required |
| US-MIGRATOR | Required | Required filesystem fixture | Required CLI run | N/A - CLI | Required |
| US-ADVERSARY | Required | Required | Required negative CLI/MCP/library runs | N/A - no UI | Required |

**Feature PR rule:** every material PR must add or update at least one chained test below. A chain is complete only when it proves setup -> action -> machine output -> downstream use or recovery. Happy-path-only tests do not close a chain.

### P0 Chains — Stabilization

| Chain | User story | Required actions |
|---|---|---|
| CH-P0-01 cache migration | As US-MIGRATOR, I can upgrade without losing or duplicating cache state. | Create fixture with only `.code-visualizer/` -> run real CLI command -> assert `.codebase-intelligence/` exists -> assert JSON `cache.migrated` -> rerun command -> assert canonical cache is used -> run `--status` -> run `--clean`. |
| CH-P0-02 new cache gitignore | As US-CLI-HUMAN, I can initialize ignore rules safely. | Run init/gitignore command in temp repo -> assert `.gitignore` gets `.codebase-intelligence/` once -> rerun -> assert idempotent -> assert legacy folder is documented as migration input only. |
| CH-P0-03 docs/help alignment | As US-CLI-AGENT, I can learn the canonical cache path from every surface. | Build CLI -> capture `--help` and command help -> scan README/docs/LLM docs -> assert `.codebase-intelligence/` canonical wording -> assert `.code-visualizer/` appears only in legacy migration context. |
| CH-P0-04 deterministic test runner | As US-MAINTAINER, I can trust release gates. | Run `pnpm test` -> assert exit 0 -> assert no Vitest `onTaskUpdate` timeout -> rerun focused long E2E suite -> assert no open-handle/worker timeout. |
| CH-P0-05 targeted entry fix | As US-LIB-DEV, I do not get false dead-code findings for supported entrypoints. | Add real fixture for proven false positive -> run `dead-exports`/`check` JSON -> assert entrypoint confidence/reason -> assert unsupported patterns remain configurable, not hardcoded magic. |

### P1 Chains — Analysis Foundations

| Chain | User story | Required actions |
|---|---|---|
| CH-P1-01 operation parity | As US-MCP-AGENT and US-CLI-AGENT, I get equivalent facts from CLI and MCP. | Run one operation through descriptor registry -> invoke matching CLI command -> invoke matching MCP tool -> compare normalized JSON -> assert shared validation errors and hints. |
| CH-P1-02 graph-load pipeline | As US-MAINTAINER, new operations do not duplicate load/cache/error logic. | Trigger success, invalid input, parse failure, and cache reuse through registry adapter -> assert CLI/MCP adapters differ only in presentation envelope. |
| CH-P1-03 type/shape facts | As US-LIB-DEV, I can inspect producers/consumers of a type shape. | Parse fixture with aliases/generics/default exports/unresolved types -> assert symbol parameter/return facts -> query file/symbol/MCP surfaces -> assert additive JSON compatibility. |
| CH-P1-04 duplication families | As US-CLI-HUMAN, I can find duplicate logic with deterministic IDs. | Fixture exact clone + renamed clone + near-miss + below-threshold noise -> run CLI/MCP -> assert family IDs, thresholds, trace output, stable ordering, and no local-skip false positive. |
| CH-P1-05 dead code expansion | As US-CLI-CI, I can gate unused files/types/members/deps without framework false positives. | Fixture unused file/type/member/dependency plus supported entrypoint -> run check JSON/SARIF -> assert real findings, confidence, and ignored entrypoint evidence. |
| CH-P1-06 suppression hygiene | As US-MAINTAINER, suppressions do not hide stale debt forever. | Add active suppression -> assert finding suppressed and reported -> remove underlying finding -> assert stale suppression warning -> assert JSDoc `@public`/`@internal`/`@expected-unused` behavior. |

### P2 Chains — Product Parity + Flagship Intelligence

| Chain | User story | Required actions |
|---|---|---|
| CH-P2-01 highways reroute | As US-CLI-AGENT, I can identify divergent routes and get a safe reroute proposal. | Fixture with 3 entrypoints converging on one sink -> run `highways --json` -> assert cowpath/bypass findings, route chains, evidence, blast radius, proposed canonical node -> call MCP `analyze_highways` and compare. |
| CH-P2-02 highway synthesis | As US-CLI-HUMAN, I can understand the proposed canonical path before coding. | Fixture with no existing canonical node -> run `highways --propose --trace` -> assert synthesized name/location/signature/skeleton/reroute plan and cycle-safety check. |
| CH-P2-03 codebase map context pack | As US-MCP-AGENT, I can request only the files needed for one task. | Run `map --focus <symbol> --context-budget <n> --json` -> assert nodes/edges/evidence IDs -> request MCP context pack -> assert token-bounded ranked files/symbols/tests. |
| CH-P2-04 content drift | As US-MAINTAINER, I can find files whose names lie about behavior. | Fixture name/scope/side-effect/test mismatch -> run `drift --json` -> assert drift score, deterministic evidence, recommendation, baseline report-only first run. |
| CH-P2-05 health/boundaries | As US-CLI-CI, I can gate new architecture debt. | Fixture boundary violation + complexity/churn hotspot -> run health/boundary commands -> assert score, rule evidence, baseline/new-only behavior, stable exit codes. |
| CH-P2-06 CI wrapper | As US-MAINTAINER, I can add one PR gate. | Run `ci --base origin/main --new-only --format sarif` in temp git repo -> assert exit code, SARIF artifact, PR markdown, compact summary, and no failure on pre-existing debt. |
| CH-P2-07 doctor onboarding | As US-CLI-AGENT, I can self-diagnose setup. | Run `doctor --json` in repo missing config/cache/agent docs -> assert checks, levels, exact fix commands, docs links, read-only behavior. |
| CH-P2-08 output actions | As US-CLI-AGENT, every finding gives safe next steps. | For each analyzer finding kind -> assert stable ID, evidence, `actions[]`, no source mutation, and JSON schema compatibility. |

### P3 Chains — Depth + Ergonomics

| Chain | User story | Required actions |
|---|---|---|
| CH-P3-01 cognitive complexity | As US-CLI-HUMAN, I can distinguish branchy code from simple long code. | Fixture nested branches + flat long function -> run metrics surfaces -> assert cognitive vs cyclomatic values and hotspot ranking. |
| CH-P3-02 ownership/cohorting | As US-MAINTAINER, I can see risky owner concentration. | Temp git history + CODEOWNERS fixture -> run owner grouping -> assert bus-factor, owner hotspots, and effort filters. |
| CH-P3-03 LSP diagnostics | As US-LIB-DEV, editor diagnostics match batch analysis. | Start LSP against fixture -> open file -> assert diagnostics/hover facts match CLI JSON for same graph -> assert code actions are advisory only. |
| CH-P3-04 architecture recommendations | As US-CLI-AGENT, I can act on extraction recommendations. | Fixture bridge/tension/seam -> run architecture recommendations -> assert effort, evidence, affected files, and context pack. |

### P4 Chains — Ecosystem Hardening

| Chain | User story | Required actions |
|---|---|---|
| CH-P4-01 watch mode | As US-CLI-HUMAN, I can keep analysis fresh while editing. | Start watch on fixture -> change file -> assert incremental re-analysis -> assert debounce, cache update, and clean shutdown. |
| CH-P4-02 monorepo scope | As US-CLI-CI, I can analyze only changed workspaces. | Multi-package fixture -> change one package -> run `--changed-workspaces` -> assert scoped graph, cross-package cycle detection, stable summary. |
| CH-P4-03 config migration | As US-CLI-HUMAN, I can migrate analyzer config safely. | Fixture with supported external config -> run migrate dry-run -> assert generated config, warnings, no source mutation, idempotency. |
| CH-P4-04 hooks install | As US-MAINTAINER, local hooks run the same gate as CI. | Temp git repo -> install hooks -> stage bad file -> assert hook blocks with same finding ID as `check` -> uninstall/cleanup. |
| CH-P4-05 local finding history | As US-MAINTAINER, I can see trend changes without cloud. | Run analysis twice with changed findings -> assert local history file, trend summary, gitignored storage, no sensitive source capture. |
| CH-P4-06 production mode | As US-CLI-CI, I can exclude test/dev files from production risk. | Fixture with prod + test-only files -> run `--production` -> assert test/dev exclusions, prod findings retained, docs state behavior. |

**Chain closeout rule:** stable `2.5.0` cannot ship until every chain for shipped features is green in CI or explicitly marked deferred with reason, owner, and follow-up issue.

---

## P0 — 2.5.0 Stabilization

### Cache Directory Migration

Rename the legacy index/cache folder from `.code-visualizer/` to `.codebase-intelligence/` without breaking existing users.

**Status:** Shipped across P0 canary PRs.

**Shipped:**

- Auto-migrate legacy-only `.code-visualizer/` to `.codebase-intelligence/` when safe.
- Prefer `.codebase-intelligence/` when both folders exist, including same-signature and different-signature states.
- Keep both folders excluded from scanning and cache fingerprints during the migration window.
- Write new cache files only to `.codebase-intelligence/`.
- Add `init --gitignore` to append `.codebase-intelligence/` idempotently.
- Add `--clean` behavior that removes canonical and legacy cache directories.
- Update docs, README, CLI help, tests, and fixtures to mention legacy auto-migration.
- Expose migration facts in JSON on analysis commands and `init --json`: `cacheDir`, `legacyCacheDir`, `migrated`, `gitignoreUpdated`, `warnings[]`.

### Docs + Help Alignment

Make every user-facing instruction reflect the canonical cache name.

**Status:** Shipped in the P0 canary PR.

- Replace canonical `.code-visualizer/` references with `.codebase-intelligence/`.
- Mention `.code-visualizer/` only as legacy migration input.
- Update `--index`, `--status`, and `--clean` help text.
- Update README, docs, `llms.txt`, and `llms-full.txt`.
- Keep competitor/product names out of runtime help and generated agent instructions.

### Test Runner Release Gate

Fix the repeated Vitest runner timeout so release gates are deterministic.

**Status:** Shipped in the P0 canary PR.

- Reproduce `Timeout calling "onTaskUpdate"` after all tests pass.
- Isolate the issue to the Vitest fork worker pool used by the release gate.
- Switch `pnpm test` to `--pool threads --no-file-parallelism`.
- Keep `429` assertions passing and make `pnpm test` exit 0 locally.
- Bound non-blocking CI coverage collection so coverage hangs cannot block the release gate.
- Bound `pnpm test` to one Vitest worker and disabled Vitest duration cache so host-level memory pressure and stale file ordering do not terminate the release gate.

### Targeted Framework Entry Fixes

Package public entrypoints already have coverage. Only fix remaining framework/config false positives with proof.

**To do:**

- Add minimal fixtures only for verified remaining false positives.
- Prefer config-driven entrypoint declarations over hardcoded broad framework plugins.
- Do not ship a universal framework plugin system in `2.5.0`.

---

## P1 — 2.5.0 Analysis Foundations

### Operation Registry

Collapse CLI + MCP operation duplication into one descriptor registry before adding more analyzers.

**Foundation slice:**

- Add `Operation<TInput, TResult>` descriptors per analysis operation.
- Add typed operation names, CLI command names, MCP tool names, and input schemas.
- Add `runOperation(...)` discriminated result/error wrapper for descriptor-level tests.
- Type MCP next-step hint keys against the operation-name union.
- Add CH-P1-01 coverage for registry -> CLI JSON -> MCP JSON overview parity.
- Reuse registry descriptors and input shapes in MCP tool registration.
- Route MCP operation success/error envelopes through `runOperation(...)` while preserving existing `nextSteps` and `isError` contracts.
- Add MCP registry parity coverage for representative operation descriptor runs.
- Reuse registry schemas in CLI coercion.
- Move CLI failures over descriptor-level validation errors.
- Add CLI registry parity coverage for representative descriptor runs and invalid input.
- Expand CH-P1-01 coverage from overview/representative CLI/MCP operations to every operation.
- Expand CH-P1-02 coverage for descriptor validation, CLI parse failure, and cache reuse through registry-adapted commands.
- Use one graph-load pipeline with progress callbacks.
- Extend CH-P1-02 coverage to MCP/stdio graph-load behavior.
- Move operation text formatting over result objects into descriptor-backed formatters.

**Remaining:**

- None for the operation-registry foundation. Future non-text output variants remain tracked under P2 Output Formats + Actionability.

### Type/Shape Layer

Capture resolved parameter and return types per symbol.

**Foundation slice:**

- Store compact type signatures on parsed symbols.
- Carry type facts into graph `SymbolNode` data.
- Expose additive `typeFacts` in `file`, `symbol`, and `search` JSON.
- Index consumed/produced type names in search so shape queries find producer/consumer symbols.
- Add CH-P1-03 coverage for aliases, generics, default exports, unresolved types, file/symbol/search JSON, CLI, and MCP parity.

**Remaining:**

- Unlock type-aware dead code and Highways H2 shape grouping.
- Use type facts for synthesized highway signatures.

### Duplication Detection

Add deterministic clone detection on the existing parser path.

**To do:**

- Implement `strict`, `mild`, and `weak` clone modes.
- Emit clone families, not isolated pair findings.
- Support `--min-tokens`, `--skip-local`, `--trace <id>`, and `--json`.
- Feed step-similarity signals into Highways.
- Defer semantic/shape-based duplication until the Type/Shape layer exists.

### Dead Code Beyond Exports

Extend deletion intelligence beyond exported symbols.

**To do:**

- Detect unused files.
- Detect unused types.
- Detect unused enum/class members.
- Detect unused / unlisted / type-only / test-only dependencies.
- Keep findings framework-aware to avoid false positives.

### Suppression Hygiene

Finish suppression management without hiding stale debt.

**Already exists:** `ci-ignore-next-line` and `ci-ignore-file`.

**To do:**

- Add JSDoc `@public`, `@internal`, and `@expected-unused` semantics.
- Add stale-suppression detection.
- Report suppressions in JSON and CI summaries.

---

## P2 — 2.5.0 Product Parity + Flagship Intelligence

### Highways

Detect repeated data routes that should converge on one canonical path.

**Mental model:**

```
synapse = one edge
highway = reusable multi-step route

entry ─► transform ─► validate ─► sink
          ▲ canonical node agents should reuse
```

**Vocabulary:**

| Term | Meaning |
|---|---|
| `route` | Ordered call chain from an entry point toward a sink |
| `sink` | Terminal side effect or canonical boundary: DB write, API call, queue publish, store mutation, file write |
| `shape` | Type/DTO/domain object moving through the route |
| `canonical node` | Shared function/module most routes should pass through for one operation |
| `cowpath` | Ad-hoc route that recreates a canonical operation outside the shared path |
| `bypass` | Route that reaches a sink while skipping an existing canonical node |
| `highway` | Approved canonical route for one `(operation, shape, sink)` inside a bounded scope |

**To do:**

- H1: classify operation verbs, enumerate entry-to-sink routes, detect cowpaths and bypasses.
- H1: propose reroutes to existing canonical nodes.
- H2: add type-shape grouping once Type/Shape layer lands.
- H2: detect shape drift and near-duplicate intermediate steps.
- H2: synthesize new highway proposals: name, location, signature, skeleton, cycle-safe reroute plan.
- H3: add reuse hotspot metrics and cross-link opportunities into `forces` / `hotspots`.
- MCP: add `analyze_highways`.
- CLI: add `highways <path>` with `--operation`, `--shape`, `--min-routes`, `--propose`, `--trace`, `--json`.
- Every opportunity should emit a token-budgeted context pack: summary, affected routes, evidence, blast radius, proposed canonical node, next safe command.

### Scope Graph + Codebase Map

Represent the codebase as a compound graph agents can query, not just a folder tree or screenshot.

```
codebase graph
  ├─ files
  ├─ symbols
  ├─ types
  ├─ scopes
  ├─ routes
  ├─ sinks
  ├─ tests
  └─ owners
```

**Organization concepts to integrate:**

| Concept | Finding/query it unlocks |
|---|---|
| Bounded contexts | "Who owns this shape, and which files bypass that context?" |
| Canonical data model | `shape-drift`, unsafe DTO leakage |
| Anti-corruption layer | External type crossing an internal boundary |
| Ports & adapters | Route reaches side effect without gateway |
| Dependency direction | Boundary violation, layering inversion |
| Public vs internal API | Forbidden deep import, bypass route |
| Scope cohesion | Junk-drawer module, extraction candidate |
| Escape velocity | File/module pulled by too many scopes |
| Ownership/bus factor | Orphaned critical path |
| Test proximity | Important route has no proof nearby |
| Runtime surface | User-facing entrypoint route maps |

**To do:**

- CLI: add `map <path>` with `--focus`, `--scope`, `--depth`, `--format json|dot|graphml|markdown`, `--context-budget`, `--json`.
- MCP: add `get_codebase_map`, `get_scope_graph`, `get_context_pack`.
- Emit `overview`, `focus`, `route`, `contextPack`, and `evidence` shapes.
- Add optional 2D/3D graph export/viewer only after structured graph outputs are useful.

### Content Drift

Detect mismatch between file/folder labels and actual behavior.

```
declared intent = path + filename + exports + docs
actual behavior = imports + calls + types + side effects + tests + churn
drift score = mismatch(declared intent, actual behavior)
```

**To do:**

- Emit `name-drift`, `scope-drift`, `mixed-responsibility`, `hidden-side-effect`, `shape-drift`, `orphan-scope`, and `misplaced-test`.
- CLI: add `drift <path>` with `--focus`, `--scope`, `--min-score`, `--json`.
- MCP: add `detect_content_drift`.
- Make first run report-only; allow CI gating only after a baseline exists.
- Keep implementation deterministic: tokenized names, resolved symbols/types, imports/calls, side-effect sinks, tests, churn.

### Health Score + Maintainability

Provide one CI-gateable quality score plus file-level risk metrics.

**To do:**

- Add composite `health --score --min-score <n>`.
- Add per-file maintainability index.
- Add CRAP score using static test reachability and optional Istanbul `coverage.json`.
- Extend `hotspots` with complexity x churn x coupling x size.

### Architecture Boundaries

Evaluate repo dependency boundaries using the existing graph.

**To do:**

- Add presets: bulletproof, layered, hexagonal, feature-sliced.
- Add custom `zones` with `autoDiscover`.
- Add `from -> allow/forbid` rules.
- Add `list --boundaries`.
- Emit boundary violations, forbidden cross-edges, and risky re-export chains.

### CI PR Quality Gate

Make PR enforcement easy and local-first.

**Already exists:** `check`, config-level `ci`, `new-only` file gating, text/json/SARIF output.

**To do:**

```bash
codebase-intelligence ci .
codebase-intelligence ci . --base origin/main --new-only
codebase-intelligence ci . --format sarif --output codebase-intelligence.sarif
codebase-intelligence ci . --comment markdown --summary
codebase-intelligence ci . --baseline .codebase-intelligence/baseline.json
```

- Add first-class `ci` wrapper around `check`, `changes`, and selected analyzers behind one PR-friendly contract.
- Default to new findings only on PRs.
- Support `--fail-on error|warn|score`, `--min-score <n>`, `--max-new <n>`, and `--baseline <path>`.
- Keep SARIF output and add GitHub annotations, PR markdown, JSON, and compact terminal summaries.
- Stable exit codes: `0 pass`, `1 gate failed`, `2 invalid config/runtime`, `3 analyzer error`.
- Vendor minimal GitHub/GitLab CI templates.
- Add `doctor --profile ci` checks for workflow wiring, token permissions, baseline path, and SARIF upload setup.

### Doctor + Agent Onboarding

Add a read-only setup auditor for humans, CI, MCP, and coding agents.

**To do:**

```bash
codebase-intelligence doctor
codebase-intelligence doctor --agent codex
codebase-intelligence doctor --agent claude
codebase-intelligence doctor --profile ci
codebase-intelligence doctor --json
```

- Check runtime, package manager, CLI version, project roots, config schema, graph build, cache writability, CLI help, MCP server, CI workflow, docs freshness, and agent instructions.
- Emit JSON with `status`, `checks[]`, `fix`, and `docs`.
- Generate/update Codex, Claude Code, Cursor, MCP, and CI instructions without forking analyzer logic.
- Keep doctor read-only: exact commands, no automatic mutation.

### Output Formats + Actionability

Make findings portable across CI, review, and agents.

**Already exists:** text/json/SARIF for `check`.

**To do:**

- Add missing formatters: CodeClimate, PR-comment, inline review envelopes, CI annotations, health badge, markdown, compact.
- Add line-level filtering via `--diff-file <path>` / `--changed-since <ref>`.
- Add typed `actions[]` to every finding.
- Keep `actions[]` advisory only.

---

## P3 — 2.5.0 Depth + Ergonomics

### Cognitive Complexity

- Add cognitive complexity alongside cyclomatic complexity.
- Expose it in `hotspots`, `file`, `health`, and CI outputs.

### Cohorting + Ownership

- Add `--group-by owner|package|directory`.
- Use CODEOWNERS + git blame for ownership and bus-factor signals.
- Add static coverage-gap detection.
- Add refactor target filtering with `--effort`.

### LSP Diagnostics

- Ship an LSP server over the same operation registry.
- Surface diagnostics for dead code, complexity, boundaries, comments, and future Highways findings.
- Add hover facts: blast radius, fan-in/out, PageRank, dead/clone status.
- Keep code actions navigational/advisory only.

### Architecture Intelligence Depth

- Add ranked extraction/consolidation recommendations.
- Add effort estimates.
- Add layering inference.
- Add seam proposals tied to fan-in/fan-out evidence.

---

## P4 — 2.5.0 Ecosystem Hardening

**To do:**

- Watch mode.
- Monorepo workspace scoping.
- Cross-package circular dependency checks.
- `--changed-workspaces`.
- Config migration from common analyzer configs.
- `explain <rule>`.
- Opt-in secret-leak scan.
- `hooks install`.
- Local finding history for trends.
- `--production` mode that excludes test/dev files.

---

## Market-Derived Gap List

Competitor names stay in docs only. This section exists to preserve comparison context without leaking names into runtime surfaces.

| Tool | Strong surface | Gap/opportunity for us |
|---|---|---|
| Knip | Unused files, dependencies, exports, monorepo/workspace awareness | Match unused/dependency parity, then beat it with graph evidence, context packs, and route/scope ownership. |
| dependency-cruiser | Dependency rule validation, circular dependency checks, visualization, baselines | Match declarative boundaries and baselines; beat it with symbol/type graph, Highways, and prescriptive reroute proposals. |
| Madge | Quick dependency graphs and circular dependency discovery | Make graph export/view UX easy; keep graph richer than file imports. |
| jscpd | Copy/paste and duplicate-code thresholds | Match strict/near clone detection; beat it with semantic shape/route duplication via Highways. |
| Biome | `ci` command ergonomics and fast terminal UX | Add first-class `ci`; keep help/examples predictable for agents. |
| SonarQube/SonarCloud | Quality gates, PR analysis, new-code policy, hosted dashboards | Add local-first gates, baseline/new-only PR behavior, SARIF/annotations, no hosted dependency. |
| ESLint boundaries plugin | Import boundary enforcement in lint pipelines | Offer repo-level graph rules beyond imports: symbols, types, scopes, routes, sinks. |
| Expo/React Native/npm doctor | Setup diagnostics | Make `doctor` product-grade, read-only, JSON-capable, and agent-aware. |
| publint / Are The Types Wrong | Package public-surface validation | Add package-entrypoint/public API health checks for libraries. |

---

## Open Decisions

1. Commit to CSS / utility-class unused analysis, or leave deferred?
2. Commit to template-aware dead code for Vue/Svelte/Angular, or leave deferred?
3. Expose a stable Node.js programmatic API, or stay CLI + MCP?
4. Ship deterministic semantic duplication in H2, or keep exact/renamed/near-miss only?
5. Keep `highways` naming, or use `convergence` / `consolidation`?
6. Should highway synthesis emit proposal metadata only, or also a code skeleton?
7. Generate `schema.json` from zod or hand-maintain it with a drift test?
8. Keep `codebase-intelligence.json`, or choose a shorter config name?
9. Start `map` with JSON only, or include DOT/GraphML/Obsidian-compatible export immediately?
10. Build a first-party local 2D/3D viewer, or export only?
11. Rank context packs by graph metrics first, or by task intent?
12. Name drift command `drift`, `content-drift`, or fold into `check --rule naming/*`?
13. Use report-only first run for drift, then gate only new severe drift?
14. Which doctor profiles ship first: `local`, `ci`, `agent`, `mcp`?
15. Generate agent docs only, or publish first-party Codex/Claude Code skills/plugins from this repo?
16. Keep `.code-visualizer/` ignored forever, or remove it from generated `.gitignore` after one stable release?
17. Name gitignore support `init --gitignore`, a separate command, or something else?
18. Ship `ci` as first-class command, or `check --ci` wrapper?
19. Generate PR markdown only, or integrate with GitHub/GitLab APIs directly?
20. Store baselines in `.codebase-intelligence/baseline.json`, config path, or external artifact?
21. Use one global quality score first, or per-scope scores plus global rollup?

---

## Success Criteria

- **Parity:** dead-code, duplication, circular-dependency, boundary, and PR-gate behavior meets expected TS/JS analyzer baseline with fewer framework false positives.
- **Highways:** the tool finds at least one accepted consolidation opportunity on a mature repo and proposes a canonical path a team can build.
- **Map:** an agent can answer "what owns this shape?", "what routes reach this sink?", and "what files do I need for this task?" from structured graph output.
- **Drift:** the tool flags real file/folder/content mismatch with evidence from names, imports, calls, types, side effects, tests, and churn.
- **Doctor:** a fresh repo gets a complete read-only setup report with exact fix commands for config, graph build, MCP, CI, and agent instructions.
- **Migration:** `.code-visualizer/` migrates to `.codebase-intelligence/` without data loss; new repos can add `.codebase-intelligence/` to `.gitignore`.
- **CI:** maintainers can add one generated workflow and fail PRs only on new severe findings, with SARIF/annotations/summary and stable exit codes.
- **Determinism:** identical inputs produce identical outputs; every finding traces to graph evidence.
