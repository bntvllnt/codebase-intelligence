# Spec: Agent Adoption — `init` command

## Problem

codebase-intelligence has the data (architecture, impact, risk metrics) but AI coding
agents don't *use* it. They default to grep/read. Missing layer: durable, in-repo
instructions + a portable skill that tell agents "query CI first."

This is the adoption/distribution layer — persistent agent instructions + an installable
skill — implemented natively in TypeScript. No new runtime deps, no LLM, no Python.

## Goal

One command — `codebase-intelligence init [path]` — that:
1. Writes a managed instruction block into per-agent repo files (6 agents).
2. Installs a portable Claude skill (`~/.claude/skills/`).
3. (Maintainer side) ship a registry-ready SKILL.md for skills.sh / `ags install`.

## Design

```
init [path]
  ├── installRepoFiles(repoRoot, targets)   → Layer 1 (committed, team-wide)
  └── installGlobalSkill(homeDir)           → Layer 2 (per-dev Claude skill)

renderBlock()  ── single source of truth ──► upsertManagedBlock() ──► each target file
renderSkill()  ── single source of truth ──► SKILL.md (global + registry)
```

### Managed-block engine (correctness core)

`upsertManagedBlock(existing, block, markers) -> string` — pure, fs-free.

- no markers in `existing` → append block (preserve original).
- markers present → replace between (preserve content before & after).
- empty `existing` → block only.
- idempotent: f(f(x)) == f(x).

Markers (HTML comments, work in all markdown/.mdc):
```
<!-- codebase-intelligence:start (auto-generated — edits here are overwritten) -->
<!-- codebase-intelligence:end -->
```

### Agent target table (single source, adapters differ by path/preamble)

| id | repo file | preamble |
|----|-----------|----------|
| agents | `AGENTS.md` | — (cross-agent std; covers Codex) |
| claude | `CLAUDE.md` | — |
| cursor | `.cursor/rules/codebase-intelligence.mdc` | mdc frontmatter |
| copilot | `.github/copilot-instructions.md` | — |
| gemini | `GEMINI.md` | — |
| aider | `CONVENTIONS.md` | — |

### Instruction block content

Discovery-first mandate ("use BEFORE grep/read for architecture/impact/risk") +
command cheatsheet table + `--json` note + MCP pointer.

### Global skill / registry

- `installGlobalSkill` → `~/.claude/skills/codebase-intelligence/SKILL.md` (skill = Claude concept).
- Registry: commit `skills/codebase-intelligence/SKILL.md` + README `ags install` / `npx skills add` docs.
  skills.sh directory submission = manual web/PR step (flagged, can't automate).

## State Machine

N/A — Stateless. Each `init` run is an idempotent upsert (input files → output files).
No transitions; re-runnable to convergence.

## Test Plan (real fs, temp dirs — no mocks)

- upsertManagedBlock: empty / append / replace / idempotent / preserve-outside.
- installRepoFiles: creates all targets, merges into pre-existing CLAUDE.md without clobber.
- renderBlock/renderSkill: contain mandate keywords + command names.

## Out of Scope

- Auto-indexing on init (block tells agent to run overview).
- Non-Claude global skill dirs (other agents covered by repo files + ags distribution).
- Visualization / narrative report / multimodal outputs (separate, future work).
