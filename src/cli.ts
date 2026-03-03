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

const INDEX_DIR_NAME = ".code-visualizer";
const program = new Command();

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

interface CliOptions {
  mcp?: boolean;
  index?: boolean;
  force?: boolean;
  status?: boolean;
  clean?: boolean;
}

program
  .name("codebase-intelligence")
  .description("Codebase analysis engine with MCP integration for LLM-assisted code understanding")
  .version(pkg.version)
  .argument("<path>", "Path to the TypeScript codebase to analyze")
  .option("--mcp", "Start as MCP stdio server (accepted for backward compatibility)")
  .option("--index", "Persist graph index to .code-visualizer/")
  .option("--force", "Re-index even if HEAD unchanged")
  .option("--status", "Print index status and exit")
  .option("--clean", "Remove .code-visualizer/ index and exit")
  .action(async (targetPath: string, options: CliOptions) => {
    try {
      const indexDir = getIndexDir(targetPath);

      if (options.clean) {
        if (fs.existsSync(indexDir)) {
          fs.rmSync(indexDir, { recursive: true, force: true });
          console.log(`Removed index at ${indexDir}`);
        } else {
          console.log("No index found.");
        }
        return;
      }

      if (options.status) {
        const result = importGraph(indexDir);
        if (!result) {
          console.log("No index found. Run with --index to create one.");
          return;
        }
        const metaPath = path.join(indexDir, "meta.json");
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
          headHash: string;
          timestamp: string;
        };
        console.log(`Index status:`);
        console.log(`  Head:      ${meta.headHash}`);
        console.log(`  Indexed:   ${meta.timestamp}`);
        console.log(`  Files:     ${result.graph.nodes.filter((n) => n.type === "file").length}`);
        console.log(`  Symbols:   ${result.graph.symbolNodes.length}`);
        console.log(`  Edges:     ${result.graph.edges.length}`);
        return;
      }

      const headHash = getHeadHash(targetPath);

      if (!options.force) {
        const cached = importGraph(indexDir);
        if (cached?.headHash === headHash) {
          console.log(`Using cached index (HEAD: ${headHash.slice(0, 7)})`);
          const codebaseGraph = cached.graph;
          setIndexedHead(cached.headHash);
          await startMcpServer(codebaseGraph);
          return;
        }
      }

      console.log(`Parsing ${targetPath}...`);
      const files = parseCodebase(targetPath);
      console.log(`Parsed ${files.length} files`);

      const built = buildGraph(files);
      console.log(
        `Built graph: ${built.nodes.filter((n) => n.type === "file").length} files, ` +
          `${built.nodes.filter((n) => n.type === "function").length} functions, ` +
          `${built.edges.length} dependencies`,
      );

      const codebaseGraph = analyzeGraph(built, files);
      console.log(
        `Analysis complete: ${codebaseGraph.stats.circularDeps.length} circular deps, ` +
          `${codebaseGraph.forceAnalysis.tensionFiles.length} tension files`,
      );

      setIndexedHead(headHash);

      if (options.index) {
        exportGraph(codebaseGraph, indexDir, headHash);
        console.log(`Index saved to ${indexDir}`);
      }

      await startMcpServer(codebaseGraph);
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error("Unknown error:", error);
      }
      process.exit(1);
    }
  });

program.parse();
