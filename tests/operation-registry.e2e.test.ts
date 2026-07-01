import { spawnSync, execSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { OverviewResult } from "../src/core/index.js";
import { operations, runOperation, type Operation, type OperationContext } from "../src/operations/index.js";
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

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  expect(Array.isArray(value)).toBe(true);
  if (!Array.isArray(value)) throw new Error(`Expected ${label} array`);
  return value.filter(isRecord);
}

function familyMembers(family: Record<string, unknown>): string[] {
  return recordArray(family.members, "members")
    .map((member) => {
      if (typeof member.file !== "string" || typeof member.symbol !== "string") {
        throw new Error("Expected duplicate member file and symbol strings");
      }
      return `${member.file}::${member.symbol}`;
    })
    .sort();
}

function findFamily(payload: Record<string, unknown>, expectedMembers: string[]): Record<string, unknown> {
  const sortedExpected = [...expectedMembers].sort();
  const match = recordArray(payload.families, "families").find((family) => {
    const members = familyMembers(family);
    return sortedExpected.every((member) => members.includes(member));
  });
  if (!match) throw new Error(`Expected duplicate family containing ${sortedExpected.join(", ")}`);
  return match;
}

function familyIds(payload: Record<string, unknown>): unknown[] {
  return recordArray(payload.families, "families").map((family) => family.id);
}

async function expectMcpMatchesRegistry<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: TInput,
  mcpArgs: Record<string, unknown>,
  graph: CodebaseGraph,
  mcp: FixtureMcp,
  context: OperationContext = {},
): Promise<void> {
  const registryResult = runOperation(operation, graph, input, context);
  expect(registryResult.ok).toBe(true);
  if (!registryResult.ok) throw new Error(registryResult.error);

  const mcpPayload = await mcp.callTool(operation.mcpTool, mcpArgs);
  expect(withoutNextSteps(mcpPayload)).toEqual(registryResult.data);
}

interface CliRunOptions {
  force?: boolean;
}

function runCli(args: string[], options: CliRunOptions = {}): SpawnSyncReturns<string> {
  const cliArgs = ["node", cli, ...args, "--json"];
  if (options.force !== false) {
    cliArgs.push("--force");
  }

  return spawnSync(cliArgs[0], cliArgs.slice(1), {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf-8",
  });
}

function runCliText(args: string[], options: CliRunOptions = {}): SpawnSyncReturns<string> {
  const cliArgs = ["node", cli, ...args];
  if (options.force !== false) {
    cliArgs.push("--force");
  }

  return spawnSync(cliArgs[0], cliArgs.slice(1), {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf-8",
  });
}

function runCliJson(args: string[], options: CliRunOptions = {}): Record<string, unknown> {
  const res = runCli(args, options);

  expect(res.status).toBe(0);
  if (options.force !== false) {
    expect(res.stderr).toContain("Parsed");
  }
  return parseJsonObject(res.stdout);
}

function expectCliMatchesRegistry<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: TInput,
  cliArgs: string[],
  graph: CodebaseGraph,
  context: OperationContext = {},
  runOptions: CliRunOptions = {},
): void {
  const registryResult = runOperation(operation, graph, input, context);
  expect(registryResult.ok).toBe(true);
  if (!registryResult.ok) throw new Error(registryResult.error);

  const cliPayload = runCliJson(cliArgs, runOptions);
  expect(withoutCache(cliPayload)).toEqual(registryResult.data);
}

