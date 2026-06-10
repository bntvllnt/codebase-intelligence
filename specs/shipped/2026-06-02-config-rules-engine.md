# Spec: Config, Rules Engine & CI Gate

Status: shipped (2026-06-10, PR #42) · Created: 2026-06-02 · Depends on: `schema.json`, `codebase-intelligence.json`

Adds a declarative config, an ESLint-style rules engine, and a CI gate so the tool can fail builds on policy violations (including a `no-comments` rule).

---

## 1. Config discovery & loading

### File names (first match wins)
```
1. codebase-intelligence.json          (recommended, greppable)
2. .codebase-intelligence.json
3. .codebase-intelligencerc.json
4. .codebase-intelligencerc            (parsed as JSON)
5. package.json  → "codebaseIntelligence" key
```
Search from `--root` (or cwd) upward to the git root / filesystem root. `--config <path>` overrides discovery. No config = built-in defaults (every rule at its default severity).

### Loading pipeline
```
find file → read → JSON.parse → zod validation → normalized Config
                                      │ fail
                                      ▼
                          exit 2 + precise path (e.g. rules.no-comments[1].style)
```
- `schema.json` (already written) powers editor autocomplete via `$schema`.
- `zod` (already a dependency) is the runtime source of truth. The zod schema and `schema.json` must stay in sync — generate `schema.json` from zod with `zod-to-json-schema` in a build step (preferred) or keep a parity test that fails on drift.

New module: `src/config/index.ts` — `loadConfig(root, cliOverrides): Config`. Types in `src/types/index.ts`.

---

## 2. Rules engine (ESLint-style)

### Concepts
```
Config.rules ──► Rule registry ──► for each enabled rule: run(ctx) ──► Finding[]
                                                                  │
                          suppressions filter ◄──────────────────┘
                                                                  │
                                              formatter ──► output + exit code
```

### Severity
`"off" | "warn" | "error"` (also `0 | 1 | 2`). Rule value is `Severity` or `[Severity, Options]` — exactly the shape in `schema.json`.

### Rule contract
```ts
interface Rule<O = unknown> {
  id: string;                       // "no-comments"
  meta: {
    description: string;
    category: "architecture" | "cleanup" | "complexity" | "duplication" | "style" | "reuse";
    fixable: boolean;
  };
  defaultSeverity: Severity;
  optionsSchema?: z.ZodType<O>;     // validated; defaults applied
  run(ctx: RuleContext, options: O): Finding[];
}
```

### Rule context (everything a rule can read — read-only)
```ts
interface RuleContext {
  graph: CodebaseGraph;             // existing dependency + call + symbol graph
  files: ParsedFile[];              // existing parsed metadata
  sourceOf(file: string): string;   // raw text, lazily read+cached (for source-level rules)
  config: Config;                   // for boundaries, entries, etc.
}
```
Graph-level rules (circular deps, dead exports, duplication, boundaries, divergent-paths) read `graph`/`files`. Source-level rules (comments) use `sourceOf` + the TS scanner. Most data already exists; only `sourceOf` is new.

### Finding
```ts
interface Finding {
  ruleId: string;
  severity: "warn" | "error";
  file: string;
  line: number; column: number;
  endLine?: number; endColumn?: number;
  message: string;
  actions?: Array<{ kind: string; auto_fixable: boolean; /* edit payload */ }>;
  fingerprint: string;              // stable id for baselines + dedup
}
```

### Registry
`src/rules/index.ts` exports `ALL_RULES`. One file per rule: `src/rules/no-comments.ts`, `src/rules/no-circular-deps.ts`, … Adding a rule = add a file + register. No hub edits beyond the registry array.

### Suppressions (honored by the engine, not per rule)
- `// ci-ignore-next-line <ruleId,...>`
- `// ci-ignore-file <ruleId,...>`
- JSDoc `@public` / `@internal` / `@expected-unused` for dead-code rules.
- Stale suppressions (suppress a rule that produced no finding) are themselves reported by `no-stale-suppressions`.

---

## 3. `no-comments` rule (the requested rule)

`src/rules/no-comments.ts`. Source-level. Enumerate comment trivia via `ts.createScanner(..., /*skipTrivia*/ false)` or `ts.getLeadingCommentRanges` per token; classify each as `SingleLineCommentTrivia` (`//`) or `MultiLineCommentTrivia` (`/* */`, JSDoc when it starts `/**`).

### Options (defaults match the repo's own TS standard: forbid `//`, keep TSDoc)
```jsonc
{
  "style": "line",            // "line" | "block" | "all"
  "allowJSDoc": true,         // /** ... */ allowed
  "allowDirectives": true,    // @ts-expect-error, @ts-ignore, eslint-disable, ci-ignore
  "allowLicenseHeader": true, // a comment at byte 0 of the file
  "allow": []                 // extra allowed substrings: "TODO", "@public", ...
}
```

### Decision table (per comment)
```
is JSDoc (/**) ............... allowJSDoc?           → allow : report
is directive (^\s*(@ts-|eslint-|ci-ignore)) . allowDirectives? → allow : report
is file-leading (pos==0) ..... allowLicenseHeader?  → allow : report
matches an `allow` pattern ... → allow
kind vs style:
  style "line"  → report // only
  style "block" → report /* */ only
  style "all"   → report both
```
Each violation → Finding at the comment's line/column, message `"Comments are not allowed (no-comments)"`, with an advisory action `{ kind: "remove-comment", auto_fixable: true, range }` — a hint an agent/human can apply. The tool itself never edits (read-only — §5).

### To forbid ALL comments
`"no-comments": ["error", { "style": "all", "allowJSDoc": false, "allowDirectives": false, "allowLicenseHeader": false }]`.

### Tests (real fixtures, no mocks)
Fixture dir with: a `//` comment, a `/* */` block, a `/** */` JSDoc, a leading license header, a `// @ts-expect-error`, a `// TODO`. Assert each option toggles the expected findings.

---

## 4. CI gate

### New command
`codebase-intelligence check <path>` — load config, run all enabled rules, format, exit. (Alias the rules run into existing analyses so one command covers everything.)

### Exit codes
```
0  no findings at/above failOn severity
1  findings at/above failOn (or warnings > maxWarnings, or regression > tolerance)
2  config/usage error (invalid config, bad ref, no files)
```

### Flags (override config.ci / config.output)
```
--config <path>          --format text|json|sarif|markdown|annotations|pr-comment-*|badge
--base <ref>             --gate all|new-only        (only fail on new findings vs base)
--fail-on error|warn|never                          --max-warnings <n>
--baseline <path>        --save-baseline <path>     --tolerance <pct>
--quiet  --summary  --no-cache
```

### new-only attribution
With `--gate new-only --base origin/main`: compute findings on HEAD, map fingerprints to base (or to `--baseline` file), report only fingerprints not in base. Reuses the existing `changes` git plumbing.

### GitHub Action (usage)
```yaml
- run: npx codebase-intelligence check . --gate new-only --base origin/${{ github.base_ref }} --format sarif > ci.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: ci.sarif }
```

### Generic CI (any system)
```bash
npx codebase-intelligence check . --base origin/main --format json --quiet
# exit 1 fails the job when a rule at >= failOn fires on new code
```

---

## 5. Auto-fix — out of scope (read-only tool)
The tool never mutates source. There is **no `fix` command**. Findings carry `actions[]` describing what a fix *would* change (with an `auto_fixable` flag) so an **agent or human** can apply them — but applying is never the tool's job. Keeps the trust model simple and safe in CI and agent loops. (Roadmap §3, §7.)

---

## 6. Files & sequencing

```
src/config/index.ts        NEW  — discovery, JSON parse, zod validate, normalize
src/types/index.ts         EDIT — Config, Rule, Finding, Severity
src/rules/index.ts         NEW  — ALL_RULES registry + runEngine(ctx, config)
src/rules/no-comments.ts   NEW  — first concrete rule (requested)
src/rules/no-circular-deps.ts ... wrap existing analyses as rules incrementally
src/core/index.ts          EDIT — computeCheck() wrapper (CLI+MCP parity)
src/cli.ts                 EDIT — `check` subcommand, exit codes (read-only)
src/mcp/index.ts           EDIT — `check` MCP tool returning findings + actions
src/formatters/*.ts        NEW  — text, json, sarif, annotations, pr-comment, badge
schema.json                DONE — editor/CI schema (generate from zod to prevent drift)
codebase-intelligence.json DONE — example/default config (this repo)
src/**/*.test.ts           NEW  — real fixtures per rule + config loader + exit codes
```

Order: config loader + types → engine + `no-comments` (end-to-end vertical slice, shippable) → `check` command + exit codes → formatters (json, sarif first) → wrap remaining analyses as rules → MCP tool.

---

## 7. Open questions
1. Config file name — ship `codebase-intelligence.json` as primary, or a shorter brand? (Names are a public contract once published.)
2. `schema.json` source of truth — generate from zod (add `zod-to-json-schema` dev dep) or hand-maintain with a drift test?
3. `no-comments` default when enabled — forbid `//` only (matches repo standard), or default to `style:"all"`?
4. Does `check` replace/supersede `changes`, or sit beside it?
5. ~~Auto-fix~~ — **resolved: no auto-fix, tool is read-only** (roadmap §3, §7).
