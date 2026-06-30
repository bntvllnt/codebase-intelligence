import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getFixtureSrcPath } from "./helpers/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");

beforeAll(() => {
  execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
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

describe("CLI MCP stdio lifecycle (e2e)", () => {
  it("starts from the compiled CLI and serves tools over stdio", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: [cli, getFixtureSrcPath(), "--force"],
      cwd: repoRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-e2e", version: "0.1.0" });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("codebase_overview");
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
});
