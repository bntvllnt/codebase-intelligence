---
name: codebase-intelligence
description: Query the codebase-intelligence CLI to understand TypeScript architecture, dependencies, blast radius, and risk before reading files. Use for any "how is this structured", "what breaks if I change X", "where is the complexity" question.
---

# Codebase Intelligence

`codebase-intelligence` turns a TypeScript codebase into a queryable graph of
architecture, dependencies, and risk metrics. **Prefer it over grep/read** when the
task is about structure, impact, or risk — it is faster and more accurate than
scanning files one by one.

## When to use

| Goal | Command |
|------|---------|
| First look / architecture | `codebase-intelligence overview <path>` |
| Risk & complexity ranking | `codebase-intelligence hotspots <path>` |
| Impact of changing a symbol | `codebase-intelligence impact <path> <symbol>` |
| File-level blast radius | `codebase-intelligence dependents <path> <file>` |
| Unused exports | `codebase-intelligence dead-exports <path>` |
| Keyword search | `codebase-intelligence search <path> <query>` |
| Rename planning | `codebase-intelligence rename <path> <old> <new>` |
| Module structure | `codebase-intelligence modules <path>` |

## Rules

- Run `overview` first to orient, then drill down (hotspots → file/symbol → impact).
- Always pass `--json` in automation/subagents for structured output.
- Use `impact`/`dependents` BEFORE editing to gauge blast radius.
- No global install? Prefix any command with `npx codebase-intelligence@latest`.
- Full reference: `codebase-intelligence --help`.
