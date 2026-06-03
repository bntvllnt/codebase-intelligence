# Codebase Intelligence — Roadmap

> Deterministic, graph-native codebase intelligence for TypeScript & JavaScript.
> Read-first, agent-native, architecture-aware. No invented findings — every claim is graph-backed evidence a human or agent can inspect.

This roadmap has two tracks:

- **Parity track** — ship the deterministic static-analysis baseline the TS/JS ecosystem expects, so adopting us is never a downgrade.
- **Differentiation track** — ship analysis no competing static tool has, built on our graph engine: **data-flow convergence ("Highways")**, deep architecture intelligence, and an agent-native MCP surface.

The bar: **isomorphic on the basics, materially better on architecture + reuse intelligence.**

---

## 1. Positioning

```
┌──────────────────────────────────────────────────────────────┐
│  The market expects: dead code, duplication, circular deps,   │
│  complexity hotspots, architecture boundaries, CI gates.      │
│  → We MUST match this (Parity track). Table stakes.           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Our moat: a real dependency + call + type graph, and the     │
│  metrics on top of it (PageRank, betweenness, tension,        │
│  bridges, communities, force analysis, process tracing).      │
│  → We do what graph-blind, token-only tools cannot:           │
│     reason about how DATA FLOWS and where it SHOULD converge.  │
└──────────────────────────────────────────────────────────────┘
```

**Where we do NOT compete:**

- **Raw scan speed.** Native-compiled competitors will out-scan a Node + TS Compiler API tool on millisecond benchmarks. We compete on *insight density per run*, not microseconds. (If speed ever blocks adoption, the answer is incremental/cached parsing and a possible native core — not a feature retreat.)
- **Production-runtime tracing** (V8/Istanbul hot-path, cold-path deletion evidence from live traffic, cloud ingestion). That is a separate product with separate infrastructure. Out of scope here; see §7.
- **A plugin for every framework on earth.** We ship framework *awareness* for the high-value few (§5.1), not a permanent plugin-maintenance treadmill.

---

## 2. Current capabilities (baseline)

CLI + MCP, single shared core (`src/core`) for parity:

`overview` · `hotspots` · `file` · `search` (BM25) · `changes` · `dependents` · `modules` · `forces` · `dead-exports` · `groups` · `symbol` · `impact` · `rename` (dry-run) · `processes` · `clusters` (Louvain) · `init`

Graph engine: file dependency graph + call graph (`file::symbol`, type-resolved + text-inferred) + symbol nodes. Metrics: PageRank, betweenness, coupling, cohesion, tension, bridges, escape velocity, seams, locality risks, blast radius, churn (git), cyclomatic complexity, dead exports. Persisted index keyed by HEAD.

---

## 3. Guiding principles

1. **Read-only.** The tool never mutates source. There is no auto-fix. Findings carry agent-applicable `action` hints (what a fix *would* change), but applying them is the agent's or human's job. This keeps the trust model simple and safe in CI and agent loops.
2. **Deterministic.** Same input → same output. No AI-invented findings. Evidence is inspectable.
3. **Agent-native.** Every finding is machine-actionable JSON with an `actions[]` array and stable IDs. MCP is a first-class surface, not an afterthought.
4. **Graph-native differentiation.** If a token-only linter could compute it, it's parity, not moat. Our unique value is graph + type reasoning.
5. **Boundary-only validation, surgical scope.** New analysis = new module under `src/<feature>/`, wired through `src/core`. Never edit hubs.
6. **Maximum test coverage, real fixtures.** No mocking internal modules; real `.ts` fixtures through the real pipeline.

---

## 4. Differentiation track (the moat)

### 4.1 Highways — Data-Flow Convergence, Consolidation & Path Synthesis  ⭐ FLAGSHIP

**The problem.** As a codebase grows, every new feature that creates, transforms, or moves a piece of data tends to wear its own *cowpath* — an ad-hoc route through the call graph — instead of reusing an established route. Over time you get N divergent paths performing the same logical operation on the same data shape. The result: duplicated logic spread across paths, inconsistent validation, drift, and high blast radius when the shape changes. The fix a senior engineer applies by intuition: **pave a highway** — one canonical, reusable path every feature routes through.

**Highways detects this divergence automatically AND proposes the highway to build.** Detection alone is half the value; the system also *synthesizes the recommended unified path* — its name, location, signature, and a step-by-step reroute plan — so a human or agent can act immediately.

This is *not* token duplication (§5.2). Token-dupes find two functions that look alike. Highways finds **structurally divergent routes that accomplish the same data operation** — even when the code looks different — and recommends the canonical node to consolidate them.

