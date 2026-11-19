# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Upgrade `@modelcontextprotocol/sdk` to 1.32.2, which addresses request-size, session and OAuth issues in the SDK.
- Upgrade Vitest to 4.1.11 (lockfile resolves 4.1.12) so the tree no longer depends on vulnerable `tinypool` 1.1.1.
- Pin `vite` 7.3.7 and add `pnpm.overrides` for transitive advisories that a direct bump cannot reach: `proxy-addr` 2.0.8, `body-parser` 2.4.0, `fast-uri` 3.1.9, `ip-address` 10.7.6, `hono` 4.13.18, `path-to-regexp` 8.4.0, `source-map-js` 1.2.2, `brace-expansion` 2.1.7 and 5.0.12, `postcss` 8.5.23, `flatted` 3.4.2, and `nanoid` 3.3.18. Each pinned version is a release at least seven days old.
- `zod` stays on the 3.x line (`^3.23.0`, locked at 3.25.76). This package only imports the Zod 3 API (`import { z } from "zod"`). GHSA-mrhx-c7xc-m3w5 is in the `$ZodArray` / `handleArrayResult` path, which is the Zod 4 parser; upgrading to 4.x would be a breaking change for a runtime dependency without a clear need.

### Added

- **MCP contract coverage now exercises the remaining explicit todo stories.**
  Search responses are verified as file-grouped with symbol locations and
  `nextSteps`; `symbol_context` is verified for `AuthService`; `detect_changes`
  is verified against a real non-git directory.
- **Durable verification scripts and e2e coverage now replace one-off checks.**
  `verify:cli-real` runs the real compiled CLI against this repo plus available
  sibling real codebases, `test:coverage` uses the stable Vitest runner flags,
  MCP stdio starts through the compiled CLI in an e2e test, and the `init` TTY
  picker is exercised through a pseudo-terminal.

### Fixed

- **`detect_changes` no-git errors no longer leak raw `git diff` usage output.**
  The command now suppresses git stderr and returns the structured
  `Git not available or not in a git repository` error with recovery steps.

## [2.5.0-canary] - 2026-06-30

> Canary base for 2.5.0. Merging to `main` publishes `2.5.0-canary.<sha>` with
> the npm `canary` tag; no stable 2.5.0 release has been cut.

### Changed

- **Base package version moved to `2.5.0` for canary publishing.** The publish
  workflow derives canaries from `package.json`, so this produces
  `2.5.0-canary.<sha>` artifacts while release creation remains manual.
- **CLI docs now include the full 17-command surface.** `check` is documented
  alongside the 15 analysis commands and `init`, matching `--help`.

### Fixed

- **`changes <target>` now analyzes the target repo, not the caller's cwd.** Git
  diff commands run in the requested root with relative paths, so cross-repo
  reviews no longer report the wrong files.
- **`file` accepts paths returned by other commands.** Exact graph paths like
  `src/...` or `app/...` are tried before common-prefix stripping.
- **Subcommand `--force` now consistently bypasses cache.** Analysis commands
  honor command-local and global `--force` flags.
- **Monorepo package parsing honors parent `.gitignore` files.** Generated
  directories such as `.next/` are excluded when the target path is a package
  below the repo root.
- **Invalid enum-like CLI options fail with exit code 2.** Unknown
  `hotspots --metric`, `changes --scope`, and `check --gate` values now return a
  clear usage error instead of silently producing misleading output.
- **`pnpm test` now rebuilds before running dist-backed CLI E2E tests.** This
  prevents stale `dist/cli.js` from masking source changes without parallel
  rebuild churn, and runs Vitest with forked non-parallel file execution to avoid
  worker progress RPC timeouts on the heavy real-codebase suites.

## [2.4.1] - 2026-06-01

### Fixed

- **`--help` rendered the command list twice.** The program description embedded a
  hand-maintained command list that commander also auto-generates, producing two
  command sections with contradictory `init` descriptions — the manual one stale,
  claiming the global skill installs by default (it is opt-in since 2.4.0). The manual
  list is removed; commander is now the single source, with the MCP-mode and starter
  hints appended after it via `addHelpText`.

### Added

- **`init` lifecycle E2E tests** (`tests/cli-init.e2e.test.ts`) — spawn the real binary
  across every mode (`--json`, default, `--all`, `--agents`, unknown-id, empty
  selection, idempotent re-run, missing path, `--skill` opt-in), plus `promptSelection`
  non-TTY fallback tests. The CLI action layer was previously uncovered.

## [2.4.0] - 2026-06-01

### Added

- **`init` command** — agent adoption layer. `codebase-intelligence init [path]` writes
  an idempotent, marked instruction block ("query CI before grep/read") into each
  selected agent's repo file (`AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/codebase-intelligence.mdc`, `.github/copilot-instructions.md`,
  `GEMINI.md`, `CONVENTIONS.md`) and optionally installs a portable skill to
  `~/.claude/skills/codebase-intelligence/SKILL.md`.
  - **Opt-in by design** — nothing is written unless chosen. On a TTY, an interactive
    picker (`AGENTS.md` + `CLAUDE.md` preselected); non-interactively, those two by
    default. The global skill installs only with `--skill`.
  - `--agents <list>` to select explicitly, `--all` for every agent, `--yes` for
    non-interactive defaults, `--json` for machine-readable output.
  - Writes are idempotent — only content between the
    `codebase-intelligence:start`/`:end` markers is ever touched; existing user content
    is preserved.
- **`src/install/` module** — managed-block upsert engine, per-agent target registry,
  and shared block/skill content (single source of truth).
- **Registry skill** — `skills/codebase-intelligence/SKILL.md`, installable via
  `ags install codebase-intelligence` or `npx skills add`.

### Changed

- Docs updated for the new command: `README.md`, `docs/cli-reference.md`,
  `docs/architecture.md`, `llms.txt`, `llms-full.txt`.

## [2.3.0] - 2026

Baseline for this changelog. For release history prior to and including 2.3.0, see the
[git tags](https://github.com/bntvllnt/codebase-intelligence/tags) and commit history.

[Unreleased]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.4.1...HEAD
[2.5.0-canary]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.4.1...HEAD
[2.4.1]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/bntvllnt/codebase-intelligence/releases/tag/v2.3.0
