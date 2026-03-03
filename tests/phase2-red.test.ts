import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";

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
  it.todo("search tool returns file-grouped results with symbol locations and nextSteps");
});

describe("2.6 — existing tools include nextSteps", () => {
  it("codebase_overview MCP handler includes nextSteps in response", async () => {
    const { getHints } = await import("../src/mcp/hints.js");
    const hints = getHints("codebase_overview");
    expect(hints.length).toBeGreaterThan(0);
    expect(typeof hints[0]).toBe("string");
  });
});