```
Today (cowpaths — divergent routes to one logical sink):

  handleSignup ─► buildUserPayload ─────────────────────┐
                                                         ▼
  importUsers  ─► mapCsvRow ─► normalizeUser ──────► POST /users
                                                         ▲
  adminCreate  ─► (inline validate + shape) ────────────┘

  3 features, 3 hand-rolled "create User" paths, 0 shared logic.

Highways recommendation (synthesized + paved highway):

  handleSignup ┐
  importUsers  ┼─► createUser(input): User ─► POST /users
  adminCreate  ┘        ▲ canonical highway (PROPOSED by the system)

  1 path. Validation, shaping, side-effects defined once. Reused 3×.
```

**What it computes** (built entirely on existing graph + planned dupes engine — no new external dependency):

1. **Operation classification.** Tag symbols by data-operation intent: verb class (`create|read|update|delete|fetch|map|transform|parse|validate|serialize|normalize`) inferred from names, plus *sink convergence* — which symbols ultimately reach the same terminal node (a DB module export, an API client call, a store mutation, a shared type constructor).
2. **Shape grouping.** Group operations by `(verb-class, data-shape)`. Data-shape comes from the type layer (§4.2 prerequisite): parameter and return types resolved via the checker. v1 can run name-verb + sink only; v2 adds type-shape for precision.
3. **Path enumeration.** Reuse process tracing: for each operation group, enumerate the distinct call chains from entry points (or nearest stable callers) to the shared sink.
4. **Convergence ratio.** For a group of paths, `convergence = sharedIntermediateNodes / totalNodesAcrossPaths`. Low ratio = the paths re-implement the operation independently (cowpaths). High ratio = already converged (good).
5. **Step similarity.** Overlay duplication fingerprints (§5.2): if the *intermediate steps* across paths are near-duplicates, that's a strong "these should be one function" signal even when the route shapes differ.
6. **Bypass detection.** If a canonical node already exists (a high-fan-in node most callers in the group use) but some callers reach the sink *without* passing through it, flag the **bypassers** — they're skipping the existing highway.

**What it proposes (Path Synthesis — the system designs the highway):**

For every `cowpath-cluster`, the system emits a concrete proposal, in one of two modes:

- **Reroute to existing** — when a viable canonical node already exists in the group (highest fan-in, lowest complexity, broadest shape coverage), recommend it as the highway and list every route that should be rerouted through it.
- **Synthesize new highway** — when no node covers the whole group, *design a new one*:
  - **Name** — derived from `(verb-class + shape)` → `createUser`, `normalizeOrder`, `fetchInvoice`.
  - **Location** — the lowest-common-ancestor module of the participating files, or the shape's owning module (so it's reachable from all routes without new circular deps).
  - **Signature** — synthesized from the union/intersection of the divergent routes' input/return types (type layer §4.2): `createUser(input: UserInput): User`.
  - **Body skeleton** — the common ordered steps extracted across routes (validate → shape → side-effect), with per-route deltas flagged as parameters/options.
  - **Reroute plan** — ordered, per-route edits: "in `handleSignup`, replace `buildUserPayload(...) → post(...)` with `createUser(...)`." Includes a circular-dependency safety check (proposed location must not introduce a cycle — validated against the existing graph) and a blast-radius estimate for the change.

**Findings emitted:**

| Finding | Meaning | Proposal |
|---|---|---|
| `cowpath-cluster` | K divergent paths for one `(operation, shape)` | Build/route highway X; reroute the K paths |
| `bypass-route` | Caller reaches sink without using the existing canonical node | Route through the canonical node |
| `reuse-gap` | Near-duplicate intermediate steps on different paths | Extract one shared step |
| `shape-drift` | Same logical shape constructed inconsistently across paths | Centralize the shape constructor/validator |
| `highway-proposal` | Synthesized canonical path (name + location + signature + reroute plan) | Create new unified highway |

**Prioritization.** `consolidationValue = pathCount × stepSimilarity × shapeSimilarity × churn(involvedFiles)`. Many divergent, churny, near-identical paths = pave this highway first. The output is a *ranked work list*: "consolidate these 5 routes into one `createUser` highway — highest payoff in the repo."

**Output shape (JSON, agent-actionable):**

