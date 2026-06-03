import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFixturePipeline, getFixtureSrcPath } from "./helpers/pipeline.js";
import { registerTools } from "../src/mcp/index.js";
import { setGraph, setIndexedHead, setRoot } from "../src/server/graph-store.js";

// Real in-memory MCP server + client over the real fixture graph. No mocks.

let client: Client;

beforeAll(async () => {
  const pipeline = getFixturePipeline();
  setGraph(pipeline.codebaseGraph);
  setIndexedHead("abc123-test");
  setRoot(getFixtureSrcPath());

  const server = new McpServer({ name: "test", version: "0.1.0" });
  registerTools(server, pipeline.codebaseGraph);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);
});

async function callCheck(): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: "check", arguments: {} });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP check tool", () => {
  it("is registered and returns verdict + summary + findings", async () => {
    const r = await callCheck();
    expect(r).toHaveProperty("verdict");
    expect(["pass", "warn", "fail"]).toContain(r.verdict);
    expect(r).toHaveProperty("summary");
    expect(Array.isArray(r.findings)).toBe(true);
    const summary = r.summary as Record<string, number>;
    expect(summary).toHaveProperty("error");
    expect(summary).toHaveProperty("warn");
  });

  it("each finding carries a ruleId, file, and fingerprint", async () => {
    const r = await callCheck();
    const findings = r.findings as Array<Record<string, unknown>>;
    for (const f of findings) {
      expect(typeof f.ruleId).toBe("string");
      expect(typeof f.file).toBe("string");
      expect(typeof f.fingerprint).toBe("string");
    }
  });
});
