import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/mcp/index.js";
import { setGraph, setIndexedHead, setRoot } from "../../src/server/graph-store.js";
import { getFixturePipeline, getFixtureSrcPath } from "./pipeline.js";

interface ToolPayload {
  payload: Record<string, unknown>;
  isError: boolean;
}

export interface FixtureMcp {
  listTools(): Promise<string[]>;
  listToolMetadata(): Promise<Array<{ name: string; inputSchema: unknown }>>;
  callTool(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  callToolWithMeta(name: string, args?: Record<string, unknown>): Promise<ToolPayload>;
}

function hasText(value: unknown): value is { text: string } {
  return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstTextContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content) || !hasText(result.content[0])) {
    throw new Error("MCP tool result did not include text content");
  }
  return result.content[0].text;
}

function parsePayload(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error("MCP tool result was not a JSON object");
  }
  return parsed;
}

export async function createFixtureMcp(rootDir = getFixtureSrcPath()): Promise<FixtureMcp> {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph);
  setRoot(rootDir);
  setIndexedHead("abc123-test");

  const server = new McpServer({ name: "test", version: "0.1.0" });
  registerTools(server, codebaseGraph);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);

  return {
    async listTools(): Promise<string[]> {
      const result = await client.listTools();
      return result.tools.map((tool) => tool.name);
    },
    async listToolMetadata(): Promise<Array<{ name: string; inputSchema: unknown }>> {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      const result = await client.callTool({ name, arguments: args });
      return parsePayload(firstTextContent(result));
    },
    async callToolWithMeta(name: string, args: Record<string, unknown> = {}): Promise<ToolPayload> {
      const result = await client.callTool({ name, arguments: args });
      return {
        payload: parsePayload(firstTextContent(result)),
        isError: result.isError === true,
      };
    },
  };
}
