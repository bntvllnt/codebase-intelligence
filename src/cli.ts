#!/usr/bin/env node

process.on("SIGINT", () => {
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`Fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { startMcpServer } from "./mcp/index.js";
import { importGraph } from "./persistence/index.js";
import {
  cleanIndexDirectories,
  getCacheFactsForTarget,
} from "./persistence/index-dir.js";
import {
  GraphLoadError,
  loadCodebaseGraph,
  prepareGraphCache,
  type GraphLoadProgress,
} from "./graph-loader/index.js";
import {
  operations,
  parseOperationInput,
  runOperation,
  type Operation,
  type OperationRunResult,
} from "./operations/index.js";
import {
  installRepoFiles,
  installGlobalSkill,
  installGitignoreEntry,
  resolveInitPlan,
  ALL_AGENT_IDS,
} from "./install/index.js";
import { promptSelection } from "./install/prompt.js";
import { runCheck, exitCodeFor } from "./rules/check.js";
import { formatResult, formatSummaryLine } from "./rules/format.js";
import { ConfigError } from "./config/index.js";
import type { CacheFacts, CodebaseGraph, OutputFormat } from "./types/index.js";

// ── Helpers ─────────────────────────────────────────────────

let activeCacheFacts: CacheFacts | null = null;

function progress(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function output(data: string): void {
  process.stdout.write(`${data}\n`);
}

function isJsonObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function outputJson(data: unknown): void {
  const payload = activeCacheFacts && isJsonObject(data) ? { ...data, cache: activeCacheFacts } : data;
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function optionalIntegerInput(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : value;
}

function optionalNumberInput(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function printOperationError(result: { error: string; data?: unknown }): never {
  process.stderr.write(`Error: ${result.error}\n`);
  if (isJsonObject(result.data) && Array.isArray(result.data.suggestions) && result.data.suggestions.length > 0) {
    process.stderr.write(`\nDid you mean:\n`);
    for (const suggestion of result.data.suggestions) {
      process.stderr.write(`  ${suggestion}\n`);
    }
  }
  process.exit(1);
}

function parseCliOperationInput<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: unknown,
): TInput {
  const parsed = parseOperationInput(operation, input);
  if (!parsed.ok) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    process.exit(2);
  }
  return parsed.data;
}

function runCliOperation<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  graph: CodebaseGraph,
  input: TInput,
  context = {},
): TResult {
  const result: OperationRunResult<TResult> = runOperation(operation, graph, input, context);
  if (!result.ok) printOperationError(result);
  return result.data;
}

function outputOperationText<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  result: TResult,
  input: TInput,
): void {
  output(operation.formatText(result, input));
}

function reportGraphLoadProgress(event: GraphLoadProgress): void {
  progress(event.message);
}

function printGraphLoadError(err: unknown): never {
  if (err instanceof GraphLoadError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

function loadGraph(targetPath: string, force = false): { graph: CodebaseGraph; headHash: string } {
  try {
    const result = loadCodebaseGraph({
      targetPath,
      force,
      persist: true,
      cliVersion: pkg.version,
      onProgress: reportGraphLoadProgress,
    });
    activeCacheFacts = result.cacheFacts;
    return { graph: result.graph, headHash: result.headHash };
  } catch (err) {
    printGraphLoadError(err);
  }
}

// ── CLI Program ─────────────────────────────────────────────

interface CliCommandOptions {
  json?: boolean;
  force?: boolean;
}

interface HotspotOptions extends CliCommandOptions {
  metric?: string;
  limit?: string;
}

interface SearchOptions extends CliCommandOptions {
  limit?: string;
}

interface ChangesOptions extends CliCommandOptions {
  scope?: string;
}

interface DependentsOptions extends CliCommandOptions {
  depth?: string;
}

interface ForcesOptions extends CliCommandOptions {
  cohesion?: string;
  tension?: string;
  escape?: string;
}

interface DeadExportsOptions extends CliCommandOptions {
  module?: string;
  limit?: string;
}

interface OpportunitiesOptions extends CliCommandOptions {
  limit?: string;
}

interface DuplicationOptions extends CliCommandOptions {
  mode?: string;
  minTokens?: string;
  skipLocal?: boolean;
  trace?: string;
}

interface ProcessesOptions extends CliCommandOptions {
  entry?: string;
  limit?: string;
}

interface CodebaseMapOptions extends CliCommandOptions {
  focus?: string;
  scope?: string;
  depth?: string;
  format?: string;
  contextBudget?: string;
}

interface ContentDriftOptions extends CliCommandOptions {
  focus?: string;
  scope?: string;
  minScore?: string;
}

interface HealthOptions extends CliCommandOptions {
  minScore?: string;
  score?: boolean;
}

interface BoundariesOptions extends CliCommandOptions {
  config?: string;
  preset?: string;
  list?: boolean;
}

interface HighwaysOptions extends CliCommandOptions {
  operation?: string;
  shape?: string;
  minRoutes?: string;
  propose?: boolean;
  trace?: string;
}

interface ClustersOptions extends CliCommandOptions {
  minFiles?: string;
}

interface RenameOptions extends CliCommandOptions {
  dryRun?: boolean;
}

interface McpOptions {
  index?: boolean;
  force?: boolean;
  status?: boolean;
  clean?: boolean;
}

interface InitOptions {
  agents?: string;
  all?: boolean;
  skill?: boolean;
  gitignore?: boolean;
  yes?: boolean;
  json?: boolean;
}

const program = new Command();

function forceOption(options: CliCommandOptions): boolean {
  return options.force === true || program.opts<{ force?: boolean }>().force === true;
}

program
  .name("codebase-intelligence")
  .description("Analyze TypeScript codebases — architecture, dependencies, metrics.")
  .version(pkg.version);

// Commander auto-generates the command list; only the extras it can't express
// (MCP mode, a starter hint) are appended after it. A second, hand-maintained
// command list would drift out of sync — keep commander as the single source.
program.addHelpText(
  "after",
  "\nMCP mode:\n" +
    "  codebase-intelligence <path>  Start MCP stdio server\n\n" +
    "Try: codebase-intelligence overview ./src",
);

// ── Subcommand: overview ────────────────────────────────────

program
  .command("overview")
  .description("High-level codebase snapshot: files, functions, modules, dependencies")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.overview, {});
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.overview, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.overview, result, input);
  });

// ── Subcommand: hotspots ────────────────────────────────────

program
  .command("hotspots")
  .description("Rank files by metric (coupling, pagerank, churn, complexity, blast_radius, ...)")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--metric <metric>", "Metric to rank by (default: coupling)")
  .option("--limit <n>", "Number of results (default: 10)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: HotspotOptions) => {
    const input = parseCliOperationInput(operations.hotspots, {
      metric: options.metric ?? "coupling",
      limit: optionalIntegerInput(options.limit),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.hotspots, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    if (!options.metric) {
      progress(`Showing coupling (default). Use --metric to change.`);
    }

    outputOperationText(operations.hotspots, result, input);
  });

// ── Subcommand: file ────────────────────────────────────────

program
  .command("file")
  .description("Detailed file context: exports, imports, dependents, metrics")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<file>", "File to inspect (relative to codebase root)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, filePath: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.fileContext, { filePath });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.fileContext, graph, input);
    if ("error" in result) printOperationError({ error: result.error, data: result });

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.fileContext, result, input);
  });

// ── Subcommand: search ──────────────────────────────────────

program
  .command("search")
  .description("Keyword search across files and symbols (BM25)")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<query>", "Search query")
  .option("--limit <n>", "Number of results (default: 20)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, query: string, options: SearchOptions) => {
    const input = parseCliOperationInput(operations.search, {
      query,
      limit: options.limit === undefined ? 20 : optionalIntegerInput(options.limit),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.search, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.search, result, input);
  });

// ── Subcommand: changes ─────────────────────────────────────

program
  .command("changes")
  .description("Analyze git changes: affected files, symbols, risk metrics")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--scope <scope>", "Diff scope: staged, unstaged, or all (default: all)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: ChangesOptions) => {
    const input = parseCliOperationInput(operations.changes, { scope: options.scope });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.changes, graph, input, { rootDir: path.resolve(targetPath) });
    if ("error" in result) printOperationError({ error: result.error, data: result });

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.changes, result, input);
  });

// ── Subcommand: dependents ──────────────────────────────────

program
  .command("dependents")
  .description("File-level blast radius: direct + transitive dependents")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<file>", "File to inspect (relative to codebase root)")
  .option("--depth <n>", "Max traversal depth (default: 2)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, filePath: string, options: DependentsOptions) => {
    const input = parseCliOperationInput(operations.dependents, {
      filePath,
      depth: optionalIntegerInput(options.depth),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.dependents, graph, input);
    if ("error" in result) printOperationError({ error: result.error, data: result });

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.dependents, result, input);
  });

// ── Subcommand: modules ────────────────────────────────────

program
  .command("modules")
  .description("Module architecture: cohesion, cross-module deps, circular deps")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.moduleStructure, {});
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.moduleStructure, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.moduleStructure, result, input);
  });

// ── Subcommand: forces ─────────────────────────────────────

program
  .command("forces")
  .description("Architectural force analysis: tension, bridges, extraction candidates")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--cohesion <n>", "Min cohesion threshold (default: 0.6)")
  .option("--tension <n>", "Min tension threshold (default: 0.3)")
  .option("--escape <n>", "Min escape velocity threshold (default: 0.5)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: ForcesOptions) => {
    const input = parseCliOperationInput(operations.forces, {
      cohesionThreshold: optionalNumberInput(options.cohesion),
      tensionThreshold: optionalNumberInput(options.tension),
      escapeThreshold: optionalNumberInput(options.escape),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.forces, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.forces, result, input);
  });

// ── Subcommand: dead-exports ───────────────────────────────

program
  .command("dead-exports")
  .description("Find unused exports across the codebase")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--module <module>", "Filter by module path")
  .option("--limit <n>", "Max results (default: 20)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: DeadExportsOptions) => {
    const input = parseCliOperationInput(operations.deadExports, {
      module: options.module,
      limit: optionalIntegerInput(options.limit),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.deadExports, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.deadExports, result, input);
  });

// ── Subcommand: opportunities ──────────────────────────────

program
  .command("opportunities")
  .description("Rank code quality and refactoring opportunities for AI agents")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--limit <n>", "Max opportunities (default: 20)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: OpportunitiesOptions) => {
    const input = parseCliOperationInput(operations.opportunities, {
      limit: optionalIntegerInput(options.limit),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.opportunities, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.opportunities, result, input);
  });

// ── Subcommand: duplicates ─────────────────────────────────

program
  .command("duplicates")
  .description("Detect duplicate function families (strict, mild, weak)")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--mode <mode>", "Clone mode: strict, mild, or weak (default: mild)")
  .option("--min-tokens <n>", "Minimum tokens to consider (default: 30)")
  .option("--skip-local", "Ignore duplicate families confined to one file")
  .option("--trace <id>", "Return token evidence for a duplicate family id")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: DuplicationOptions) => {
    const input = parseCliOperationInput(operations.duplication, {
      mode: options.mode,
      minTokens: optionalIntegerInput(options.minTokens),
      skipLocal: options.skipLocal,
      trace: options.trace,
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.duplication, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.duplication, result, input);
  });

// ── Subcommand: groups ─────────────────────────────────────

program
  .command("groups")
  .description("Top-level directory groups with aggregate metrics")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.groups, {});
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.groups, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.groups, result, input);
  });

// ── Subcommand: symbol ─────────────────────────────────────

program
  .command("symbol")
  .description("Function/class context: callers, callees, metrics")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<name>", "Symbol name (e.g., 'AuthService', 'getUserById')")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, symbolName: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.symbolContext, { name: symbolName });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.symbolContext, graph, input);
    if ("error" in result) printOperationError({ error: result.error, data: result });

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.symbolContext, result, input);
  });

// ── Subcommand: impact ─────────────────────────────────────

program
  .command("impact")
  .description("Symbol-level blast radius with depth-grouped impact levels")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<symbol>", "Symbol name (e.g., 'getUserById')")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, symbol: string, options: CliCommandOptions) => {
    const input = parseCliOperationInput(operations.impact, { symbol });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.impact, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.impact, result, input);
  });

// ── Subcommand: rename ─────────────────────────────────────

program
  .command("rename")
  .description("Find all references for rename planning (read-only)")
  .argument("<path>", "Path to TypeScript codebase")
  .argument("<oldName>", "Current symbol name")
  .argument("<newName>", "New symbol name")
  .option("--no-dry-run", "Actually perform the rename (default: dry run)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, oldName: string, newName: string, options: RenameOptions) => {
    const dryRun = options.dryRun !== false;
    const input = parseCliOperationInput(operations.rename, { oldName, newName, dryRun });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.rename, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.rename, result, input);
  });

// ── Subcommand: processes ──────────────────────────────────

program
  .command("processes")
  .description("Entry point execution flows through the call graph")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--entry <name>", "Filter by entry point name")
  .option("--limit <n>", "Max processes to return")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: ProcessesOptions) => {
    const input = parseCliOperationInput(operations.processes, {
      entryPoint: options.entry,
      limit: optionalIntegerInput(options.limit),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.processes, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.processes, result, input);
  });

// ── Subcommand: map ────────────────────────────────────────

program
  .command("map")
  .description("Focused codebase graph plus token-bounded context pack")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--focus <symbolOrFile>", "Symbol, file, or scope to focus on")
  .option("--scope <scope>", "Directory/module scope to include")
  .option("--depth <n>", "Graph traversal depth (default: 1)")
  .option("--format <format>", "Output format: markdown, json, dot, or graphml")
  .option("--context-budget <n>", "Approximate context pack token budget (default: 1200)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CodebaseMapOptions) => {
    const input = parseCliOperationInput(operations.codebaseMap, {
      focus: options.focus,
      scope: options.scope,
      depth: optionalIntegerInput(options.depth),
      format: options.format,
      contextBudget: optionalIntegerInput(options.contextBudget),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.codebaseMap, graph, input);

    if (options.json || input.format === "json") {
      outputJson(result);
      return;
    }

    outputOperationText(operations.codebaseMap, result, input);
  });

// ── Subcommand: drift ──────────────────────────────────────

program
  .command("drift")
  .description("Detect file, folder, side-effect, shape, and test placement drift")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--focus <fileOrSymbol>", "File, scope, or symbol text to focus on")
  .option("--scope <scope>", "Directory/module scope to include")
  .option("--min-score <n>", "Minimum drift score to report (default: 35)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: ContentDriftOptions) => {
    const input = parseCliOperationInput(operations.contentDrift, {
      focus: options.focus,
      scope: options.scope,
      minScore: optionalNumberInput(options.minScore),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.contentDrift, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.contentDrift, result, input);
  });

// ── Subcommand: health ─────────────────────────────────────

program
  .command("health")
  .description("Compute a CI-gateable health score with maintainability, CRAP, coverage, and risk hotspots")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--score", "Print compact health score text")
  .option("--min-score <n>", "Minimum health score before exit 1 (default: 70)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: HealthOptions) => {
    const input = parseCliOperationInput(operations.health, {
      minScore: optionalNumberInput(options.minScore),
      score: options.score,
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.health, graph, input, { rootDir: path.resolve(targetPath) });

    if (options.json) {
      outputJson(result);
    } else {
      outputOperationText(operations.health, result, input);
    }

    if (result.verdict === "fail") {
      process.exitCode = 1;
    }
  });

// ── Subcommand: boundaries ─────────────────────────────────

program
  .command("boundaries")
  .description("Evaluate architecture boundary zones and import rules")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--config <path>", "Config file path (overrides discovery)")
  .option("--preset <preset>", "Preset: bulletproof, layered, hexagonal, or feature-sliced")
  .option("--list", "List resolved zones and rules")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: BoundariesOptions) => {
    const input = parseCliOperationInput(operations.boundaries, {
      preset: options.preset,
      list: options.list,
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.boundaries, graph, input, {
      rootDir: path.resolve(targetPath),
      configPath: options.config,
    });

    if (options.json) {
      outputJson(result);
    } else {
      outputOperationText(operations.boundaries, result, input);
    }

    if (result.verdict === "fail") {
      process.exitCode = 1;
    }
  });

// ── Subcommand: highways ───────────────────────────────────

program
  .command("highways")
  .description("Find repeated routes that should converge on one canonical path")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--operation <verb>", "Operation verb to focus on, such as create or update")
  .option("--shape <name>", "Type/DTO shape to focus on")
  .option("--min-routes <n>", "Minimum routes reaching a sink before reporting (default: 2)")
  .option("--propose", "Include reroute proposal metadata")
  .option("--trace <id>", "Return route evidence for one highway opportunity id")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: HighwaysOptions) => {
    const input = parseCliOperationInput(operations.highways, {
      operation: options.operation,
      shape: options.shape,
      minRoutes: optionalIntegerInput(options.minRoutes),
      propose: options.propose,
      trace: options.trace,
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.highways, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.highways, result, input);
  });

// ── Subcommand: clusters ───────────────────────────────────

program
  .command("clusters")
  .description("Community-detected file clusters (Louvain algorithm)")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--min-files <n>", "Min files per cluster (default: 0)")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: ClustersOptions) => {
    const input = parseCliOperationInput(operations.clusters, {
      minFiles: optionalIntegerInput(options.minFiles),
    });
    const { graph } = loadGraph(targetPath, forceOption(options));
    const result = runCliOperation(operations.clusters, graph, input);

    if (options.json) {
      outputJson(result);
      return;
    }

    outputOperationText(operations.clusters, result, input);
  });

// ── Subcommand: init ───────────────────────────────────────

program
  .command("init")
  .description("Set up AI agents to use codebase-intelligence: write per-agent instruction files (+ optional skill)")
  .argument("[path]", "Repo root (default: current directory)", ".")
  .option("--agents <list>", `Comma-separated agents, non-interactive. Available: ${ALL_AGENT_IDS.join(", ")}`)
  .option("--all", "Target every agent (non-interactive)")
  .option("--skill", "Also install the global Claude skill (opt-in)")
  .option("--gitignore", "Add .codebase-intelligence/ to .gitignore")
  .option("-y, --yes", "Accept defaults without prompting")
  .option("--json", "Output as JSON (implies non-interactive)")
  .action(async (targetPath: string, options: InitOptions) => {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`Error: Path does not exist: ${targetPath}\n`);
      process.exit(1);
    }

    const isTty = process.stdin.isTTY && process.stdout.isTTY;
    const plan = resolveInitPlan(options, isTty);

    if (plan.invalidAgents.length > 0) {
      process.stderr.write(
        `Error: Unknown agents: ${plan.invalidAgents.join(", ")}. Available: ${ALL_AGENT_IDS.join(", ")}\n`,
      );
      process.exit(2);
    }

    let agents = plan.agents;
    let installSkill = plan.installSkill;

    if (plan.mode === "interactive") {
      const selection = await promptSelection(agents, installSkill);
      if (!selection) {
        output("Cancelled — nothing written.");
        return;
      }
      agents = selection.agents;
      installSkill = selection.skill;
    }

    const installGitignore = plan.installGitignore;

    if (agents.length === 0 && !installSkill && !installGitignore) {
      output("Nothing selected — nothing to do.");
      return;
    }

    const repoResults = installRepoFiles(resolved, { agents });
    const gitignoreResult = installGitignore ? installGitignoreEntry(resolved) : undefined;
    const skillResult = installSkill ? installGlobalSkill() : undefined;

    if (options.json) {
      outputJson({
        repoFiles: repoResults,
        gitignore: gitignoreResult ?? null,
        skill: skillResult ?? null,
        cache: getCacheFactsForTarget(resolved, gitignoreResult?.action === "created" || gitignoreResult?.action === "updated"),
      });
      return;
    }

    output(`Codebase Intelligence — agent adoption`);
    output(`──────────────────────────────────────`);
    if (repoResults.length > 0) {
      output(`Repo instruction files (${resolved}):`);
      for (const r of repoResults) {
        output(`  ${r.action.padEnd(9)} ${r.path}`);
      }
    }
    if (skillResult) {
      output(``);
      output(`Global skill:`);
      output(`  ${skillResult.action.padEnd(9)} ${skillResult.path}`);
    }
    if (gitignoreResult) {
      output(``);
      output(`Git ignore:`);
      output(`  ${gitignoreResult.action.padEnd(9)} ${gitignoreResult.path}`);
    }
    output(``);
    output(`Done. Selected agents will be told to query codebase-intelligence first.`);
    output(`Re-run anytime — writes are idempotent (managed blocks only).`);
  });

// ── Subcommand: check ──────────────────────────────────────

interface CheckOptions extends CliCommandOptions {
  config?: string;
  format?: string;
  failOn?: string;
  gate?: string;
  base?: string;
  quiet?: boolean;
  summary?: boolean;
}

function resolveCheckFormat(options: CheckOptions): OutputFormat | null {
  if (options.json) return "json";
  if (!options.format) return "text";
  if (options.format === "json" || options.format === "sarif" || options.format === "text") {
    return options.format;
  }
  return null;
}

function parseFailOn(value: string | undefined): "error" | "warn" | "never" | undefined | false {
  if (value === undefined) return undefined;
  if (value === "error" || value === "warn" || value === "never") return value;
  return false;
}

function parseGate(value: string | undefined): "all" | "new-only" | undefined | false {
  if (value === undefined) return undefined;
  if (value === "all" || value === "new-only") return value;
  return false;
}

program
  .command("check")
  .description("Run the rules engine and gate on findings")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--config <path>", "Config file path (overrides discovery)")
  .option("--format <fmt>", "Output: text, json, or sarif (default: text)")
  .option("--fail-on <severity>", "Severity that fails the gate: error, warn, never")
  .option("--gate <mode>", "Gate mode: all or new-only")
  .option("--base <ref>", "Base git ref for new-only gating")
  .option("--quiet", "Suppress output when the result passes")
  .option("--summary", "Print summary counts only")
  .option("--json", "Shortcut for --format json")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CheckOptions) => {
    const format = resolveCheckFormat(options);
    if (!format) {
      process.stderr.write("Error: --format must be one of: text, json, sarif\n");
      process.exit(2);
    }

    const failOn = parseFailOn(options.failOn);
    if (failOn === false) {
      process.stderr.write("Error: --fail-on must be one of: error, warn, never\n");
      process.exit(2);
    }

    const gate = parseGate(options.gate);
    if (gate === false) {
      process.stderr.write("Error: --gate must be one of: all, new-only\n");
      process.exit(2);
    }

    try {
      const { graph } = loadGraph(targetPath, forceOption(options));
      const result = runCheck(graph, path.resolve(targetPath), {
        configPath: options.config,
        format,
        failOn,
        gate,
        base: options.base,
        quiet: options.quiet,
        summary: options.summary,
      });

      const silent = options.quiet === true && result.verdict === "pass";
      if (!silent) {
        output(options.summary ? formatSummaryLine(result) : formatResult(result, format));
      }

      process.exitCode = exitCodeFor(result);
      return;
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`Config error: ${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }
  });

