import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Stream } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface HighwayRouteStep {
  file: string;
  symbol: string;
  proposed?: boolean;
}

interface HighwayRoute {
  entryPoint: HighwayRouteStep;
  steps: HighwayRouteStep[];
  includesCanonical: boolean;
}

interface HighwayProposal {
  name: string;
  file: string;
  signature: string;
  skeleton: string;
  reroutePlan: Array<{
    entryPoint: string;
    replaceSteps: string[];
    call: string;
  }>;
  cycleSafety: {
    safe: boolean;
    checkedEdges: string[];
    reason: string;
  };
}

interface HighwayOpportunity {
  id: string;
  kind: string;
  operation: string;
  shape?: string;
  sink: HighwayRouteStep;
  canonicalNode: HighwayRouteStep;
  routes: HighwayRoute[];
  duplicatedCallees?: HighwayRouteStep[];
  proposal?: HighwayProposal;
  contextPack: {
    proposedCanonicalNode: HighwayRouteStep;
    affectedRoutes: string[];
    nextSafeCommand: string;
  };
}

interface HighwaysPayload {
  totalRoutes: number;
  totalSinks: number;
  totalOpportunities: number;
  opportunities: HighwayOpportunity[];
  trace?: {
    id: string;
    found: boolean;
    opportunity?: HighwayOpportunity;
  };
  cache?: unknown;
  nextSteps?: unknown;
}

const created: string[] = [];

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textPayload(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new Error("MCP result did not include content");
  }
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    throw new Error("MCP result did not include text content");
  }
  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) {
    throw new Error("MCP text content was not a JSON object");
  }
  return parsed;
}

function isRouteStep(value: unknown): value is HighwayRouteStep {
  return isRecord(value) && typeof value.file === "string" && typeof value.symbol === "string";
}

function isHighwaysPayload(value: unknown): value is HighwaysPayload {
  if (!isRecord(value)) return false;
  if (typeof value.totalRoutes !== "number") return false;
  if (typeof value.totalSinks !== "number") return false;
  if (typeof value.totalOpportunities !== "number") return false;
  if (!Array.isArray(value.opportunities)) return false;
  return value.opportunities.every((item) => {
    if (!isRecord(item)) return false;
    if (typeof item.id !== "string" || typeof item.kind !== "string" || typeof item.operation !== "string") return false;
    if (!isRouteStep(item.sink) || !isRouteStep(item.canonicalNode)) return false;
    return Array.isArray(item.routes);
  });
}

function collectStream(stream: Stream | null): () => string {
  let output = "";
  stream?.on("data", (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  return () => output;
}

function parsePayload(stdout: string): HighwaysPayload {
  const parsed: unknown = JSON.parse(stdout);
  if (!isHighwaysPayload(parsed)) throw new Error("Expected highways JSON object");
  return parsed;
}

function comparable(payload: HighwaysPayload): Omit<HighwaysPayload, "cache" | "nextSteps"> {
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
    const code = err.code;
    const stdout = err.stdout;
    const stderr = err.stderr;
    return {
      status: typeof code === "number" ? code : 1,
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : "",
    };
  }
}

function makeHighwaysProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-highways-"));
  created.push(dir);

  const files: Record<string, string> = {
    "src/types.ts": "export interface UserDraft { email: string; name: string; }\nexport interface User { id: string; email: string; name: string; }\n",
    "src/normalize.ts": "import type { UserDraft } from './types.js';\nexport function normalizeUserDraft(draft: UserDraft): UserDraft { return { ...draft, email: draft.email.trim().toLowerCase() }; }\n",
    "src/validation.ts": "import type { UserDraft } from './types.js';\nexport function validateUserDraft(draft: UserDraft): UserDraft { if (!draft.email) throw new Error('email required'); return draft; }\n",
    "src/repository.ts": "import type { User, UserDraft } from './types.js';\nexport function insertUser(draft: UserDraft): User { return { id: 'u_1', email: draft.email, name: draft.name }; }\n",
    "src/service.ts": [
      "import type { User, UserDraft } from './types.js';",
      "import { normalizeUserDraft } from './normalize.js';",
      "import { validateUserDraft } from './validation.js';",
      "import { insertUser } from './repository.js';",
      "export function createUser(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "",
    ].join("\n"),
    "src/routes.ts": [
      "import type { User, UserDraft } from './types.js';",
      "import { normalizeUserDraft } from './normalize.js';",
      "import { validateUserDraft } from './validation.js';",
      "import { insertUser } from './repository.js';",
      "import { createUser } from './service.js';",
      "export function createUserFromRest(draft: UserDraft): User {",
      "  return createUser(draft);",
      "}",
      "export function createUserFromWebhook(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "export function createUserFromAdmin(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "",
    ].join("\n"),
  };

  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  return path.join(dir, "src");
}

function makeHighwaySynthesisProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-highways-synthesis-"));
  created.push(dir);

  const files: Record<string, string> = {
    "src/types.ts": "export interface UserDraft { email: string; name: string; }\nexport interface User { id: string; email: string; name: string; }\n",
    "src/normalize.ts": "import type { UserDraft } from './types.js';\nexport function normalizeUserDraft(draft: UserDraft): UserDraft { return { ...draft, email: draft.email.trim().toLowerCase() }; }\n",
    "src/validation.ts": "import type { UserDraft } from './types.js';\nexport function validateUserDraft(draft: UserDraft): UserDraft { if (!draft.email) throw new Error('email required'); return draft; }\n",
    "src/repository.ts": "import type { User, UserDraft } from './types.js';\nexport function insertUser(draft: UserDraft): User { return { id: 'u_1', email: draft.email, name: draft.name }; }\n",
    "src/rest.ts": [
      "import type { User, UserDraft } from './types.js';",
      "import { normalizeUserDraft } from './normalize.js';",
      "import { validateUserDraft } from './validation.js';",
      "import { insertUser } from './repository.js';",
      "export function createUserFromRest(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "",
    ].join("\n"),
    "src/webhook.ts": [
      "import type { User, UserDraft } from './types.js';",
      "import { normalizeUserDraft } from './normalize.js';",
      "import { validateUserDraft } from './validation.js';",
      "import { insertUser } from './repository.js';",
      "export function createUserFromWebhook(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "",
    ].join("\n"),
    "src/admin.ts": [
      "import type { User, UserDraft } from './types.js';",
      "import { normalizeUserDraft } from './normalize.js';",
      "import { validateUserDraft } from './validation.js';",
      "import { insertUser } from './repository.js';",
      "export function createUserFromAdmin(draft: UserDraft): User {",
      "  const normalized = normalizeUserDraft(draft);",
      "  const valid = validateUserDraft(normalized);",
      "  return insertUser(valid);",
      "}",
      "",
    ].join("\n"),
  };

  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  return path.join(dir, "src");
}

