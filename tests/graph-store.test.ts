import { describe, it, expect, beforeEach } from "vitest";
import { setGraph, getGraph, setIndexedHead, getIndexedHead } from "../src/server/graph-store.js";
import { getFixturePipeline } from "./helpers/pipeline.js";

beforeEach(() => {
  globalThis.__codebaseGraph = undefined;
  globalThis.__indexedHeadHash = undefined;
});

describe("graph-store", () => {
  describe("setGraph / getGraph", () => {
    it("throws when graph not initialized", () => {
      expect(() => getGraph()).toThrow("Graph not initialized");
    });

    it("returns graph after setGraph", () => {
      const { codebaseGraph } = getFixturePipeline();
      setGraph(codebaseGraph);
      const result = getGraph();
      expect(result).toBe(codebaseGraph);
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe("setIndexedHead / getIndexedHead", () => {
    it("returns empty string when not set", () => {
      expect(getIndexedHead()).toBe("");
    });

    it("returns hash after setIndexedHead", () => {
      setIndexedHead("abc123");
      expect(getIndexedHead()).toBe("abc123");
    });

    it("overwrites previous value", () => {
      setIndexedHead("first");
      setIndexedHead("second");
      expect(getIndexedHead()).toBe("second");
    });
  });
});
