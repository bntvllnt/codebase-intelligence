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
import { execSync } from "child_process";
import { createRequire } from "module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { parseCodebase } from "./parser/index.js";
import { buildGraph } from "./graph/index.js";
import { analyzeGraph } from "./analyzer/index.js";
import { startMcpServer } from "./mcp/index.js";
import { setIndexedHead } from "./server/graph-store.js";
import { exportGraph, importGraph } from "./persistence/index.js";
import {
  computeOverview,
  computeFileContext,
  computeHotspots,
  computeSearch,
  computeChanges,
  computeDependents,
  computeModuleStructure,
  computeForces,
  computeDeadExports,
  computeGroups,
  computeSymbolContext,
  computeProcesses,
  computeClusters,
  impactAnalysis,
  renameSymbol,
} from "./core/index.js";
import type { CodebaseGraph } from "./types/index.js";

const INDEX_DIR_NAME = ".code-visualizer";

// ── Helpers ─────────────────────────────────────────────────

function getIndexDir(targetPath: string): string {
  return path.join(path.resolve(targetPath), INDEX_DIR_NAME);
}

function getHeadHash(targetPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: path.resolve(targetPath),
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "unknown";
  }
}

function progress(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function output(data: string): void {
  process.stdout.write(`${data}\n`);
}

function outputJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Load (or parse+cache) the codebase graph for a target path. */
function loadGraph(targetPath: string, force = false): { graph: CodebaseGraph; headHash: string } {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`Error: Path does not exist: ${targetPath}\n`);
    process.exit(1);
  }

  const indexDir = getIndexDir(targetPath);
  const headHash = getHeadHash(targetPath);

  if (!force && headHash !== "unknown") {
    const cached = importGraph(indexDir);
    if (cached?.headHash === headHash) {
      progress(`Using cached index (HEAD: ${headHash.slice(0, 7)})`);
      setIndexedHead(cached.headHash);
      return { graph: cached.graph, headHash };
    }
  }

  progress(`Parsing ${targetPath}...`);
  const files = parseCodebase(targetPath);
  progress(`Parsed ${files.length} files`);

  if (files.length === 0) {
    process.stderr.write(`Error: No TypeScript files found at ${targetPath}\n`);
    process.exit(1);
  }

  const built = buildGraph(files);
  progress(
    `Built graph: ${built.nodes.filter((n) => n.type === "file").length} files, ` +
      `${built.nodes.filter((n) => n.type === "function").length} functions, ` +
      `${built.edges.length} dependencies`,
  );

  const graph = analyzeGraph(built, files);
  progress(
    `Analysis complete: ${graph.stats.circularDeps.length} circular deps, ` +
      `${graph.forceAnalysis.tensionFiles.length} tension files`,
  );

  setIndexedHead(headHash);

  exportGraph(graph, indexDir, headHash);
  progress(`Index saved to ${indexDir}`);

  return { graph, headHash };
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