```jsonc
{
  "highways": [
    {
      "id": "hw_create_user",
      "operation": "create",
      "shape": "User",
      "sink": "src/api/client.ts::post",
      "convergenceRatio": 0.12,
      "consolidationValue": 0.87,
      "routes": [
        { "entry": "src/auth/signup.ts::handleSignup",  "chain": ["handleSignup","buildUserPayload","post"] },
        { "entry": "src/import/csv.ts::importUsers",     "chain": ["importUsers","mapCsvRow","normalizeUser","post"] },
        { "entry": "src/admin/users.ts::adminCreate",    "chain": ["adminCreate","post"] }
      ],
      "proposal": {
        "mode": "synthesize-new",
        "name": "createUser",
        "location": "src/user/create-user.ts",
        "signature": "createUser(input: UserInput): User",
        "commonSteps": ["validate", "shape", "post"],
        "introducesCycle": false,
        "estimatedBlastRadius": 3,
        "reroute": [
          { "site": "src/auth/signup.ts::handleSignup", "replace": "buildUserPayload→post", "with": "createUser" },
          { "site": "src/import/csv.ts::importUsers",    "replace": "normalizeUser→post",   "with": "createUser" },
          { "site": "src/admin/users.ts::adminCreate",   "replace": "inline→post",          "with": "createUser" }
        ]
      },
      "evidence": { "stepSimilarity": 0.71, "churn": 23, "duplicatedTokens": 184 },
      "actions": [
        { "kind": "extract-canonical", "auto_fixable": false, "reroute": ["handleSignup","importUsers","adminCreate"] }
      ]
    }
  ]
}
```

**Surfaces:**
- CLI: `codebase-intelligence highways <path>` with `--operation <verb>`, `--shape <Type>`, `--min-routes <n>`, `--propose` (emit synthesized highways, default on), `--trace <id>` (deep-dive one opportunity), `--json`.
- MCP: `analyze_highways` — "where should this codebase consolidate data paths, and what canonical path should I build?" Perfect agent question before a refactor; the agent gets both the diagnosis and the proposed highway.

**Why only we can do this.** It composes our call graph + type layer + duplication fingerprints + churn + process tracing into one analysis. A token-only or dead-code-only tool has none of these as a connected graph. This is the single most defensible feature on the roadmap.

**Phasing:**
- **H1** — name-verb classification + sink convergence + path enumeration + cowpath/bypass findings + reroute-to-existing proposals (no type layer required).
- **H2** — add type-shape grouping (depends §4.2), shape-drift findings, step-similarity from dupes engine, and **synthesize-new** proposals (name + location + signature + skeleton + cycle-safe reroute plan).
- **H3** — `hotspots --metric reuse` (files ranked by divergent-path participation); highway opportunities cross-linked into `forces` output.

### 4.2 Type/Shape layer (prerequisite + standalone value)

Extend the parser to capture, per symbol, resolved parameter types and return type (checker already available in `parseFile`). Stored compactly on `ParsedFile`. Unlocks:
- Highways shape grouping and signature synthesis (§4.1 H2).
- Type-aware dead code (unused types, params).
- Future: "which functions produce/consume shape X" queries via MCP.

### 4.3 Architecture intelligence depth (extend, don't restart)

We already have tension, bridges, seams, communities. Push further into *prescriptive* output: ranked extraction/consolidation recommendations with effort estimates, layering inference, and "this module is doing two jobs — split here" seam proposals tied to real fan-in/fan-out evidence.

---

## 5. Parity track (table stakes)

### 5.1 Framework & entry-point awareness  (P0 — fixes real false positives)

Today, framework-consumed exports and path-aliased imports produce false dead-export reports. Ship lightweight awareness for the high-value few — **not** a universal plugin zoo:

- Next.js (route exports, `generateMetadata`, `generateStaticParams`, server actions), React Router/Remix loaders/actions, Convex functions, Vite/Vitest config & test conventions, package.json `exports`/`bin`/`scripts` entry inference.
- Resolve `tsconfig` path aliases and config aliases as real entry points.

This is a **correctness fix**, prioritized first.

### 5.2 Duplication detection  (P0)

Token/structure clone detection on the existing AST path (TS scanner; no LSP — batch problem, full Program access already in hand):

- Tiers/modes: `strict` (exact), `mild`/`weak` (renamed-identifier + near-miss via k-gram shingling + bucketing). Clone *families* (groups), `--min-tokens` noise floor, `--skip-local` (cross-directory only), `--trace <id>` deep-dive.
- A `semantic` mode (same behavior, different structure) is a later addition once the type/shape layer (§4.2) lands — it matches on shape signatures, **not** embeddings, to stay deterministic. (Open — §8.)
- Feeds the Highways step-similarity signal (§4.1).

### 5.3 Dead code beyond exports  (P1)

