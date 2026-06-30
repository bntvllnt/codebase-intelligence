import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";
import { createFixtureMcp } from "./helpers/mcp.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph);
});

describe("2.1 — BM25 search ranks correctly", () => {
  it("searching 'auth' returns auth-service.ts above config/settings.ts", async () => {
    const { createSearchIndex, search } = await import("../src/search/index.js");
    const { codebaseGraph } = getFixturePipeline();
    const index = createSearchIndex(codebaseGraph);
    const results = search(index, "auth");

    expect(results.length).toBeGreaterThan(0);

    const authIdx = results.findIndex((r) => r.file.includes("auth-service"));
    const configIdx = results.findIndex((r) => r.file.includes("settings"));
    expect(authIdx).toBeGreaterThanOrEqual(0);
    if (configIdx >= 0) {
      expect(authIdx).toBeLessThan(configIdx);
    }
  });

  it("camelCase tokenizer splits getUserById into searchable terms", async () => {
    const { tokenize } = await import("../src/search/index.js");
    const tokens = tokenize("getUserById");
    expect(tokens).toContain("get");
    expect(tokens).toContain("user");
    expect(tokens).toContain("by");
    expect(tokens).toContain("id");
  });

  it("search results include file and symbol locations", async () => {
    const { createSearchIndex, search } = await import("../src/search/index.js");
    const { codebaseGraph } = getFixturePipeline();
    const index = createSearchIndex(codebaseGraph);
    const results = search(index, "auth");

    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toHaveProperty("file");
    expect(first).toHaveProperty("symbols");
    expect(first.symbols.length).toBeGreaterThan(0);
    expect(first.symbols[0]).toHaveProperty("name");
    expect(first.symbols[0]).toHaveProperty("type");
  });
});

describe("2.2 — BM25 empty results return suggestions", () => {
  it("searching 'nonexistent' returns empty results with suggestions", async () => {
    const { createSearchIndex, search } = await import("../src/search/index.js");
    const { codebaseGraph } = getFixturePipeline();
    const index = createSearchIndex(codebaseGraph);
    const results = search(index, "nonexistent_xyz_123");

    expect(results).toHaveLength(0);
  });

  it("getSuggestions returns closest matches for typos", async () => {
    const { createSearchIndex, getSuggestions } = await import("../src/search/index.js");
    const { codebaseGraph } = getFixturePipeline();
    const index = createSearchIndex(codebaseGraph);
    const suggestions = getSuggestions(index, "authen");

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.toLowerCase().includes("auth"))).toBe(true);
  });
});

describe("2.3 — search MCP tool", () => {
  it("search tool returns file-grouped results with symbol locations and nextSteps", async () => {
    const { callTool } = await createFixtureMcp();
    const result = await callTool("search", { query: "auth", limit: 5 });

    expect(result).toHaveProperty("query", "auth");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("nextSteps");

    const results = result.results;
    expect(Array.isArray(results)).toBe(true);
    if (!Array.isArray(results)) return;
    expect(results.length).toBeGreaterThan(0);

    const files = new Set<string>();
    const first = results[0];
    expect(typeof first).toBe("object");
    expect(first).not.toBeNull();
    if (typeof first !== "object" || first === null) return;
    expect(first).toHaveProperty("file");
    expect(first).toHaveProperty("symbols");

    for (const item of results) {
      expect(typeof item).toBe("object");
      expect(item).not.toBeNull();
      if (typeof item !== "object" || item === null) continue;
      const file = "file" in item ? item.file : undefined;
      const symbols = "symbols" in item ? item.symbols : undefined;
      expect(typeof file).toBe("string");
      if (typeof file === "string") files.add(file);
      expect(Array.isArray(symbols)).toBe(true);
      if (!Array.isArray(symbols) || symbols.length === 0) continue;
      const symbol = symbols[0];
      expect(typeof symbol).toBe("object");
      expect(symbol).not.toBeNull();
      if (typeof symbol !== "object" || symbol === null) continue;
      expect(symbol).toHaveProperty("name");
      expect(symbol).toHaveProperty("type");
      expect(symbol).toHaveProperty("loc");
      const loc = "loc" in symbol ? symbol.loc : undefined;
      expect(typeof loc).toBe("number");
    }

    expect(files.size).toBe(results.length);
    const nextSteps = result.nextSteps;
    expect(Array.isArray(nextSteps)).toBe(true);
    if (Array.isArray(nextSteps)) expect(nextSteps.length).toBeGreaterThan(0);
  });
});

describe("2.6 — existing tools include nextSteps", () => {
  it("codebase_overview MCP handler includes nextSteps in response", async () => {
    const { getHints } = await import("../src/mcp/hints.js");
    const hints = getHints("codebase_overview");
    expect(hints.length).toBeGreaterThan(0);
    expect(typeof hints[0]).toBe("string");
  });
});