// ── MCP fallback (backward compat) ──────────────────────────

program
  .command("mcp", { hidden: true })
  .description("Start MCP stdio server (explicit)")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--index", "Persist graph index")
  .option("--force", "Re-index even if HEAD unchanged")
  .action(async (targetPath: string, options: McpOptions) => {
    await runMcpMode(targetPath, options);
  });

async function runMcpMode(targetPath: string, options: McpOptions): Promise<void> {
  if (options.clean) {
    const removed = cleanIndexDirectories(targetPath);
    if (removed.length === 0) {
      progress("No index found.");
    } else {
      for (const dir of removed) progress(`Removed index at ${dir}`);
    }
    return;
  }

  if (options.status) {
    const cache = prepareGraphCache({ targetPath, onProgress: reportGraphLoadProgress });
    activeCacheFacts = cache.cacheFacts;
    const indexDir = cache.indexDir;
    const result = importGraph(indexDir);
    if (!result) {
      progress("No index found. Run with --index to create one.");
      return;
    }
    const metaPath = path.join(indexDir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
      headHash: string;
      timestamp: string;
      cacheKey?: string;
    };
    progress(`Index status:`);
    progress(`  Head:      ${meta.headHash}`);
    progress(`  Indexed:   ${meta.timestamp}`);
    progress(`  Cache key: ${meta.cacheKey ? meta.cacheKey.slice(0, 12) : "legacy"}`);
    progress(`  Files:     ${result.graph.nodes.filter((n) => n.type === "file").length}`);
    progress(`  Symbols:   ${result.graph.symbolNodes.length}`);
    progress(`  Edges:     ${result.graph.edges.length}`);
    return;
  }

  try {
    const result = loadCodebaseGraph({
      targetPath,
      force: options.force === true,
      persist: options.index === true,
      cliVersion: pkg.version,
      onProgress: reportGraphLoadProgress,
    });
    activeCacheFacts = result.cacheFacts;
    await startMcpServer(result.graph);
  } catch (err) {
    printGraphLoadError(err);
  }
}

// ── Default action: bare <path> → MCP mode ──────────────────

program
  .argument("[path]", "Path to codebase (starts MCP mode)")
  .option("--mcp", "Start as MCP stdio server (backward compatibility)")
  .option("--index", "Persist graph index to .codebase-intelligence/")
  .option("--force", "Re-index even if HEAD unchanged")
  .option("--status", "Print index status and exit")
  .option("--clean", "Remove .codebase-intelligence/ and legacy .code-visualizer/ indexes and exit")
  .action(async (targetPath: string | undefined, options: McpOptions) => {
    if (!targetPath) {
      program.help();
      return;
    }
    await runMcpMode(targetPath, options);
  });

program.parse();
