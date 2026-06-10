---
title: Add analyze_module_depth tool with CLI parity
status: backlog
created: 2026-04-29
estimate: 1d
tier: standard
---

# Add analyze_module_depth tool with CLI parity

## Goal
Add a focused tool for ranking modules by architectural depth.

## Scope
Add both interfaces:
- MCP tool: `analyze_module_depth`
- CLI command: `module-depth`

## Output
For each module return:
- `path`
- `interfaceSize`
- `implementationSize`
- `depthScore`
- `leverageScore`
- `localityScore`
- `verdict`: `DEEP | SHALLOW | MIXED`
- short `evidence[]`

## Heuristics
- **Interface size**: exported symbols, public entry points, config surface
- **Implementation size**: internal files/symbols/LOC hidden behind the public surface
- **Depth score**: hidden behavior divided by interface cost
- **Leverage score**: useful behavior reused by many callers
- **Locality score**: change and knowledge concentrated in one place

## Acceptance Criteria
- MCP tool returns ranked modules with stable JSON shape
- CLI command supports table output and `--json`
- command/tool support `--limit` / `limit`
- docs updated in `docs/mcp-tools.md` and `docs/cli-reference.md`
- tests cover one deep-module example and one shallow-module example

## Notes
This should be a narrow, high-signal tool. Avoid mixing in seam detection or force-analysis summary.