Extend dead-exports to: unused files, unused types, unused enum/class members, and dependency hygiene (unused / unlisted / type-only / test-only `package.json` deps). Reuses the existing import graph.

### 5.4 Health score, maintainability & CRAP  (P1)

Single composite **0–100 + letter grade**, computed from existing + new metrics (complexity, duplication, dead code, circular deps, tension). CI-gateable: `health --score --min-score <n>`. One number agents and pipelines can fail on.

- **Per-file maintainability index** (`--file-scores`) — Halstead/complexity-based 0–100 per file.
- **CRAP score** — change-risk anti-pattern = cyclomatic × (1 − coverage)². Reads static test reachability, or an Istanbul `coverage.json` when provided (`--coverage <path>`). Deterministic, no runtime tracing.
- **Refactor hotspots** — composite complexity × churn × coupling × size ranking (extends existing `hotspots`).

### 5.5 Declarative architecture boundaries  (P1)

Layer the existing module/cluster graph with *rules*:

- Presets (bulletproof, layered, hexagonal, feature-sliced) + custom `zones` (with `autoDiscover`) and `from → allow/forbid` rules. `list --boundaries` prints the expanded rule set.
- Findings: boundary violations, forbidden cross-edges, re-export chains. We already compute the graph — this adds rule evaluation on top.

### 5.6 Audit gate (PR risk)  (P1)

Extend `changes` into a gate: `--base <ref>`, `--gate new-only|all`, baseline files, `--fail-on-regression`, `--tolerance <pct>`, and **new-vs-pre-existing attribution** so PRs only fail on what they introduced.

### 5.7 Output formats & actionability  (P1)

- Add `--format` outputs: SARIF (GitHub Code Scanning), CodeClimate (GitLab Code Quality), PR-comment (GitHub/GitLab), inline review envelopes (GitHub/GitLab), CI annotations, health badge, markdown, compact — over the existing result objects.
- Ship a vendored **GitLab CI template** alongside the GitHub Action.
- `--diff-file <path>` / `--changed-since <ref>` for line-level filtering of findings to changed code.
- Add a typed `actions[]` array with stable finding IDs to every finding's JSON. Actions are **advisory hints** — they describe what a fix would change so an agent or human can apply it; the tool itself never writes (§3, §7). This makes findings agent-actionable without making the tool mutating.

### 5.8 Suppressions  (P1)

`// ci-ignore-next-line <rule>`, `// ci-ignore-file`, JSDoc `@public`/`@internal`/`@expected-unused`, and **stale-suppression detection** (flag suppressions that no longer match a finding).

### 5.9 Cognitive complexity  (P2)

Add cognitive complexity alongside cyclomatic in the parser.

### 5.10 Cohorting & ownership  (P2)

`--group-by owner|package|directory`, bus-factor / ownership via git blame + CODEOWNERS, refactor targets with `--effort` filtering, static coverage-gap detection (we already match test files to sources).

### 5.11 Ecosystem & adoption  (P2–P3)

Watch mode, monorepo workspace scoping (cross-package circular deps, `--changed-workspaces`), config migration from common existing tools (`migrate`), `explain <rule>` docs, opt-in secret-leak scan.

- **`init` config generator** — scaffold `codebase-intelligence.json` with detected entry points and sensible rule defaults.
- **`hooks install`** — pre-commit / agent gate that runs `check` on staged files.
- **`impact`** — local, gitignored history of which findings surfaced and gated, for trend reporting.
- **`--production`** — exclude test/dev files from any analysis.

### 5.12 LSP server — live editor diagnostics  (P2)

A Language Server Protocol server so findings appear **live in the editor as you type**, in any LSP-capable editor — without shipping a bespoke per-editor extension.

- Surfaces rule findings (dead exports, complexity, boundary violations, comments, …) as diagnostics.
- **Hover** shows graph facts on a symbol: blast radius, fan-in/out, PageRank, dead/clone status.
- **Code actions** are navigational/advisory only (go to dependents, trace a highway, insert a suppression) — never mutating, consistent with the read-only principle (§3).
- Inline reference/usage counts.

This is the editor surface. It does **not** change how batch analysis runs — duplication and Highways still use the Compiler API directly (§7). The LSP is a thin presentation layer over the same engine.

---

## 6. Sequencing

