---
title: Extend analyze_forces with architecture signals
status: backlog
created: 2026-04-29
estimate: 1d
tier: standard
---

# Extend analyze_forces with architecture signals

## Goal
Make `analyze_forces` more useful for architecture review by adding simple derived signals instead of only cohesion/tension/extraction output.

## Scope
Update both interfaces:
- MCP: extend existing `analyze_forces`
- CLI: extend existing `forces` command

## Add
- `shallowModules[]`
- `deepModules[]`
- `seamCandidates[]`
- `localityRisks[]`

## Heuristics
- **Shallow module**: interface surface is large relative to hidden behavior
- **Deep module**: small public surface, large hidden behavior, reused by many callers
- **Seam candidate**: clear interface point where behavior could vary
- **Locality risk**: understanding or changing one concept requires bouncing across many files

## Acceptance Criteria
- `analyze_forces` returns the new fields in MCP JSON
- `forces --json` returns the same fields
- human CLI output prints short sections for shallow/deep/seam/locality
- existing force analysis output remains intact
- docs updated in `docs/mcp-tools.md` and `docs/cli-reference.md`
- tests cover at least one shallow-module and one locality-risk case

## Notes
Keep heuristics simple and explainable. Every flagged item should include evidence, not just a score.