interface ProcessesOptions extends CliCommandOptions {
  entry?: string;
  limit?: string;
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

const program = new Command();

program
  .name("codebase-intelligence")
  .description(
    "Analyze TypeScript codebases — architecture, dependencies, metrics.\n\n" +
      "Commands:\n" +
      "  overview <path>          High-level codebase snapshot\n" +
      "  hotspots <path>          Rank files by metric\n" +
      "  file <path> <file>       Detailed file context\n" +
      "  search <path> <query>    Keyword search\n" +
      "  changes <path>           Git diff analysis\n" +
      "  dependents <path> <file> File-level blast radius\n" +
      "  modules <path>           Module architecture\n" +
      "  forces <path>            Architectural force analysis\n" +
      "  dead-exports <path>      Find unused exports\n" +
      "  groups <path>            Top-level directory groups\n" +
      "  symbol <path> <name>     Function/class context\n" +
      "  impact <path> <symbol>   Symbol-level blast radius\n" +
      "  rename <path> <old> <new> Find references for rename\n" +
      "  processes <path>         Entry point execution flows\n" +
      "  clusters <path>          Community-detected file clusters\n\n" +
      "MCP mode:\n" +
      "  codebase-intelligence <path>  Start MCP stdio server\n\n" +
      "Try: codebase-intelligence overview ./src",
  )
  .version(pkg.version);

// ── Subcommand: overview ────────────────────────────────────

program
  .command("overview")
  .description("High-level codebase snapshot: files, functions, modules, dependencies")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeOverview(graph);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Codebase Overview`);
    output(`─────────────────`);
    output(`Files:        ${result.totalFiles}`);
    output(`Functions:    ${result.totalFunctions}`);
    output(`Dependencies: ${result.totalDependencies}`);
    output(`Avg LOC:      ${result.metrics.avgLOC}`);
    output(`Max Depth:    ${result.metrics.maxDepth}`);
    output(`Circular:     ${result.metrics.circularDeps}`);
    output(``);
    output(`Modules`);
    output(`${"Path".padEnd(40)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Coupling".padStart(10)} ${"Cohesion".padStart(10)}`);
    output(`${"─".repeat(40)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(10)}`);
    for (const m of result.modules) {
      output(
        `${m.path.padEnd(40)} ${String(m.files).padStart(6)} ${String(m.loc).padStart(8)} ${m.avgCoupling.padStart(10)} ${m.cohesion.toFixed(2).padStart(10)}`,
      );
    }
    output(``);
    output(`Top Depended Files`);
    for (const f of result.topDependedFiles) {
      output(`  ${f}`);
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const metric = options.metric ?? "coupling";
    const limit = options.limit ? parseInt(options.limit, 10) : 10;
    if (isNaN(limit) || limit < 1) {
      process.stderr.write("Error: --limit must be a positive integer\n");
      process.exit(2);
    }
    const result = computeHotspots(graph, metric, limit);

    if (options.json) {
      outputJson(result);
      return;
    }

    if (!options.metric) {
      progress(`Showing coupling (default). Use --metric to change.`);
    }

    output(`Hotspots: ${result.metric}`);
    output(`──────────${"─".repeat(result.metric.length)}`);
    output(`${"Path".padEnd(50)} ${"Score".padStart(10)} Reason`);
    output(`${"─".repeat(50)} ${"─".repeat(10)} ${"─".repeat(30)}`);
    for (const h of result.hotspots) {
      output(`${h.path.padEnd(50)} ${h.score.toFixed(2).padStart(10)} ${h.reason}`);
    }
    output(``);
    output(result.summary);
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
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeFileContext(graph, filePath);

    if ("error" in result) {
      process.stderr.write(`Error: ${result.error}\n`);
      if (result.suggestions.length > 0) {
        process.stderr.write(`\nDid you mean:\n`);
        for (const s of result.suggestions) {
          process.stderr.write(`  ${s}\n`);
        }
      }
      process.exit(1);
    }

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`File: ${result.path}`);
    output("─".repeat(6 + result.path.length));
    output(`LOC: ${result.loc}`);
    output(``);

    if (result.exports.length > 0) {
      output(`Exports (${result.exports.length})`);
      for (const e of result.exports) {
        output(`  ${e.type.padEnd(12)} ${e.name} (${e.loc} LOC)`);
      }
      output(``);
    }

    if (result.imports.length > 0) {
      output(`Imports (${result.imports.length})`);
      for (const i of result.imports) {
        const typeTag = i.isTypeOnly ? " [type]" : "";
        output(`  ${i.from} → {${i.symbols.join(", ")}}${typeTag}`);
      }
      output(``);
    }

    if (result.dependents.length > 0) {
      output(`Dependents (${result.dependents.length})`);
      for (const d of result.dependents) {
        const typeTag = d.isTypeOnly ? " [type]" : "";
        output(`  ${d.path} → {${d.symbols.join(", ")}}${typeTag}`);
      }
      output(``);
    }

    output(`Metrics`);
    output(`  PageRank:    ${result.metrics.pageRank}`);
    output(`  Betweenness: ${result.metrics.betweenness}`);
    output(`  Fan-in:      ${result.metrics.fanIn}`);
    output(`  Fan-out:     ${result.metrics.fanOut}`);
    output(`  Coupling:    ${result.metrics.coupling}`);
    output(`  Tension:     ${result.metrics.tension}`);
    output(`  Bridge:      ${result.metrics.isBridge ? "yes" : "no"}`);
    output(`  Churn:       ${result.metrics.churn}`);
    output(`  Complexity:  ${result.metrics.cyclomaticComplexity}`);
    output(`  Blast radius:${result.metrics.blastRadius}`);
    output(`  Has tests:   ${result.metrics.hasTests ? `yes (${result.metrics.testFile})` : "no"}`);

    if (result.metrics.deadExports.length > 0) {
      output(`  Dead exports: ${result.metrics.deadExports.join(", ")}`);
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const limit = options.limit ? parseInt(options.limit, 10) : 20;
    if (isNaN(limit) || limit < 1) {
      process.stderr.write("Error: --limit must be a positive integer\n");
      process.exit(2);
    }
    const result = computeSearch(graph, query, limit);

    if (options.json) {
      outputJson(result);
      return;
    }

    if (result.results.length === 0) {
      output(`No results for "${query}"`);
      if (result.suggestions && result.suggestions.length > 0) {
        output(`\nDid you mean: ${result.suggestions.join(", ")}?`);
      }
      return;
    }

    output(`Search: "${query}" (${result.results.length} results)`);
    output("─".repeat(40));
    for (const r of result.results) {
      output(`${r.file} (score: ${r.score.toFixed(2)})`);
      for (const s of r.symbols) {
        output(`  ${s.type.padEnd(12)} ${s.name} (${s.loc} LOC, relevance: ${s.relevance.toFixed(2)})`);
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeChanges(graph, options.scope);

    if ("error" in result) {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Changes (${result.scope})`);
    output("─".repeat(20));

    if (result.changedFiles.length === 0) {
      output(`No changes detected.`);
      return;
    }

    output(`Changed files (${result.changedFiles.length}):`);
    for (const f of result.changedFiles) {
      output(`  ${f}`);
    }

    if (result.changedSymbols.length > 0) {
      output(``);
      output(`Changed symbols:`);
      for (const cs of result.changedSymbols) {
        output(`  ${cs.file}: ${cs.symbols.join(", ")}`);
      }
    }

    if (result.affectedFiles.length > 0) {
      output(``);
      output(`Affected files (${result.affectedFiles.length}):`);
      for (const f of result.affectedFiles) {
        output(`  ${f}`);
      }
    }

    if (result.fileRiskMetrics.length > 0) {
      output(``);
      output(`Risk Metrics`);
      output(`${"File".padEnd(50)} ${"Blast".padStart(8)} ${"Cmplx".padStart(8)} ${"Churn".padStart(8)}`);
      output(`${"─".repeat(50)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)}`);
      for (const m of result.fileRiskMetrics) {
        output(
          `${m.file.padEnd(50)} ${String(m.blastRadius).padStart(8)} ${m.complexity.toFixed(1).padStart(8)} ${String(m.churn).padStart(8)}`,
        );
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const depth = options.depth ? parseInt(options.depth, 10) : undefined;
    if (depth !== undefined && (isNaN(depth) || depth < 1)) {
      process.stderr.write("Error: --depth must be a positive integer\n");
      process.exit(2);
    }
    const result = computeDependents(graph, filePath, depth);

    if ("error" in result) {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Dependents: ${result.file}`);
    output("─".repeat(13 + result.file.length));
    output(`Risk level: ${result.riskLevel}`);
    output(`Total affected: ${result.totalAffected}`);
    output(``);

    if (result.directDependents.length > 0) {
      output(`Direct dependents (${result.directDependents.length}):`);
      for (const d of result.directDependents) {
        output(`  ${d.path} → {${d.symbols.join(", ")}}`);
      }
      output(``);
    }

    if (result.transitiveDependents.length > 0) {
      output(`Transitive dependents (${result.transitiveDependents.length}):`);
      for (const t of result.transitiveDependents) {
        output(`  ${t.path} (depth ${t.depth}, via ${t.throughPath.join(" → ")})`);
      }
    }
  });

// ── Subcommand: modules ────────────────────────────────────

program
  .command("modules")
  .description("Module architecture: cohesion, cross-module deps, circular deps")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeModuleStructure(graph);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Module Structure`);
    output(`────────────────`);
    output(`${"Path".padEnd(30)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Cohesion".padStart(10)} ${"EscVel".padStart(8)}`);
    output(`${"─".repeat(30)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(8)}`);
    for (const m of result.modules) {
      output(
        `${m.path.padEnd(30)} ${String(m.files).padStart(6)} ${String(m.loc).padStart(8)} ${m.cohesion.toFixed(2).padStart(10)} ${m.escapeVelocity.toFixed(2).padStart(8)}`,
      );
    }

    if (result.crossModuleDeps.length > 0) {
      output(``);
      output(`Cross-Module Dependencies (${result.crossModuleDeps.length}):`);
      for (const d of result.crossModuleDeps.slice(0, 20)) {
        output(`  ${d.from} → ${d.to} (weight: ${d.weight})`);
      }
    }

    if (result.circularDeps.length > 0) {
      output(``);
      output(`Circular Dependencies (${result.circularDeps.length}):`);
      for (const c of result.circularDeps) {
        output(`  [${c.severity}] ${c.cycle.map((p) => p.join(" → ")).join("; ")}`);
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const cohesion = options.cohesion ? parseFloat(options.cohesion) : undefined;
    const tension = options.tension ? parseFloat(options.tension) : undefined;
    const escape = options.escape ? parseFloat(options.escape) : undefined;
    const result = computeForces(graph, cohesion, tension, escape);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Force Analysis`);
    output(`──────────────`);
    output(result.summary);
    output(``);

    output(`Module Cohesion:`);
    for (const m of result.moduleCohesion) {
      output(`  ${m.path.padEnd(30)} ${m.verdict.padEnd(14)} cohesion: ${m.cohesion.toFixed(2)}`);
    }

    if (result.tensionFiles.length > 0) {
      output(``);
      output(`Tension Files (${result.tensionFiles.length}):`);
      for (const t of result.tensionFiles) {
        output(`  ${t.file} (tension: ${t.tension.toFixed(2)})`);
        for (const p of t.pulledBy) {
          output(`    ← ${p.module} (strength: ${p.strength.toFixed(2)}, symbols: ${p.symbols.join(", ")})`);
        }
      }
    }

    if (result.bridgeFiles.length > 0) {
      output(``);
      output(`Bridge Files (${result.bridgeFiles.length}):`);
      for (const b of result.bridgeFiles) {
        output(`  ${b.file} (betweenness: ${b.betweenness.toFixed(3)}, role: ${b.role})`);
      }
    }

    if (result.extractionCandidates.length > 0) {
      output(``);
      output(`Extraction Candidates (${result.extractionCandidates.length}):`);
      for (const e of result.extractionCandidates) {
        output(`  ${e.target} (escape velocity: ${e.escapeVelocity.toFixed(2)})`);
        output(`    ${e.recommendation}`);
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      process.stderr.write("Error: --limit must be a positive integer\n");
      process.exit(2);
    }
    const result = computeDeadExports(graph, options.module, limit);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Dead Exports`);
    output(`────────────`);
    output(result.summary);

    if (result.files.length > 0) {
      output(``);
      for (const f of result.files) {
        output(`${f.path} (${f.deadExports.length}/${f.totalExports} unused):`);
        for (const e of f.deadExports) {
          output(`  - ${e}`);
        }
      }
    }
  });

// ── Subcommand: groups ─────────────────────────────────────

program
  .command("groups")
  .description("Top-level directory groups with aggregate metrics")
  .argument("<path>", "Path to TypeScript codebase")
  .option("--json", "Output as JSON")
  .option("--force", "Re-index even if HEAD unchanged")
  .action((targetPath: string, options: CliCommandOptions) => {
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeGroups(graph);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Groups`);
    output(`──────`);
    output(`${"#".padStart(3)} ${"Name".padEnd(20)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Importance".padStart(12)} ${"Coupling".padStart(10)}`);
    output(`${"─".repeat(3)} ${"─".repeat(20)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(10)}`);
    for (const g of result.groups) {
      output(
        `${String(g.rank).padStart(3)} ${g.name.padEnd(20)} ${String(g.files).padStart(6)} ${String(g.loc).padStart(8)} ${g.importance.padStart(12)} ${String(g.coupling.total).padStart(10)}`,
      );
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const result = computeSymbolContext(graph, symbolName);

    if ("error" in result) {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Symbol: ${result.name}`);
    output("─".repeat(8 + result.name.length));
    output(`File:       ${result.file}`);
    output(`Type:       ${result.type}`);
    output(`LOC:        ${result.loc}`);
    output(`Default:    ${result.isDefault ? "yes" : "no"}`);
    output(`Complexity: ${result.complexity}`);
    output(`Fan-in:     ${result.fanIn}`);
    output(`Fan-out:    ${result.fanOut}`);
    output(`PageRank:   ${result.pageRank}`);
    output(`Betweenness:${result.betweenness}`);

    if (result.callers.length > 0) {
      output(``);
      output(`Callers (${result.callers.length}):`);
      for (const c of result.callers) {
        output(`  ${c.symbol} (${c.file}) [${c.confidence}]`);
      }
    }

    if (result.callees.length > 0) {
      output(``);
      output(`Callees (${result.callees.length}):`);
      for (const c of result.callees) {
        output(`  ${c.symbol} (${c.file}) [${c.confidence}]`);
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const result = impactAnalysis(graph, symbol);

    if (result.notFound) {
      process.stderr.write(`Error: Symbol not found: ${symbol}\n`);
      process.exit(1);
    }

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Impact Analysis: ${symbol}`);
    output("─".repeat(18 + symbol.length));
    output(`Total affected: ${result.totalAffected}`);

    if (result.levels.length > 0) {
      output(``);
      for (const level of result.levels) {
        output(`Depth ${level.depth} — ${level.risk} (${level.affected.length}):`);
        for (const a of level.affected) {
          output(`  ${a.symbol} (${a.file}) [${a.confidence}]`);
        }
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const dryRun = options.dryRun !== false;
    const result = renameSymbol(graph, oldName, newName, dryRun);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Rename: ${oldName} → ${newName}${dryRun ? " (dry run)" : ""}`);
    output("─".repeat(40));

    if (result.references.length === 0) {
      output(`No references found for "${oldName}"`);
      return;
    }

    output(`References (${result.references.length}):`);
    for (const ref of result.references) {
      output(`  ${ref.file} [${ref.confidence}] ${ref.symbol}`);
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      process.stderr.write("Error: --limit must be a positive integer\n");
      process.exit(2);
    }
    const result = computeProcesses(graph, options.entry, limit);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Processes (${result.processes.length} of ${result.totalProcesses})`);
    output("─".repeat(30));

    if (result.processes.length === 0) {
      output(`No processes found.`);
      return;
    }

    for (const p of result.processes) {
      output(``);
      output(`${p.name} (depth: ${p.depth}, modules: ${p.modulesTouched.join(", ")})`);
      output(`  Entry: ${p.entryPoint.file}::${p.entryPoint.symbol}`);
      for (const s of p.steps) {
        output(`  ${String(s.step).padStart(3)}. ${s.file}::${s.symbol}`);
      }
    }
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
    const { graph } = loadGraph(targetPath, options.force);
    const minFiles = options.minFiles ? parseInt(options.minFiles, 10) : undefined;
    if (minFiles !== undefined && (isNaN(minFiles) || minFiles < 1)) {
      process.stderr.write("Error: --min-files must be a positive integer\n");
      process.exit(2);
    }
    const result = computeClusters(graph, minFiles);

    if (options.json) {
      outputJson(result);
      return;
    }

    output(`Clusters (${result.clusters.length} of ${result.totalClusters})`);
    output("─".repeat(30));

    for (const c of result.clusters) {
      output(``);
      output(`${c.name} (${c.fileCount} files, cohesion: ${c.cohesion.toFixed(2)})`);
      for (const f of c.files) {
        output(`  ${f}`);
      }
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
  const indexDir = getIndexDir(targetPath);

  if (options.clean) {
    if (fs.existsSync(indexDir)) {
      fs.rmSync(indexDir, { recursive: true, force: true });
      progress(`Removed index at ${indexDir}`);
    } else {
      progress("No index found.");
    }
    return;
  }

  if (options.status) {
    const result = importGraph(indexDir);
    if (!result) {
      progress("No index found. Run with --index to create one.");
      return;
    }
    const metaPath = path.join(indexDir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
      headHash: string;
      timestamp: string;
    };
    progress(`Index status:`);
    progress(`  Head:      ${meta.headHash}`);
    progress(`  Indexed:   ${meta.timestamp}`);
    progress(`  Files:     ${result.graph.nodes.filter((n) => n.type === "file").length}`);
    progress(`  Symbols:   ${result.graph.symbolNodes.length}`);
    progress(`  Edges:     ${result.graph.edges.length}`);
    return;
  }

  const headHash = getHeadHash(targetPath);

  if (!options.force && headHash !== "unknown") {
    const cached = importGraph(indexDir);
    if (cached?.headHash === headHash) {
      progress(`Using cached index (HEAD: ${headHash.slice(0, 7)})`);
      setIndexedHead(cached.headHash);
      await startMcpServer(cached.graph);
      return;
    }
  }

  progress(`Parsing ${targetPath}...`);
  const files = parseCodebase(targetPath);
  progress(`Parsed ${files.length} files`);

  const built = buildGraph(files);
  progress(
    `Built graph: ${built.nodes.filter((n) => n.type === "file").length} files, ` +
      `${built.nodes.filter((n) => n.type === "function").length} functions, ` +
      `${built.edges.length} dependencies`,
  );

  const codebaseGraph = analyzeGraph(built, files);
  progress(
    `Analysis complete: ${codebaseGraph.stats.circularDeps.length} circular deps, ` +
      `${codebaseGraph.forceAnalysis.tensionFiles.length} tension files`,
  );

  setIndexedHead(headHash);

  if (options.index) {
    exportGraph(codebaseGraph, indexDir, headHash);
    progress(`Index saved to ${indexDir}`);
  }

  await startMcpServer(codebaseGraph);
}

// ── Default action: bare <path> → MCP mode ──────────────────

program
  .argument("[path]", "Path to codebase (starts MCP mode)")
  .option("--mcp", "Start as MCP stdio server (backward compatibility)")
  .option("--index", "Persist graph index to .code-visualizer/")
  .option("--force", "Re-index even if HEAD unchanged")
  .option("--status", "Print index status and exit")
  .option("--clean", "Remove .code-visualizer/ index and exit")
  .action(async (targetPath: string | undefined, options: McpOptions) => {
    if (!targetPath) {
      program.help();
      return;
    }
    await runMcpMode(targetPath, options);
  });

program.parse();