```
P0  (correctness + flagship foundations)
  ├─ Framework/entry-point awareness        §5.1   (fixes FP bugs)
  ├─ Duplication detection                   §5.2
  └─ Type/Shape layer                        §4.2   (Highways prereq)

P1  (parity bar + flagship H1/H2)
  ├─ Highways H1 (cowpaths/bypass/reroute)   §4.1
  ├─ Dead code beyond exports                §5.3
  ├─ Health + maintainability + CRAP         §5.4
  ├─ Architecture boundaries (+ presets)     §5.5
  ├─ Audit gate (+ diff-file)                §5.6
  ├─ Output formats + actions[] (advisory)   §5.7
  ├─ Suppressions                            §5.8
  └─ Highways H2 (type-shape, drift, synth)  §4.1

P2  (depth + ergonomics)
  ├─ Highways H3 (reuse hotspot metric)      §4.1
  ├─ Cognitive complexity                    §5.9
  ├─ Ownership / cohorting / targets         §5.10
  ├─ LSP live diagnostics                    §5.12
  └─ Architecture intelligence depth         §4.3

P3  (ecosystem)
  └─ Watch, monorepo scope, migrate, explain,
     secrets, init, hooks, impact            §5.11
```

**Rule of sequencing:** correctness before breadth (P0 fixes existing false positives), the flagship rides on P0 foundations, parity fills out P1, depth and ecosystem follow.

---

## 7. Explicitly out of scope

**Deliberate non-features** (we could, we won't):

- **Auto-fix / source mutation.** The tool is read-only (§3). It reports and advises; it never rewrites code. `actions[]` are hints for an agent/human to apply, not edits the tool performs.
- **First-party VS Code extension.** The LSP server (§5.12) delivers editor diagnostics to *any* LSP-capable editor; we don't maintain a bespoke per-editor extension.
- **Production-runtime layer** — live-traffic hot/cold path tracing, V8/Istanbul runtime ingestion, cloud sync, deletion-from-traffic evidence. Different product, different infra, different trust model.
- **Universal framework plugin catalog** — we do the high-value few (§5.1) and let config cover the rest, not a 100+ plugin treadmill.
- **LSP as an analysis engine** — duplication and Highways are whole-program *batch* problems run on the Compiler API. The LSP server (§5.12) is a presentation layer only; it does not run batch analysis per keystroke.

**Parity gaps consciously deferred** (free in competing tools; not yet committed — see §8):

- **CSS / utility-class unused analysis** (Tailwind/PostCSS/UnoCSS). Niche; off our graph/architecture moat.
- **Template-aware dead code** (Vue/Svelte/Angular templates). Requires parsing beyond `.ts/.tsx` — a real engine expansion. Until done, dead-code accuracy on those stacks is lower.
- **Node.js programmatic bindings** (library API). We ship CLI + MCP; a stable embeddable API is a separate commitment.

---

## 8. Open decisions

**Resolved:** read-only — no auto-fix (§3, §7) · LSP server yes (§5.12) · first-party VS Code extension no (§7).

Still open:

1. **CSS unused analysis** — commit to parity, or leave deferred (§7)?
2. **Template-aware dead code** (Vue/Svelte/Angular) — commit (engine expansion beyond `.ts/.tsx`), or leave deferred? Highest-cost parity gap.
3. **Node.js programmatic bindings** — expose the core as an embeddable library, or stay CLI + MCP only?
4. **Semantic duplication mode** — ship the 4th (shape-based, deterministic) mode in H2, or keep to exact/renamed/near-miss?
5. **Highways naming** — `highways` / `analyze_highways`, or `convergence` / `consolidation`? (Leaning `highways`.)
6. **Highway synthesis depth** — proposal metadata only (name + location + signature + reroute plan), or also emit a code skeleton an agent can apply? (Tool stays read-only either way.)
7. **`schema.json` source of truth** — generate from zod (`zod-to-json-schema`) or hand-maintain with a drift test?
8. **Config file name** — `codebase-intelligence.json` primary, or a shorter brand?
9. **v1 framework awareness scope** — the 5 listed (§5.1), or a config-driven mini-plugin contract from day one?

---

## 9. Success criteria

- **Parity:** on a representative repo, our dead-code, duplication, circular-dep, and boundary findings are a superset-or-equal of what a developer would expect from a mainstream analyzer, with fewer false positives on framework code.
- **Differentiation:** Highways surfaces at least one *real, accepted* consolidation opportunity on a mature repo that no token/dead-code tool reports — **and proposes a canonical path the team actually builds.**
- **Agent-native:** every finding has a stable ID + `actions[]`; an agent can run one MCP call and get a ranked, machine-actionable work list including the proposed highway.
- **Determinism:** identical inputs → identical outputs, every finding traceable to graph evidence.
