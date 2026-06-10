---
title: Add find_seams tool and adapter detection with CLI parity
status: backlog
created: 2026-04-29
estimate: 1d
tier: standard
---

# Add find_seams tool and adapter detection with CLI parity

## Goal
Help agents find where behavior can vary and which concrete adapters exist.

## Scope
Add both interfaces:
- MCP tool: `find_seams`
- CLI command: `seams`

## Output
Return:
- `seams[]`
  - `name`
  - `contract`
  - `callers`
  - `adapters[]`
  - `status`: `HYPOTHETICAL | REAL | LEAKY`
  - `evidence[]`
- `adapterPatterns[]`
- `summary`

## Rules
- **Hypothetical seam**: one adapter behind a contract
- **Real seam**: two or more adapters behind a contract
- **Leaky seam**: callers know adapter-specific details they should not need to know

## Detection Signals
- shared interface/type used by multiple implementations
- sibling files with same role but different backing dependencies
- injected dependencies or provider-style construction
- duplicated exported API shape across files

## Acceptance Criteria
- MCP tool returns seam/adapter analysis in JSON
- CLI command prints concise seam summaries and supports `--json`
- every seam includes evidence for why it was detected
- docs updated in `docs/mcp-tools.md` and `docs/cli-reference.md`
- tests cover one hypothetical seam and one real seam case

## Notes
Prefer confidence + evidence over aggressive detection. False positives will reduce trust quickly.
