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
- [MCP Integration (Secondary)](#mcp-integration-secondary)
- [Metrics](#metrics)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Limitations](#limitations)
- [Release](#release)
- [Contributing](#contributing)
- [License](#license)

## Features

- **15 CLI commands** for architecture analysis, dependency impact, dead code detection, and search
- **Machine-readable JSON output** (`--json`) for automation and CI pipelines
- **Auto-cached index** in `.code-visualizer/` for fast repeat queries
- **11 architectural metrics** — PageRank, betweenness, coupling, cohesion, tension, churn, complexity, blast radius, dead exports, test coverage, escape velocity
- **Symbol-level analysis** — callers/callees, symbol importance, impact blast radius
- **BM25 search** — ranked keyword search across files and symbols
- **Process tracing** — detect entry points and execution flows through the call graph
- **Community detection** — Louvain clustering for natural file groupings
- **MCP parity (secondary)** — same analysis available as 15 MCP tools, 2 prompts, and 3 resources

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
| `groups` | Top-level directory groups + aggregate metrics |
| `symbol` | Callers/callees and symbol metrics |
| `impact` | Symbol-level blast radius |
| `rename` | Reference discovery for rename planning |
| `processes` | Entry-point execution flow tracing |
| `clusters` | Community-detected file clusters |

### Useful flags

| Flag | Description |
|---|---|
| `--json` | Stable JSON output |
| `--force` | Rebuild index even if cache is valid |
| `--limit <n>` | Limit results on supported commands |
| `--metric <m>` | Select ranking metric for `hotspots` |

For full command details, see [docs/cli-reference.md](docs/cli-reference.md).

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

Publishing is automated and **only happens on `v*` tags**.

### One-time setup

1. Create an npm automation token (npmjs.com → Access Tokens).
2. Add it to GitHub repository secrets as `NPM_TOKEN`.

### Normal CI (before release)

- `CI` workflow runs on every PR and push to `main`:
  - lint → typecheck → build → test

### Create a release

1. Bump `package.json` version.
2. Commit: `chore(release): bump to vX.Y.Z`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin main --tags`

The `v*` tag triggers the `CI` workflow publish job (`npm publish --access public --provenance`).

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/bntvllnt/codebase-intelligence.git
cd codebase-intelligence
pnpm install
pnpm dev          # tsx watch mode
pnpm test         # vitest
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
```

## License

[MIT](LICENSE)
