import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import ts from "typescript";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseCodebase } from "../src/parser/index.js";
import { buildGraph } from "../src/graph/index.js";
import { analyzeGraph } from "../src/analyzer/index.js";
import { registerTools } from "../src/mcp/index.js";
import { setGraph, setIndexedHead } from "../src/server/graph-store.js";
import { impactAnalysis } from "../src/impact/index.js";
import { getFixturePipeline } from "./helpers/pipeline.js";
import type { CodebaseGraph } from "../src/types/index.js";

let client: Client;
let graph: CodebaseGraph;

beforeAll(async () => {
  const pipeline = getFixturePipeline();
  graph = pipeline.codebaseGraph;
  setGraph(graph);
  setIndexedHead("test-error-handling");

  const server = new McpServer({ name: "test-error-handling", version: "0.1.0" });
  registerTools(server, graph);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client-error", version: "0.1.0" });
  await client.connect(clientTransport);
});

describe("AC-1: impact_analysis returns isError for nonexistent symbol", () => {
  it("returns isError: true via MCP for nonexistent symbol", async () => {
    const result = await client.callTool({
      name: "impact_analysis",
      arguments: { symbol: "nonexistent_xyz_123" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Symbol not found");
  });

  it("returns notFound: true from impactAnalysis function directly", () => {
    const result = impactAnalysis(graph, "nonexistent_xyz_123");
    expect(result).toHaveProperty("notFound", true);
  });
});

describe("AC-2: impact_analysis returns valid result for symbol with zero callers", () => {
  it("returns levels and totalAffected without isError for valid symbol with no callers", async () => {
    const result = await client.callTool({
      name: "impact_analysis",
      arguments: { symbol: "UserService.getUserById" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("symbol");
    expect(parsed).toHaveProperty("levels");
    expect(parsed).toHaveProperty("totalAffected");
    expect(parsed).not.toHaveProperty("error");
  });
});

describe("AC-3: LOC with trailing newline matches wc -l", () => {
  it("reports LOC=3 for 3-line file with trailing newline", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/trailing-newline.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(3);
  });
});

describe("AC-4: LOC without trailing newline equals content lines", () => {
  it("reports LOC=3 for 3-line file without trailing newline", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/no-trailing-newline.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(3);
  });
});

describe("AC-5: empty file LOC equals 0", () => {
  it("reports LOC=0 for empty file (0 bytes)", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/empty.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(0);
  });
});

describe("AC-6: single-line file LOC equals 1", () => {
  it("reports LOC=1 for single-line file with trailing newline", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/single-line-newline.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(1);
  });

  it("reports LOC=1 for single-line file without trailing newline", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/single-line-no-newline.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(1);
  });
});

describe("AC-7: comments-only file LOC equals line count", () => {
  it("reports LOC=3 for 3-line comments-only file", () => {
    const fixturePath = path.resolve(__dirname, "loc-fixtures/comments-only.ts");
    const sourceFile = ts.createSourceFile(
      fixturePath,
      ts.sys.readFile(fixturePath) ?? "",
      ts.ScriptTarget.ES2022,
      true,
    );
    const end = sourceFile.getEnd();
    const loc = end === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(end - 1).line + 1;
    expect(loc).toBe(3);
  });
});

describe("AC-E1: consistent isError across entity-lookup tools", () => {
  it("file_context returns isError for nonexistent file", async () => {
    const result = await client.callTool({
      name: "file_context",
      arguments: { filePath: "nonexistent_file.ts" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("not found");
  });

  it("symbol_context returns isError for nonexistent symbol", async () => {
    const result = await client.callTool({
      name: "symbol_context",
      arguments: { name: "nonexistent_xyz_123" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Symbol not found");
  });

  it("impact_analysis returns isError for nonexistent symbol", async () => {
    const result = await client.callTool({
      name: "impact_analysis",
      arguments: { symbol: "nonexistent_xyz_123" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Symbol not found");
  });
});

describe("LOC via parseCodebase pipeline", () => {
  it("trailing newline file has correct LOC through full pipeline", () => {
    const locFixturePath = path.resolve(__dirname, "loc-fixtures");
    const parsed = parseCodebase(locFixturePath);
    const trailingNewline = parsed.find((f) => f.relativePath.includes("trailing-newline"));
    expect(trailingNewline).toBeDefined();
    expect(trailingNewline!.loc).toBe(3);
  });

  it("no-trailing-newline file has correct LOC through full pipeline", () => {
    const locFixturePath = path.resolve(__dirname, "loc-fixtures");
    const parsed = parseCodebase(locFixturePath);
    const noTrailingNewline = parsed.find((f) => f.relativePath.includes("no-trailing-newline"));
    expect(noTrailingNewline).toBeDefined();
    expect(noTrailingNewline!.loc).toBe(3);
  });

  it("empty file has LOC=0 through full pipeline", () => {
    const locFixturePath = path.resolve(__dirname, "loc-fixtures");
    const parsed = parseCodebase(locFixturePath);
    const empty = parsed.find((f) => f.relativePath.includes("empty"));
    expect(empty).toBeDefined();
    expect(empty!.loc).toBe(0);
  });

  it("single-line files have LOC=1 through full pipeline", () => {
    const locFixturePath = path.resolve(__dirname, "loc-fixtures");
    const parsed = parseCodebase(locFixturePath);
    const singleNewline = parsed.find((f) => f.relativePath.includes("single-line-newline"));
    const singleNoNewline = parsed.find((f) => f.relativePath.includes("single-line-no-newline"));
    expect(singleNewline).toBeDefined();
    expect(singleNewline!.loc).toBe(1);
    expect(singleNoNewline).toBeDefined();
    expect(singleNoNewline!.loc).toBe(1);
  });

  it("comments-only file has correct LOC through full pipeline", () => {
    const locFixturePath = path.resolve(__dirname, "loc-fixtures");
    const parsed = parseCodebase(locFixturePath);
    const commentsOnly = parsed.find((f) => f.relativePath.includes("comments-only"));
    expect(commentsOnly).toBeDefined();
    expect(commentsOnly!.loc).toBe(3);
  });
});