function expectCliTextMatchesFormatter<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: TInput,
  cliArgs: string[],
  graph: CodebaseGraph,
  context: OperationContext = {},
  runOptions: CliRunOptions = {},
): void {
  const registryResult = runOperation(operation, graph, input, context);
  expect(registryResult.ok).toBe(true);
  if (!registryResult.ok) throw new Error(registryResult.error);

  const cliResult = runCliText(cliArgs, runOptions);
  expect(cliResult.status).toBe(0);
  expect(cliResult.stdout).toBe(`${operation.formatText(registryResult.data, input)}\n`);
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

  it("CH-P1-01: registry-adapted CLI JSON commands match descriptor runs for every operation", () => {
    const { codebaseGraph } = getFixturePipeline();
    runCliJson(["overview", getFixtureSrcPath()]);
    const cachedRun = { force: false };

    expectCliMatchesRegistry(operations.overview, {}, ["overview", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliMatchesRegistry(
      operations.fileContext,
      { filePath: "index.ts" },
      ["file", getFixtureSrcPath(), "index.ts"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.dependents,
      { filePath: "auth/auth-service.ts", depth: 2 },
      ["dependents", getFixtureSrcPath(), "auth/auth-service.ts", "--depth", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.hotspots,
      { metric: "coupling", limit: 3 },
      ["hotspots", getFixtureSrcPath(), "--metric", "coupling", "--limit", "3"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(operations.moduleStructure, {}, ["modules", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliMatchesRegistry(
      operations.forces,
      { cohesionThreshold: 0.6, tensionThreshold: 0.3, escapeThreshold: 0.5 },
      ["forces", getFixtureSrcPath(), "--cohesion", "0.6", "--tension", "0.3", "--escape", "0.5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.deadExports,
      { limit: 5 },
      ["dead-exports", getFixtureSrcPath(), "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.opportunities,
      { limit: 5 },
      ["opportunities", getFixtureSrcPath(), "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.duplication,
      { mode: "mild", minTokens: 8, skipLocal: false },
      ["duplicates", getFixtureSrcPath(), "--mode", "mild", "--min-tokens", "8"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(operations.groups, {}, ["groups", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliMatchesRegistry(
      operations.symbolContext,
      { name: "getUserById" },
      ["symbol", getFixtureSrcPath(), "getUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.search,
      { query: "auth", limit: 5 },
      ["search", getFixtureSrcPath(), "auth", "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.changes,
      { scope: "all" },
      ["changes", getFixtureSrcPath(), "--scope", "all"],
      codebaseGraph,
      { rootDir: getFixtureSrcPath() },
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.impact,
      { symbol: "getUserById" },
      ["impact", getFixtureSrcPath(), "getUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.rename,
      { oldName: "getUserById", newName: "findUserById", dryRun: true },
      ["rename", getFixtureSrcPath(), "getUserById", "findUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.processes,
      { entryPoint: "main", limit: 1 },
      ["processes", getFixtureSrcPath(), "--entry", "main", "--limit", "1"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.codebaseMap,
      { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      ["map", getFixtureSrcPath(), "--focus", "UserService.getUserById", "--depth", "1", "--context-budget", "420"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.contentDrift,
      { scope: "users", minScore: 35 },
      ["drift", getFixtureSrcPath(), "--scope", "users", "--min-score", "35"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.health,
      { minScore: 0, score: false },
      ["health", getFixtureSrcPath(), "--min-score", "0"],
      codebaseGraph,
      { rootDir: getFixtureSrcPath() },
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.highways,
      { operation: "get", minRoutes: 2 },
      ["highways", getFixtureSrcPath(), "--operation", "get", "--min-routes", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliMatchesRegistry(
      operations.clusters,
      { minFiles: 2 },
      ["clusters", getFixtureSrcPath(), "--min-files", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
  });

  it("CH-P1-01: registry-adapted CLI text commands render through descriptor formatters for every operation", () => {
    const { codebaseGraph } = getFixturePipeline();
    runCliJson(["overview", getFixtureSrcPath()]);
    const cachedRun = { force: false };

    expectCliTextMatchesFormatter(operations.overview, {}, ["overview", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliTextMatchesFormatter(
      operations.fileContext,
      { filePath: "index.ts" },
      ["file", getFixtureSrcPath(), "index.ts"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.dependents,
      { filePath: "auth/auth-service.ts", depth: 2 },
      ["dependents", getFixtureSrcPath(), "auth/auth-service.ts", "--depth", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.hotspots,
      { metric: "coupling", limit: 3 },
      ["hotspots", getFixtureSrcPath(), "--metric", "coupling", "--limit", "3"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(operations.moduleStructure, {}, ["modules", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliTextMatchesFormatter(
      operations.forces,
      { cohesionThreshold: 0.6, tensionThreshold: 0.3, escapeThreshold: 0.5 },
      ["forces", getFixtureSrcPath(), "--cohesion", "0.6", "--tension", "0.3", "--escape", "0.5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.deadExports,
      { limit: 5 },
      ["dead-exports", getFixtureSrcPath(), "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.opportunities,
      { limit: 5 },
      ["opportunities", getFixtureSrcPath(), "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.duplication,
      { mode: "mild", minTokens: 8, skipLocal: false },
      ["duplicates", getFixtureSrcPath(), "--mode", "mild", "--min-tokens", "8"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(operations.groups, {}, ["groups", getFixtureSrcPath()], codebaseGraph, {}, cachedRun);
    expectCliTextMatchesFormatter(
      operations.symbolContext,
      { name: "getUserById" },
      ["symbol", getFixtureSrcPath(), "getUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.search,
      { query: "auth", limit: 5 },
      ["search", getFixtureSrcPath(), "auth", "--limit", "5"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.changes,
      { scope: "all" },
      ["changes", getFixtureSrcPath(), "--scope", "all"],
      codebaseGraph,
      { rootDir: getFixtureSrcPath() },
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.impact,
      { symbol: "getUserById" },
      ["impact", getFixtureSrcPath(), "getUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.rename,
      { oldName: "getUserById", newName: "findUserById", dryRun: true },
      ["rename", getFixtureSrcPath(), "getUserById", "findUserById"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.processes,
      { entryPoint: "main", limit: 1 },
      ["processes", getFixtureSrcPath(), "--entry", "main", "--limit", "1"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.codebaseMap,
      { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      ["map", getFixtureSrcPath(), "--focus", "UserService.getUserById", "--depth", "1", "--context-budget", "420"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.contentDrift,
      { scope: "users", minScore: 35 },
      ["drift", getFixtureSrcPath(), "--scope", "users", "--min-score", "35"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.health,
      { minScore: 0, score: true },
      ["health", getFixtureSrcPath(), "--score", "--min-score", "0"],
      codebaseGraph,
      { rootDir: getFixtureSrcPath() },
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.highways,
      { operation: "get", minRoutes: 2 },
      ["highways", getFixtureSrcPath(), "--operation", "get", "--min-routes", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
    expectCliTextMatchesFormatter(
      operations.clusters,
      { minFiles: 2 },
      ["clusters", getFixtureSrcPath(), "--min-files", "2"],
      codebaseGraph,
      {},
      cachedRun,
    );
  });

  it("CH-P1-02: invalid input uses shared descriptor validation before indexing", async () => {
    const res = runCli(["hotspots", getFixtureSrcPath(), "--metric", "bad"], { force: false });

    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Error: metric: Invalid enum value");
    expect(res.stderr).not.toContain("Parsing");

    const cliError = res.stderr.trim().replace(/^Error: /, "");
    const mcp = await createFixtureMcp();
    const mcpResult = await mcp.callToolWithMeta("find_hotspots", { metric: "bad" });
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.payload).toEqual({ error: cliError });
  });

  it("CH-P1-02: CLI graph adapter reports parse failures without JSON noise", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-empty-"));
    try {
      const res = runCli(["overview", tempDir], { force: false });
      expect(res.status).toBe(1);
      expect(res.stdout).toBe("");
      expect(res.stderr).toContain("Error: No TypeScript files found");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("CH-P1-02: shared graph-load pipeline reuses cache after a successful registry command", () => {
    const first = runCli(["overview", getFixtureSrcPath()]);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain("Index saved");

    const second = runCli(["overview", getFixtureSrcPath()], { force: false });
    expect(second.status).toBe(0);
    expect(second.stderr).toContain("Using cached index");
    expect(withoutCache(parseJsonObject(second.stdout))).toEqual(withoutCache(parseJsonObject(first.stdout)));
  });

  it("CH-P1-03: type/shape facts flow through real CLI and MCP surfaces", async () => {
    runCliJson(["overview", getFixtureSrcPath()]);
    const cachedRun = { force: false };

    const cliFile = runCliJson(["file", getFixtureSrcPath(), "users/user-service.ts"], cachedRun);
    const fileExports = cliFile.exports;
    expect(Array.isArray(fileExports)).toBe(true);
    if (!Array.isArray(fileExports)) throw new Error("Expected file exports array");
    const userServiceExport = fileExports.find((fileExport) =>
      isRecord(fileExport) && fileExport.name === "UserService"
    );
    expect(userServiceExport).toMatchObject({
      name: "UserService",
      typeFacts: {
        produces: ["UserService"],
        confidence: "resolved",
      },
    });

    const cliSymbol = runCliJson(["symbol", getFixtureSrcPath(), "UserService.createUser"], cachedRun);
    expect(cliSymbol).toMatchObject({
      name: "UserService.createUser",
      typeFacts: {
        returnType: "User",
        consumes: ["CreateUserInput"],
        produces: ["User"],
        confidence: "resolved",
      },
    });

    const cliSearch = runCliJson(["search", getFixtureSrcPath(), "CreateUserInput", "--limit", "5"], cachedRun);
    const searchResults = cliSearch.results;
    expect(Array.isArray(searchResults)).toBe(true);
    if (!Array.isArray(searchResults)) throw new Error("Expected search results array");
    const searchSymbols: unknown[] = [];
    for (const result of searchResults) {
      if (!isRecord(result) || !Array.isArray(result.symbols)) continue;
      for (const symbol of result.symbols) {
        searchSymbols.push(symbol);
      }
    }
    expect(searchSymbols.some((symbol) =>
      isRecord(symbol)
      && symbol.name === "UserService.createUser"
      && isRecord(symbol.typeFacts)
      && Array.isArray(symbol.typeFacts.consumes)
      && symbol.typeFacts.consumes.includes("CreateUserInput")
    )).toBe(true);

    const mcp = await createFixtureMcp();
    const mcpSymbol = await mcp.callTool("symbol_context", { name: "UserService.createUser" });
    expect(withoutNextSteps(mcpSymbol)).toEqual(withoutCache(cliSymbol));
  });

  it("CH-P1-04: duplicate families support strict/mild/weak modes, trace, and local skipping", async () => {
    runCliJson(["overview", getFixtureSrcPath()]);
    const cachedRun = { force: false };
    const exactMembers = [
      "duplication/exact-a.ts::normalizeEmail",
      "duplication/exact-b.ts::formatAccountEmail",
    ];
    const renamedMember = "duplication/renamed.ts::sanitizeContactEmail";
    const nearMissMember = "duplication/near-miss.ts::prepareInviteEmail";
    const localMembers = [
      "duplication/local-only.ts::localSortOne",
      "duplication/local-only.ts::localSortTwo",
    ];

    const strictPayload = runCliJson(["duplicates", getFixtureSrcPath(), "--mode", "strict", "--min-tokens", "8"], cachedRun);
    expect(strictPayload).toMatchObject({ mode: "strict", threshold: 1, minTokens: 8, skipLocal: false });
    const strictFamily = findFamily(strictPayload, exactMembers);
    expect(strictFamily.id).toMatch(/^dup-strict-[a-f0-9]{10}$/);
    expect(familyMembers(strictFamily)).toEqual(exactMembers);
    const strictAgain = runCliJson(["duplicates", getFixtureSrcPath(), "--mode", "strict", "--min-tokens", "8"], cachedRun);
    expect(familyIds(strictAgain)).toEqual(familyIds(strictPayload));

    const mildPayload = runCliJson(["duplicates", getFixtureSrcPath(), "--mode", "mild", "--min-tokens", "8"], cachedRun);
    expect(mildPayload).toMatchObject({ mode: "mild", threshold: 1, minTokens: 8 });
    const mildFamily = findFamily(mildPayload, [...exactMembers, renamedMember]);
    expect(familyMembers(mildFamily)).toContain(renamedMember);
    expect(String(mildFamily.id)).toMatch(/^dup-mild-[a-f0-9]{10}$/);

    const weakPayload = runCliJson(["duplicates", getFixtureSrcPath(), "--mode", "weak", "--min-tokens", "8"], cachedRun);
    expect(weakPayload).toMatchObject({ mode: "weak", threshold: 0.72, minTokens: 8 });
    const weakFamily = findFamily(weakPayload, [...exactMembers, renamedMember, nearMissMember]);
    expect(familyMembers(weakFamily)).not.toContain("duplication/noise.ts::tinyNoise");

    const skipLocalPayload = runCliJson(
      ["duplicates", getFixtureSrcPath(), "--mode", "mild", "--min-tokens", "8", "--skip-local"],
      cachedRun,
    );
    const skippedMembers = recordArray(skipLocalPayload.families, "families").flatMap(familyMembers);
    expect(skippedMembers).not.toContain(localMembers[0]);
    expect(skippedMembers).not.toContain(localMembers[1]);

    const traceId = String(mildFamily.id);
    const tracePayload = runCliJson(
      ["duplicates", getFixtureSrcPath(), "--mode", "mild", "--min-tokens", "8", "--trace", traceId],
      cachedRun,
    );
    expect(tracePayload.trace).toMatchObject({ id: traceId, found: true, mode: "mild", threshold: 1 });
    const trace = tracePayload.trace;
    expect(isRecord(trace)).toBe(true);
    if (!isRecord(trace)) throw new Error("Expected trace object");
    expect(recordArray(trace.members, "trace.members")).toHaveLength(familyMembers(mildFamily).length);
    expect(recordArray(trace.pairwise, "trace.pairwise").length).toBeGreaterThan(0);

    const mcp = await createFixtureMcp();
    const mcpWeak = await mcp.callTool("find_duplicates", { mode: "weak", minTokens: 8 });
    expect(withoutNextSteps(mcpWeak)).toEqual(withoutCache(weakPayload));
    const mcpTrace = await mcp.callTool("find_duplicates", { mode: "mild", minTokens: 8, trace: traceId });
    expect(withoutNextSteps(mcpTrace)).toEqual(withoutCache(tracePayload));
  });

  it("CH-P1-01: registry-adapted MCP tools match descriptor runs for every operation", async () => {
    const { codebaseGraph } = getFixturePipeline();
    const mcp = await createFixtureMcp();

    await expectMcpMatchesRegistry(operations.overview, {}, {}, codebaseGraph, mcp);
    await expectMcpMatchesRegistry(
      operations.fileContext,
      { filePath: "index.ts" },
      { filePath: "index.ts" },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.dependents,
      { filePath: "auth/auth-service.ts", depth: 2 },
      { filePath: "auth/auth-service.ts", depth: 2 },
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
    await expectMcpMatchesRegistry(operations.moduleStructure, {}, {}, codebaseGraph, mcp);
    await expectMcpMatchesRegistry(
      operations.forces,
      { cohesionThreshold: 0.6, tensionThreshold: 0.3, escapeThreshold: 0.5 },
      { cohesionThreshold: 0.6, tensionThreshold: 0.3, escapeThreshold: 0.5 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.deadExports,
      { limit: 5 },
      { limit: 5 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.opportunities,
      { limit: 5 },
      { limit: 5 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.duplication,
      { mode: "mild", minTokens: 8, skipLocal: false },
      { mode: "mild", minTokens: 8, skipLocal: false },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(operations.groups, {}, {}, codebaseGraph, mcp);
    await expectMcpMatchesRegistry(
      operations.symbolContext,
      { name: "getUserById" },
      { name: "getUserById" },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.search,
      { query: "auth", limit: 5 },
      { query: "auth", limit: 5 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.changes,
      { scope: "all" },
      { scope: "all" },
      codebaseGraph,
      mcp,
      { rootDir: getFixtureSrcPath() },
    );
    await expectMcpMatchesRegistry(
      operations.impact,
      { symbol: "getUserById" },
      { symbol: "getUserById" },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.rename,
      { oldName: "getUserById", newName: "findUserById", dryRun: true },
      { oldName: "getUserById", newName: "findUserById", dryRun: true },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.processes,
      { entryPoint: "main", limit: 1 },
      { entryPoint: "main", limit: 1 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.codebaseMap,
      { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.contentDrift,
      { scope: "users", minScore: 35 },
      { scope: "users", minScore: 35 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.health,
      { minScore: 0 },
      { minScore: 0 },
      codebaseGraph,
      mcp,
      { rootDir: getFixtureSrcPath() },
    );
    await expectMcpMatchesRegistry(
      operations.highways,
      { operation: "get", minRoutes: 2 },
      { operation: "get", minRoutes: 2 },
      codebaseGraph,
      mcp,
    );
    await expectMcpMatchesRegistry(
      operations.clusters,
      { minFiles: 2 },
      { minFiles: 2 },
      codebaseGraph,
      mcp,
    );
  });
});