function findOpportunity(payload: HighwaysPayload, kind: string): HighwayOpportunity {
  const opportunity = payload.opportunities.find((item) =>
    item.kind === kind
    && item.sink.symbol === "insertUser"
    && item.canonicalNode.symbol === "createUser"
  );
  if (!opportunity) throw new Error(`Expected ${kind} opportunity for createUser -> insertUser`);
  return opportunity;
}

describe("CH-P2-01 highways reroute", () => {
  it("detects bypass and cowpath routes through CLI JSON, trace, and MCP parity", async () => {
    const src = makeHighwaysProject();

    const cliRun = await run(["highways", src, "--operation", "create", "--shape", "UserDraft", "--min-routes", "3", "--json", "--force"]);
    expect(cliRun.status).toBe(0);
    expect(cliRun.stderr).toContain("Parsed");
    const cliPayload = parsePayload(cliRun.stdout);

    expect(cliPayload.totalRoutes).toBeGreaterThanOrEqual(3);
    expect(cliPayload.totalSinks).toBeGreaterThanOrEqual(1);
    expect(cliPayload.totalOpportunities).toBeGreaterThanOrEqual(2);

    const bypass = findOpportunity(cliPayload, "bypass");
    expect(bypass.id).toMatch(/^hwy-bypass-[a-f0-9]{10}$/);
    expect(bypass.operation).toBe("create");
    expect(bypass.shape).toBe("UserDraft");
    expect(bypass.routes.map((route) => route.entryPoint.symbol).sort()).toEqual([
      "createUserFromAdmin",
      "createUserFromRest",
      "createUserFromWebhook",
    ]);
    expect(bypass.routes.filter((route) => !route.includesCanonical).map((route) => route.entryPoint.symbol).sort()).toEqual([
      "createUserFromAdmin",
      "createUserFromWebhook",
    ]);
    expect(bypass.contextPack.proposedCanonicalNode.symbol).toBe("createUser");
    expect(bypass.contextPack.affectedRoutes).toContain("createUserFromWebhook");
    expect(bypass.contextPack.nextSafeCommand).toContain("codebase-intelligence impact");

    const cowpath = findOpportunity(cliPayload, "cowpath");
    expect(cowpath.id).toMatch(/^hwy-cowpath-[a-f0-9]{10}$/);
    expect(cowpath.duplicatedCallees?.map((step) => step.symbol).sort()).toEqual([
      "insertUser",
      "normalizeUserDraft",
      "validateUserDraft",
    ]);

    const stableIdRun = await run(["highways", src, "--operation", "create", "--shape", "UserDraft", "--min-routes", "3", "--json", "--force"]);
    expect(stableIdRun.status).toBe(0);
    const stableIdPayload = parsePayload(stableIdRun.stdout);
    expect(stableIdPayload.opportunities.map((item) => item.id)).toEqual(cliPayload.opportunities.map((item) => item.id));

    const traceRun = await run(["highways", src, "--operation", "create", "--shape", "UserDraft", "--trace", bypass.id, "--json"]);
    expect(traceRun.status).toBe(0);
    const tracePayload = parsePayload(traceRun.stdout);
    expect(tracePayload.trace).toMatchObject({ id: bypass.id, found: true });
    expect(tracePayload.trace?.opportunity?.routes[0]?.steps.length).toBeGreaterThanOrEqual(2);

    const transport = new StdioClientTransport({
      command: "node",
      args: [cli, src, "--force"],
      cwd: repoRoot,
      stderr: "pipe",
    });
    const stderr = collectStream(transport.stderr);
    const client = new Client({ name: "highways-e2e", version: "0.1.0" });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "analyze_highways",
        arguments: { operation: "create", shape: "UserDraft", minRoutes: 3 },
      });
      const mcpPayloadRecord = textPayload(result);
      if (!isHighwaysPayload(mcpPayloadRecord)) throw new Error("Expected MCP highways payload");
      const mcpPayload = mcpPayloadRecord;
      expect(mcpPayload.nextSteps).toBeDefined();
      expect(comparable(mcpPayload)).toEqual(comparable(cliPayload));
    } finally {
      await client.close();
      await transport.close();
    }
    expect(stderr()).toContain("Parsed");
  }, 120_000);
});

