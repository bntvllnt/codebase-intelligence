import { execFile, execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { BoundariesResult } from "../src/types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

type BoundaryPayload = BoundariesResult & { cache?: unknown; nextSteps?: unknown };

beforeAll(() => {
  execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundaryPayload(value: unknown): value is BoundaryPayload {
  return isRecord(value)
    && (value.verdict === "pass" || value.verdict === "fail")
    && isRecord(value.summary)
    && Array.isArray(value.zones)
    && Array.isArray(value.rules)
    && Array.isArray(value.violations);
}

function parseBoundaryPayload(stdout: string): BoundaryPayload {
  const parsed: unknown = JSON.parse(stdout);
  if (!isBoundaryPayload(parsed)) throw new Error("Expected boundaries JSON object");
  return parsed;
}

function mcpPayload(result: unknown): BoundaryPayload {
  if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("MCP result did not include content");
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") throw new Error("MCP result did not include text content");
  return parseBoundaryPayload(first.text);
}

function withoutRuntimeFields(payload: BoundaryPayload): BoundariesResult {
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

function writeFile(root: string, relative: string, content: string): void {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(root: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function gitOutput(root: string, args: readonly string[], input?: string): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Boundary Test",
      GIT_AUTHOR_EMAIL: "32437578+bntvllnt@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Boundary Test",
      GIT_COMMITTER_EMAIL: "32437578+bntvllnt@users.noreply.github.com",
    },
  }).trim();
}

function currentHead(root: string): string | undefined {
  try {
    return gitOutput(root, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return undefined;
  }
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "."]);
  const tree = gitOutput(root, ["write-tree"]);
  const parent = currentHead(root);
  const args = ["-c", "commit.gpgsign=false", "commit-tree", tree];
  if (parent) args.push("-p", parent);
  const commit = gitOutput(root, args, `${message}\n`);
  git(root, ["update-ref", "HEAD", commit]);
}

function createBoundaryFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-boundaries-"));
  writeFile(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" } }, null, 2));
  writeFile(root, "codebase-intelligence.json", JSON.stringify({
    boundaries: {
      zones: [
        { name: "ui", patterns: ["ui/**"], autoDiscover: true },
        { name: "app", patterns: ["app/**"], autoDiscover: true },
        { name: "domain", patterns: ["domain/**"], autoDiscover: true },
        { name: "infra", patterns: ["infra/**"], autoDiscover: true },
        { name: "shared", patterns: ["shared/**"], autoDiscover: true },
      ],
      rules: [
        { from: "ui", allow: ["app", "domain"] },
        { from: "ui", forbid: ["infra"] },
        { from: "app", allow: ["domain"] },
        { from: "domain", forbid: ["infra"] },
      ],
    },
    rules: {
      "no-dead-exports": "off",
      "no-circular-deps": "off",
    },
  }, null, 2));
  writeFile(root, "src/infra/db.ts", "export function readDb(): string { return 'db'; }\n");
  writeFile(root, "src/domain/model.ts", "import { readDb } from '../infra/db';\nexport function makeModel(): string { return readDb(); }\n");
  writeFile(root, "src/app/service.ts", "import { makeModel } from '../domain/model';\nexport const service = makeModel();\n");
  writeFile(root, "src/ui/widget.ts", "import { readDb } from '../infra/db';\nexport const widget = readDb();\n");
  writeFile(root, "src/ui/barrel.ts", "export * from '../infra/db';\n");
  writeFile(root, "src/shared/tool.ts", "export const tool = 'tool';\n");
  writeFile(root, "src/ui/shared-leak.ts", "import { tool } from '../shared/tool';\nexport const leak = tool;\n");
  git(root, ["init"]);
  git(root, ["config", "user.email", "32437578+bntvllnt@users.noreply.github.com"]);
  git(root, ["config", "user.name", "Boundary Test"]);
  commitAll(root, "initial");
  return root;
}

describe("CH-P2-05 architecture boundary chain", () => {
  it("reports rule evidence, supports new-only gating, and matches real stdio MCP output", async () => {
    const root = createBoundaryFixture();
    try {
      const boundaryRun = await run(["boundaries", root, "--list", "--json", "--force"]);
      expect(boundaryRun.status).toBe(1);
      expect(boundaryRun.stderr).toContain("Parsed");
      const boundaryPayload = parseBoundaryPayload(boundaryRun.stdout);
      expect(boundaryPayload.verdict).toBe("fail");
      expect(boundaryPayload.summary.violations).toBe(4);
      expect(boundaryPayload.zones.find((zone) => zone.name === "ui")?.patterns).toContain("src/ui/**");
      expect(boundaryPayload.violations.map((violation) => violation.kind).sort()).toEqual([
        "disallowed-edge",
        "forbidden-edge",
        "forbidden-edge",
        "risky-re-export-chain",
      ]);
      expect(boundaryPayload.violations).toContainEqual(expect.objectContaining({
        source: "src/ui/shared-leak.ts",
        target: "src/shared/tool.ts",
        kind: "disallowed-edge",
      }));
      expect(boundaryPayload.violations).toContainEqual(expect.objectContaining({
        source: "src/ui/widget.ts",
        target: "src/infra/db.ts",
        kind: "forbidden-edge",
      }));
      expect(boundaryPayload.violations[0]?.evidence).toEqual(expect.arrayContaining([
        expect.stringContaining("edge="),
        expect.stringContaining("fromZone="),
        expect.stringContaining("toZone="),
      ]));
      expect(boundaryPayload.violations[0]?.actions.length).toBeGreaterThan(0);

      const textRun = await run(["boundaries", root, "--list"]);
      expect(textRun.status).toBe(1);
      expect(textRun.stdout).toContain("Boundaries: FAIL");
      expect(textRun.stdout).toContain("Zones");

      const preexistingGate = await run(["check", root, "--json", "--gate", "new-only", "--base", "HEAD", "--fail-on", "error"]);
      expect(preexistingGate.status).toBe(0);
      const preexistingPayload: unknown = JSON.parse(preexistingGate.stdout);
      if (!isRecord(preexistingPayload) || !isRecord(preexistingPayload.summary)) throw new Error("Expected check payload");
      expect(preexistingPayload.verdict).toBe("pass");
      expect(preexistingPayload.summary.error).toBe(0);

      const base = gitOutput(root, ["rev-parse", "--verify", "HEAD"]);
      writeFile(root, "src/app/new-service.ts", "import { readDb } from '../infra/db';\nexport const newer = readDb();\n");
      commitAll(root, "add new boundary violation");
      const newOnlyGate = await run(["check", root, "--json", "--gate", "new-only", "--base", base, "--fail-on", "error", "--force"]);
      expect(newOnlyGate.status).toBe(1);
      const newOnlyPayload: unknown = JSON.parse(newOnlyGate.stdout);
      if (!isRecord(newOnlyPayload) || !Array.isArray(newOnlyPayload.findings)) throw new Error("Expected check findings");
      expect(newOnlyPayload.verdict).toBe("fail");
      expect(newOnlyPayload.findings).toEqual([
        expect.objectContaining({
          ruleId: "no-boundary-violations",
          file: "src/app/new-service.ts",
          severity: "error",
          kind: "disallowed-edge",
        }),
      ]);

      const transport = new StdioClientTransport({
        command: "node",
        args: [cli, root, "--force"],
        cwd: repoRoot,
        stderr: "pipe",
      });
      const client = new Client({ name: "boundaries-e2e", version: "0.1.0" });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name: "check_boundaries", arguments: { list: true } });
        const mcp = mcpPayload(result);
        expect(withoutRuntimeFields(mcp)).toEqual(withoutRuntimeFields(parseBoundaryPayload((await run(["boundaries", root, "--list", "--json", "--force"])).stdout)));
        expect(mcp).toHaveProperty("nextSteps");
      } finally {
        await client.close();
        await transport.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("ships preset boundary rules without requiring config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-boundary-preset-"));
    try {
      writeFile(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" } }, null, 2));
      writeFile(root, "src/infra/db.ts", "export function readDb(): string { return 'db'; }\n");
      writeFile(root, "src/domain/model.ts", "import { readDb } from '../infra/db';\nexport const model = readDb();\n");
      const runResult = await run(["boundaries", root, "--preset", "hexagonal", "--json", "--force"]);
      expect(runResult.status).toBe(1);
      const payload = parseBoundaryPayload(runResult.stdout);
      expect(payload.preset).toBe("hexagonal");
      expect(payload.violations[0]).toMatchObject({
        source: "src/domain/model.ts",
        target: "src/infra/db.ts",
        fromZone: "domain",
        toZone: "infrastructure",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
