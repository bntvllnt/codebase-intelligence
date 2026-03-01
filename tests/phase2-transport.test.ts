import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";
import type { Server } from "node:http";

let httpServer: Server | undefined;
const TEST_PORT = 9876;

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
});

afterAll(async () => {
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve());
    });
  }
});

describe("2.4 — HTTP MCP transport", () => {
  it("HTTP transport serves MCP tools accessible via client", async () => {
    const { createHttpMcpServer } = await import("../src/mcp/transport.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { codebaseGraph } = getFixturePipeline();

    httpServer = await createHttpMcpServer(codebaseGraph, TEST_PORT);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );

    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("search");
    expect(toolNames).toContain("codebase_overview");
    expect(toolNames).toContain("symbol_context");

    await client.close();
  });
});
