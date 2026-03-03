<div align="center">

# codebase-intelligence

**Codebase analysis engine for TypeScript projects.**

Parse your codebase, build a dependency graph, compute architectural metrics, and query it all via MCP for LLM-assisted code understanding.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)

</div>

---

## Quick Start

### Claude Code (one-liner)

```bash
claude mcp add -s user -t stdio codebase-intelligence -- npx -y codebase-intelligence@latest . --mcp
```

Done. Available in all projects. Verify with `/mcp` inside Claude Code.

To scope to a single project instead:

```bash
claude mcp add -s project -t stdio codebase-intelligence -- npx -y codebase-intelligence@latest ./src --mcp
```

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [MCP Integration](#mcp-integration)
- [Metrics](#metrics)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- **15 MCP tools** — codebase overview, file context, hotspots, module structure, force analysis, dead exports, symbol context, search, impact analysis, rename planning, process tracing, community detection, and more
- **2 MCP prompts** — detect_impact, generate_map
- **3 MCP resources** — clusters, processes, setup guide
- **11 architectural metrics** — PageRank, betweenness, coupling, cohesion, tension, churn, complexity, blast radius, dead exports, test coverage, escape velocity
- **Symbol-level analysis** — call graph with callers/callees, symbol PageRank, per-symbol impact analysis
- **BM25 search** — find files and symbols by keyword with ranked results
- **Process tracing** — detect entry points and trace execution flows through the call graph
- **Community detection** — Louvain algorithm discovers natural file groupings beyond directory structure
- **Graph persistence** — cache parsed graphs to `.code-visualizer/` for instant startup

## Installation

Run directly with npx (no install needed):

```bash
npx codebase-intelligence ./src
```

Or install globally:

```bash
npm install -g codebase-intelligence
codebase-intelligence ./src
```

## Usage

```bash
npx codebase-intelligence ./src
# => Parsed 142 files, 387 functions, 612 dependencies
# => MCP stdio server started
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `<path>` | Path to TypeScript codebase | required |
| `--index` | Persist graph index to `.code-visualizer/` | off |
| `--force` | Re-index even if HEAD unchanged | off |
| `--status` | Print index status and exit | - |
| `--clean` | Remove `.code-visualizer/` index and exit | - |

## MCP Integration

### Claude Code (plugin)

```bash
git clone https://github.com/bntvllnt/claude-plugins.git
claude --plugin-dir ./claude-plugins/plugins/codebase-intelligence
```

### Claude Code (manual)

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "codebase-intelligence": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codebase-intelligence@latest", "./src", "--mcp"],
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
      "args": ["-y", "codebase-intelligence@latest", "./src", "--mcp"]
    }
  }
}
```

### MCP Tools

| Tool | What it does |
|------|--------------|
| `codebase_overview` | High-level architecture: modules, entry points, key metrics |
| `file_context` | Everything about one file: exports, imports, dependents, metrics |
| `get_dependents` | File-level blast radius: what breaks if you change this file |
| `find_hotspots` | Ranked files by any metric (coupling, churn, complexity, etc.) |
| `get_module_structure` | Module map with cross-deps, cohesion, circular deps |
| `analyze_forces` | Module health: tension files, bridges, extraction candidates |
| `find_dead_exports` | Unused exports that can be safely removed |
| `get_groups` | Top-level directory groups with aggregate metrics |
| `symbol_context` | Callers, callees, importance metrics for any function or class |
| `search` | Find files and symbols by keyword with ranked results |
| `detect_changes` | Git diff with risk metrics per changed file |
| `impact_analysis` | Symbol-level blast radius with depth-grouped risk labels |
| `rename_symbol` | Find all references to a symbol (read-only, for rename planning) |
| `get_processes` | Trace execution flows from entry points through the call graph |
| `get_clusters` | Community-detected clusters of related files |

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

```
codebase-intelligence <path>
        |
        v
   +---------+     +---------+     +----------+     +---------+
   | Parser  | --> | Graph   | --> | Analyzer | --> |   MCP   |
   | TS AST  |     | grapho- |     | metrics  |     |  stdio  |
   |         |     | logy    |     |          |     |         |
   +---------+     +---------+     +----------+     +---------+
```

1. **Parser** — extracts files, functions, and imports via the TypeScript Compiler API. Resolves path aliases, respects `.gitignore`, detects test associations.
2. **Graph** — builds nodes and edges with [graphology](https://graphology.github.io/). Detects circular deps via iterative DFS.
3. **Analyzer** — computes all 11 metrics plus group-level aggregations.
4. **MCP** — exposes 15 tools, 2 prompts, and 3 resources via stdio for LLM agents.

## Requirements

- Node.js >= 18
- TypeScript codebase (`.ts` / `.tsx` files)

## Limitations

- TypeScript only (no JS CommonJS, Python, Go, etc.)
- Static analysis only (no runtime/dynamic imports)
- Call graph confidence varies: type-resolved calls are reliable, text-inferred calls are best-effort

## Release

Publishing is automated and **only happens on `v*` tags**.

### One-time setup

1. Create an npm automation token (npmjs.com → Access Tokens).
2. Add it to GitHub repository secrets as `NPM_TOKEN`.

### Normal CI (before release)

- `CI` workflow runs on every PR and push to `main`:
  - lint → typecheck → build → test

### Create a release (auto bump + PR + auto tag)

1. Open GitHub Actions → `Release PR`.
2. Click **Run workflow** on `main`.
3. Select bump type: `patch` | `minor` | `major`.
4. Merge the generated release PR.

`Release PR` will:
- run lint → typecheck → build → test
- bump `package.json` version
- open a release PR assigned to the workflow runner

After merge, `Tag Release` creates and pushes `vX.Y.Z`, which triggers `Publish to npm`.

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
