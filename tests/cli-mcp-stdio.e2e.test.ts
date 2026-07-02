import { execFileSync, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Stream } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getFixtureSrcPath } from "./helpers/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

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

function collectStream(stream: Stream | null): () => string {
  let output = "";
  stream?.on("data", (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  return () => output;
}

function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-mcp-stdio-"));
  fs.writeFileSync(path.join(dir, "index.ts"), "export const value = 1;\n", "utf-8");
  for (const args of [
    ["init"],
    ["config", "user.email", "t@example.com"],
    ["config", "user.name", "t"],
    ["add", "-A"],
    ["commit", "-m", "base", "--no-gpg-sign"],
  ]) {
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: dir,
      env: GIT_ENV,
      stdio: "ignore",
    });
  }
  return dir;
}

async function connectClient(args: string[]): Promise<{
  client: Client;
  transport: StdioClientTransport;
  stderr: () => string;
}> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [cli, ...args],
    cwd: repoRoot,
    stderr: "pipe",
  });
  const stderr = collectStream(transport.stderr);
  const client = new Client({ name: "stdio-e2e", version: "0.1.0" });
  await client.connect(transport);
  return { client, transport, stderr };
}

describe("CLI MCP stdio lifecycle (e2e)", () => {
  it("starts from the compiled CLI and serves tools over stdio", async () => {
    const { client, transport } = await connectClient([getFixtureSrcPath(), "--force"]);

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("codebase_overview");
      expect(names).toContain("find_opportunities");
      expect(names).toContain("check");

      const result = await client.callTool({ name: "codebase_overview", arguments: {} });
      const payload = textPayload(result);

      expect(payload).toHaveProperty("totalFiles");
      expect(payload).toHaveProperty("modules");
      expect(payload).toHaveProperty("nextSteps");
      expect(typeof payload.totalFiles).toBe("number");
    } finally {
      await client.close();
      await transport.close();
    }
  }, 120_000);

  it("CH-P1-02: reuses the shared graph-load cache path in stdio MCP mode", async () => {
    const repo = fixtureRepo();
    try {
      const first = await connectClient([repo, "--index", "--force"]);
      try {
        await first.client.listTools();
      } finally {
        await first.client.close();
        await first.transport.close();
      }
      expect(first.stderr()).toContain("Index saved");

      const second = await connectClient([repo, "--index"]);
      try {
        await second.client.listTools();
      } finally {
        await second.client.close();
        await second.transport.close();
      }
      expect(second.stderr()).toContain("Using cached index");
      expect(second.stderr()).not.toContain("Parsing");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  it("CH-P1-02: reports stdio graph-load parse failures without a fatal crash envelope", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-empty-mcp-"));
    try {
      const result = spawnSync("node", [cli, empty], {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Error: No TypeScript files found");
      expect(result.stderr).not.toContain("Fatal:");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