describe("CH-P2-02 highway synthesis", () => {
  it("proposes a canonical highway when no shared node exists and traces the proposal", async () => {
    const src = makeHighwaySynthesisProject();

    const cliRun = await run(["highways", src, "--operation", "create", "--shape", "UserDraft", "--min-routes", "3", "--propose", "--json", "--force"]);
    expect(cliRun.status).toBe(0);
    const cliPayload = parsePayload(cliRun.stdout);
    const synthesis = cliPayload.opportunities.find((item) => item.kind === "synthesis" && item.sink.symbol === "insertUser");
    if (!synthesis?.proposal) throw new Error("Expected synthesis proposal for insertUser");

    expect(synthesis.id).toMatch(/^hwy-synthesis-[a-f0-9]{10}$/);
    expect(synthesis.canonicalNode).toMatchObject({
      file: "create-user-draft.highway.ts",
      symbol: "createUserDraft",
      proposed: true,
    });
    expect(synthesis.proposal).toMatchObject({
      name: "createUserDraft",
      file: "create-user-draft.highway.ts",
      signature: "createUserDraft(input: UserDraft): User",
      cycleSafety: {
        safe: true,
        checkedEdges: [
          "createUserFromAdmin -> createUserDraft",
          "createUserFromRest -> createUserDraft",
          "createUserFromWebhook -> createUserDraft",
          "createUserDraft -> insertUser",
        ],
      },
    });
    expect(synthesis.proposal.skeleton).toContain("export function createUserDraft(input: UserDraft): User");
    expect(synthesis.proposal.skeleton).toContain("return insertUser(valid);");
    expect(synthesis.proposal.reroutePlan).toEqual([
      {
        entryPoint: "createUserFromAdmin",
        replaceSteps: ["normalizeUserDraft", "validateUserDraft", "insertUser"],
        call: "createUserDraft",
      },
      {
        entryPoint: "createUserFromRest",
        replaceSteps: ["normalizeUserDraft", "validateUserDraft", "insertUser"],
        call: "createUserDraft",
      },
      {
        entryPoint: "createUserFromWebhook",
        replaceSteps: ["normalizeUserDraft", "validateUserDraft", "insertUser"],
        call: "createUserDraft",
      },
    ]);
    expect(synthesis.contextPack.nextSafeCommand).toContain("codebase-intelligence impact");
    expect(synthesis.contextPack.affectedRoutes).toEqual(["createUserFromAdmin", "createUserFromRest", "createUserFromWebhook"]);

    const traceRun = await run(["highways", src, "--operation", "create", "--shape", "UserDraft", "--min-routes", "3", "--propose", "--trace", synthesis.id, "--json"]);
    expect(traceRun.status).toBe(0);
    const tracePayload = parsePayload(traceRun.stdout);
    expect(tracePayload.trace).toMatchObject({ id: synthesis.id, found: true });
    expect(tracePayload.trace?.opportunity?.proposal?.name).toBe("createUserDraft");

    const transport = new StdioClientTransport({
      command: "node",
      args: [cli, src, "--force"],
      cwd: repoRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "highways-synthesis-e2e", version: "0.1.0" });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "analyze_highways",
        arguments: { operation: "create", shape: "UserDraft", minRoutes: 3, propose: true },
      });
      const mcpPayloadRecord = textPayload(result);
      if (!isHighwaysPayload(mcpPayloadRecord)) throw new Error("Expected MCP highways payload");
      expect(comparable(mcpPayloadRecord)).toEqual(comparable(cliPayload));
    } finally {
      await client.close();
      await transport.close();
    }
  }, 120_000);
});
