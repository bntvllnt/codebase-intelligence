import { execFile, execSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { getFixtureSrcPath } from "./helpers/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface MapEvidence {
  id: string;
  kind: string;
  summary: string;
}

interface MapNode {
  id: string;
  kind: string;
  label: string;
  file?: string;
  symbol?: string;
  evidenceIds: string[];
}

interface MapEdge {
  id: string;
  kind: string;
  from: string;
  to: string;
  evidenceIds: string[];
}

interface ContextPack {
  tokenBudget: number;
  tokenEstimate: number;
  rankedFiles: Array<{ path: string; rank: number; tokenEstimate: number; evidenceIds: string[] }>;
  rankedSymbols: Array<{ file: string; symbol: string; rank: number; tokenEstimate: number; evidenceIds: string[] }>;
  tests: Array<{ path: string; covers: string; rank: number; tokenEstimate: number; evidenceIds: string[] }>;
  evidenceIds: string[];
}

interface CodebaseMapPayload {
  overview: {
    focus?: string;
    depth: number;
    contextBudget: number;
  };
  focus?: MapNode;
  nodes: MapNode[];
  edges: MapEdge[];
  evidence: MapEvidence[];
  contextPack: ContextPack;
  cache?: unknown;
  nextSteps?: unknown;
}

beforeAll(() => {
  execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodebaseMapPayload(value: unknown): value is CodebaseMapPayload {
  return isRecord(value)
    && isRecord(value.overview)
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && Array.isArray(value.evidence)
    && isRecord(value.contextPack);
}

function parsePayload(stdout: string): CodebaseMapPayload {
  const parsed: unknown = JSON.parse(stdout);
  if (!isCodebaseMapPayload(parsed)) throw new Error("Expected codebase map JSON object");
  return parsed;
}

function withoutRuntimeFields(payload: CodebaseMapPayload): Omit<CodebaseMapPayload, "cache" | "nextSteps"> {
  const copy = { ...payload };
  delete copy.cache;
  delete copy.nextSteps;
  return copy;
}

async function run(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await pexec("node", [cli, ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    const err = isRecord(e) ? e : {};
    return {
      status: typeof err.code === "number" ? err.code : 1,
      stdout: typeof err.stdout === "string" ? err.stdout : "",
      stderr: typeof err.stderr === "string" ? err.stderr : "",
    };
  }
}

function textPayload(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("MCP result did not include content");
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") throw new Error("MCP result did not include text content");
  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) throw new Error("MCP text content was not a JSON object");
  return parsed;
}

function assertEvidenceReferences(payload: CodebaseMapPayload): void {
  const evidenceIds = new Set(payload.evidence.map((item) => item.id));
  expect(evidenceIds.size).toBe(payload.evidence.length);
  for (const evidence of payload.evidence) {
    expect(evidence.id).toMatch(/^evidence-[a-f0-9]{10}$/);
    expect(evidence.summary.length).toBeGreaterThan(0);
  }
  for (const node of payload.nodes) {
    expect(node.id.length).toBeGreaterThan(0);
    expect(node.evidenceIds.length).toBeGreaterThan(0);
    expect(node.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
  }
  for (const edge of payload.edges) {
    expect(edge.id).toMatch(/^edge-[a-f0-9]{10}$/);
    expect(edge.evidenceIds.length).toBeGreaterThan(0);
    expect(edge.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
  }
  expect(payload.contextPack.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
}

describe("CH-P2-03 codebase map context pack", () => {
  it("returns focused graph evidence and a token-bounded context pack through CLI and MCP", async () => {
    const src = getFixtureSrcPath();
    const args = ["map", src, "--focus", "UserService.getUserById", "--depth", "1", "--context-budget", "420", "--json", "--force"];
    const cliRun = await run(args);
    expect(cliRun.status).toBe(0);
    expect(cliRun.stderr).toContain("Parsed");

    const cliPayload = parsePayload(cliRun.stdout);
    expect(cliPayload.overview).toMatchObject({
      focus: "UserService.getUserById",
      depth: 1,
      contextBudget: 420,
    });
    expect(cliPayload.focus).toMatchObject({
      kind: "symbol",
      label: "UserService.getUserById",
      file: "users/user-service.ts",
      symbol: "UserService.getUserById",
    });
    expect(cliPayload.nodes.some((node) => node.kind === "file" && node.file === "users/user-service.ts")).toBe(true);
    expect(cliPayload.nodes.some((node) => node.kind === "symbol" && node.symbol === "getUserById")).toBe(true);
    expect(cliPayload.edges.some((edge) => edge.kind === "calls")).toBe(true);
    expect(cliPayload.edges.some((edge) => edge.kind === "contains")).toBe(true);
    assertEvidenceReferences(cliPayload);

    expect(cliPayload.contextPack.tokenEstimate).toBeLessThanOrEqual(cliPayload.contextPack.tokenBudget);
    expect(cliPayload.contextPack.rankedFiles[0]).toMatchObject({ path: "users/user-service.ts", rank: 1 });
    expect(cliPayload.contextPack.rankedSymbols.some((item) => item.symbol === "UserService.getUserById")).toBe(true);
    expect(cliPayload.contextPack.tests).toContainEqual(expect.objectContaining({
      path: "users/user-service.spec.ts",
      covers: "users/user-service.ts",
    }));

    const jsonFormatRun = await run(["map", src, "--focus", "UserService.getUserById", "--format", "json", "--force"]);
    expect(jsonFormatRun.status).toBe(0);
    expect(parsePayload(jsonFormatRun.stdout).overview.focus).toBe("UserService.getUserById");

    const dotRun = await run(["map", src, "--focus", "UserService.getUserById", "--format", "dot", "--force"]);
    expect(dotRun.status).toBe(0);
    expect(dotRun.stdout).toContain("digraph CodebaseMap");
    expect(dotRun.stdout).toContain("->");

    const graphmlRun = await run(["map", src, "--focus", "UserService.getUserById", "--format", "graphml", "--force"]);
    expect(graphmlRun.status).toBe(0);
    expect(graphmlRun.stdout).toContain("<graphml");
    expect(graphmlRun.stdout).toContain("<edge");

    const transport = new StdioClientTransport({
      command: "node",
      args: [cli, src, "--force"],
      cwd: repoRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "map-e2e", version: "0.1.0" });
    await client.connect(transport);
    try {
      const mapResult = await client.callTool({
        name: "get_codebase_map",
        arguments: { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      });
      const mcpMap = textPayload(mapResult);
      if (!isCodebaseMapPayload(mcpMap)) throw new Error("Expected MCP map payload");
      expect(withoutRuntimeFields(mcpMap)).toEqual(withoutRuntimeFields(cliPayload));

      const contextResult = await client.callTool({
        name: "get_context_pack",
        arguments: { focus: "UserService.getUserById", depth: 1, contextBudget: 420 },
      });
      const mcpContext = textPayload(contextResult);
      expect(mcpContext).toMatchObject(cliPayload.contextPack);
      expect(mcpContext).toHaveProperty("nextSteps");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 120_000);
});
