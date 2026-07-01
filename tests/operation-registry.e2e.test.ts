import { spawnSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { OverviewResult } from "../src/core/index.js";
import { operations, runOperation, type Operation } from "../src/operations/index.js";
import type { CodebaseGraph } from "../src/types/index.js";
import { createFixtureMcp, type FixtureMcp } from "./helpers/mcp.js";
import { getFixturePipeline, getFixtureSrcPath } from "./helpers/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");

interface OverviewParityPayload {
  totalFiles: unknown;
  totalFunctions: unknown;
  totalDependencies: unknown;
  modules: unknown;
  topDependedFiles: unknown;
  metrics: unknown;
  analysis: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed;
}

function normalizeOverviewResult(result: OverviewResult): OverviewParityPayload {
  return {
    totalFiles: result.totalFiles,
    totalFunctions: result.totalFunctions,
    totalDependencies: result.totalDependencies,
    modules: result.modules,
    topDependedFiles: result.topDependedFiles,
    metrics: result.metrics,
    analysis: result.analysis,
  };
}

function normalizeOverviewPayload(payload: Record<string, unknown>): OverviewParityPayload {
  return {
    totalFiles: payload.totalFiles,
    totalFunctions: payload.totalFunctions,
    totalDependencies: payload.totalDependencies,
    modules: payload.modules,
    topDependedFiles: payload.topDependedFiles,
    metrics: payload.metrics,
    analysis: payload.analysis,
  };
}

function withoutNextSteps(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  delete normalized.nextSteps;
  return normalized;
}

function withoutCache(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  delete normalized.cache;
  return normalized;
}

async function expectMcpMatchesRegistry<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: TInput,
  mcpArgs: Record<string, unknown>,
  graph: CodebaseGraph,
  mcp: FixtureMcp,
): Promise<void> {
  const registryResult = runOperation(operation, graph, input);
  expect(registryResult.ok).toBe(true);
  if (!registryResult.ok) throw new Error(registryResult.error);

  const mcpPayload = await mcp.callTool(operation.mcpTool, mcpArgs);
  expect(withoutNextSteps(mcpPayload)).toEqual(registryResult.data);
}

function runCliJson(args: string[]): Record<string, unknown> {
  const res = spawnSync("node", [cli, ...args, "--json", "--force"], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf-8",
  });

  expect(res.status).toBe(0);
  expect(res.stderr).toContain("Parsed");
  return parseJsonObject(res.stdout);
}

function expectCliMatchesRegistry<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: TInput,
  cliArgs: string[],
  graph: CodebaseGraph,
): void {
  const registryResult = runOperation(operation, graph, input);
  expect(registryResult.ok).toBe(true);
  if (!registryResult.ok) throw new Error(registryResult.error);

  const cliPayload = runCliJson(cliArgs);
  expect(withoutCache(cliPayload)).toEqual(registryResult.data);
}

beforeAll(() => {
  execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

describe("operation registry chained parity", () => {
  it("CH-P1-01: returns equivalent overview facts through registry, CLI, and MCP", async () => {
    const { codebaseGraph } = getFixturePipeline();
    const registryResult = runOperation(operations.overview, codebaseGraph, {});
    expect(registryResult.ok).toBe(true);
    if (!registryResult.ok) throw new Error(registryResult.error);

    const cliPayload = runCliJson(["overview", getFixtureSrcPath()]);
    expect(cliPayload).toHaveProperty("cache");

    const mcp = await createFixtureMcp();
    const mcpPayload = await mcp.callTool("codebase_overview");
    expect(mcpPayload).toHaveProperty("nextSteps");

    const registryOverview = normalizeOverviewResult(registryResult.data);
    expect(normalizeOverviewPayload(cliPayload)).toEqual(registryOverview);
    expect(normalizeOverviewPayload(mcpPayload)).toEqual(registryOverview);
  });

  it("CH-P1-01: registry-adapted CLI JSON commands match descriptor runs", () => {
    const { codebaseGraph } = getFixturePipeline();

    expectCliMatchesRegistry(
      operations.fileContext,
      { filePath: "index.ts" },
      ["file", getFixtureSrcPath(), "index.ts"],
      codebaseGraph,
    );
    expectCliMatchesRegistry(
      operations.hotspots,
      { metric: "coupling", limit: 3 },
      ["hotspots", getFixtureSrcPath(), "--metric", "coupling", "--limit", "3"],
      codebaseGraph,
    );
    expectCliMatchesRegistry(
      operations.impact,
      { symbol: "getUserById" },
      ["impact", getFixtureSrcPath(), "getUserById"],
      codebaseGraph,
    );
  });

  it("CH-P1-02: CLI invalid input uses descriptor validation before indexing", () => {
    const res = spawnSync("node", [cli, "hotspots", getFixtureSrcPath(), "--metric", "bad", "--json"], {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: "utf-8",
    });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Error: metric: Invalid enum value");
    expect(res.stderr).not.toContain("Parsing");
  });

  it("CH-P1-01: registry-adapted MCP tools match descriptor runs", async () => {
    const { codebaseGraph } = getFixturePipeline();
    const mcp = await createFixtureMcp();

    await expectMcpMatchesRegistry(
      operations.fileContext,
      { filePath: "index.ts" },
      { filePath: "index.ts" },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.hotspots,
      { metric: "coupling", limit: 3 },
      { metric: "coupling", limit: 3 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.impact,
      { symbol: "getUserById" },
      { symbol: "getUserById" },
      codebaseGraph,
      mcp,
    );
  });
});
