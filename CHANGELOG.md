# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.4.0...HEAD
[2.4.0]: https://github.com/bntvllnt/codebase-intelligence/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/bntvllnt/codebase-intelligence/releases/tag/v2.3.0
