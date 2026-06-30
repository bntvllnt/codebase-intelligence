<div align="center">

# codebase-intelligence

**CLI-first codebase analysis for TypeScript projects.**

Parse your codebase, build a dependency graph, compute architectural metrics, and query everything from your terminal/CI. MCP support is included as an optional secondary interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)

</div>

---

## Quick Start

### CLI (recommended)

```bash
npx codebase-intelligence overview ./src
```

Common workflows:

```bash
npx codebase-intelligence hotspots ./src --metric complexity --limit 10
npx codebase-intelligence opportunities ./src --limit 10
npx codebase-intelligence impact ./src parseCodebase
npx codebase-intelligence dead-exports ./src --limit 20
npx codebase-intelligence changes ./src --json
```

### MCP (optional)

```bash
claude mcp add -s user -t stdio codebase-intelligence -- npx -y codebase-intelligence@latest .
```

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Agent Adoption](#agent-adoption)
- [MCP Integration (Secondary)](#mcp-integration-secondary)
- [Metrics](#metrics)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Limitations](#limitations)
- [Release](#release)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Features

- **18 CLI commands** for architecture analysis, dependency impact, improvement opportunities, dead code detection, search, CI rules, and agent setup
- **Machine-readable JSON output** (`--json`) for automation and CI pipelines
- **Auto-cached index** in `.code-visualizer/` for fast repeat queries
- **11 architectural metrics** — PageRank, betweenness, coupling, cohesion, tension, churn, complexity, blast radius, dead exports, test coverage, escape velocity
- **Symbol-level analysis** — callers/callees, symbol importance, impact blast radius
- **BM25 search** — ranked keyword search across files and symbols
- **Process tracing** — detect entry points and execution flows through the call graph
- **Community detection** — Louvain clustering for natural file groupings
- **Agent adoption** — `init` writes per-agent instruction files + installs a skill so AI agents query CI before grep/read
- **MCP parity (secondary)** — same analysis and rules gate available as 17 MCP tools, 2 prompts, and 3 resources

## Installation

Run directly with npx (no install):

```bash
npx codebase-intelligence overview ./src
```

Or install globally:

```bash
npm install -g codebase-intelligence
codebase-intelligence overview ./src
```

## CLI Usage

```bash
codebase-intelligence <command> <path> [options]
```

### Commands

| Command | What it does |
|---|---|
| `overview` | High-level codebase snapshot |
| `hotspots` | Rank files by metric (coupling, churn, complexity, blast radius, coverage, etc.) |
| `file` | Full context for one file |
| `search` | BM25 keyword search |
| `changes` | Git diff analysis with risk metrics |
| `dependents` | File-level blast radius |
| `modules` | Module architecture + cross-dependencies |
| `forces` | Cohesion/tension/escape-velocity analysis |
| `dead-exports` | Unused export detection |
| `opportunities` | Ranked code-quality and refactoring opportunities |
| `groups` | Top-level directory groups + aggregate metrics |
| `symbol` | Callers/callees and symbol metrics |
| `impact` | Symbol-level blast radius |
| `rename` | Reference discovery for rename planning |
| `processes` | Entry-point execution flow tracing |
| `clusters` | Community-detected file clusters |
| `check` | Rules-engine gate for CI |
| `init` | Set up AI agents to use CI — writes per-agent instruction files (skill opt-in via `--skill`) |

### Useful flags

| Flag | Description |
|---|---|
| `--json` | Stable JSON output |
| `--force` | Rebuild index even if cache is valid |
| `--limit <n>` | Limit results on supported commands |
| `--metric <m>` | Select ranking metric for `hotspots` |
| `--scope <s>` | Select git diff scope for `changes`: `staged`, `unstaged`, `all` |

The scanner always excludes common generated and agent-workspace directories such as `.code-visualizer/`, `.next/`, `dist/`, `coverage/`, `.worktrees/`, and `.claude/worktrees/`.

For full command details, see [docs/cli-reference.md](docs/cli-reference.md).

## Agent Adoption

codebase-intelligence has the data — but AI agents only benefit if they actually
*query* it instead of defaulting to grep/read. `init` closes that gap.

```bash
codebase-intelligence init                  # interactive picker (TTY)
codebase-intelligence init --agents claude,cursor
codebase-intelligence init --all --skill    # every agent + global skill
codebase-intelligence init --yes            # non-interactive defaults
```

Nothing is written unless you choose it. On a terminal, `init` shows an interactive
picker (`AGENTS.md` + `CLAUDE.md` preselected); non-interactively it defaults to those
two. The global skill is **opt-in** (`--skill`). It writes an idempotent, marked
instruction block ("query CI before grep/read") into each selected agent's native file:

| Layer | Target | Default |
|---|---|---|
| Repo instructions | `AGENTS.md`, `CLAUDE.md` | selected |
| Repo instructions | `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`, `CONVENTIONS.md` (Aider) | opt-in |
| Portable skill | `~/.claude/skills/codebase-intelligence/SKILL.md` | opt-in (`--skill`) |

Writes are idempotent — only content between the
`<!-- codebase-intelligence:start -->` / `:end` markers is ever touched, so re-running
is safe and your own edits are preserved.

### Install the skill directly

The skill is also published to the [skills.sh](https://www.skills.sh/) registry:

```bash
ags install codebase-intelligence
# or
npx skills add github.com/bntvllnt/codebase-intelligence
```

## MCP Integration (Secondary)

Running without a subcommand starts the MCP stdio server (backward compatible):

```bash
npx codebase-intelligence ./src
```

### Claude Code (manual)

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "codebase-intelligence": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codebase-intelligence@latest", "./src"],
      "env": {}
    }
  }
}
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or `.vscode/mcp.json`:

```json
{
  "servers": {
    "codebase-intelligence": {
      "command": "npx",
      "args": ["-y", "codebase-intelligence@latest", "./src"]
    }
  }
}
```

For MCP tool details, see [docs/mcp-tools.md](docs/mcp-tools.md).

## Metrics

| Metric | What it reveals |
|--------|-----------------|
| **PageRank** | Most-referenced files (importance) |
| **Betweenness** | Bridge files between disconnected modules |
| **Coupling** | How tangled a file is (fan-out / total connections) |
| **Cohesion** | Does a module belong together? (internal / total deps) |
| **Tension** | Is a file torn between modules? (entropy of cross-module pulls) |
| **Escape Velocity** | Should this module be its own package? |
| **Churn** | Git commit frequency |
| **Complexity** | Average cyclomatic complexity of exports |
| **Blast Radius** | Transitive dependents affected by a change |
| **Dead Exports** | Unused exports (safe to remove) |
| **Test Coverage** | Whether a test file exists for each source file |

## Architecture

```text
codebase-intelligence <command> <path>
        |
        v
   +---------+     +---------+     +----------+
   | Parser  | --> | Graph   | --> | Analyzer |
   | TS AST  |     | grapho- |     | metrics  |
   |         |     | logy    |     |          |
   +---------+     +---------+     +----------+
        |
        +--> CLI output (default)
        +--> MCP stdio (optional mode)
```

1. **Parser** — extracts files, functions, and imports via TypeScript Compiler API.
2. **Graph** — builds dependency/call graphs with [graphology](https://graphology.github.io/).
3. **Analyzer** — computes file/module/symbol metrics.
4. **Interfaces** — CLI is primary; MCP is available for agent integrations.

## Requirements

- Node.js >= 18
- TypeScript codebase (`.ts` / `.tsx` files)

## Limitations

- TypeScript-focused analysis
- Static analysis only (no runtime tracing)
- Call graph confidence varies by symbol resolution quality

## Release

Publishing is automated through GitHub Actions. See [CHANGELOG.md](CHANGELOG.md) for
release notes.

### Normal CI (before release)

- `CI` workflow runs on every PR and push to `main`:
  - lint → typecheck → build → test

### Canary publish

- Pushes to `main` trigger a canary publish.
- The package is published to npm with the `canary` tag.
- Canary versions are derived from the current package version plus the short commit SHA.

### Create a release

1. Bump `package.json` version in a normal PR.
2. Merge that PR to `main`.
3. Run the `Publish` workflow manually from GitHub Actions.
4. The workflow will:
   - verify the tag does not already exist
   - create and push `vX.Y.Z`
   - publish to npm with provenance via OIDC
   - create a GitHub Release with generated notes

No PAT is required for npm publish. The workflow uses GitHub repository permissions for tagging and OIDC for npm publishing.

## Security

Please do not report security vulnerabilities in public issues.

- Read [`SECURITY.md`](SECURITY.md) for supported versions and disclosure guidance.
- Use GitHub Security Advisories or private maintainer contact for sensitive reports.

## Contributing

Contributions are welcome.

Start here:
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, workflow, testing, and PR expectations
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community standards
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting

Quick setup:

```bash
git clone https://github.com/bntvllnt/codebase-intelligence.git
cd codebase-intelligence
pnpm install
pnpm dev          # tsx watch mode
pnpm test         # vitest
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
pnpm verify:cli-real        # default real-repo CLI matrix
pnpm verify:cli-real:heavy  # large /home/ubuntu repo matrix
```

## License

[MIT](LICENSE)
