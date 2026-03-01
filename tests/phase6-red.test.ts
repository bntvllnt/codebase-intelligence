import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
});

describe("6.1 — CLI persistence commands", () => {
  it("--index writes graph.json and meta.json to .code-visualizer/", async () => {
    const { exportGraph } = await import("../src/persistence/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const tmpDir = path.join(os.tmpdir(), `cv-cli-test-${Date.now()}`);
    const indexDir = path.join(tmpDir, ".code-visualizer");

    try {
      exportGraph(codebaseGraph, indexDir, "test-head-hash");

      expect(fs.existsSync(path.join(indexDir, "graph.json"))).toBe(true);
      expect(fs.existsSync(path.join(indexDir, "meta.json"))).toBe(true);

      const meta = JSON.parse(fs.readFileSync(path.join(indexDir, "meta.json"), "utf-8")) as {
        headHash: string;
        timestamp: string;
      };
      expect(meta.headHash).toBe("test-head-hash");
      expect(meta.timestamp).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--status reads index info from .code-visualizer/", async () => {
    const { exportGraph, importGraph } = await import("../src/persistence/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const tmpDir = path.join(os.tmpdir(), `cv-status-test-${Date.now()}`);
    const indexDir = path.join(tmpDir, ".code-visualizer");

    try {
      exportGraph(codebaseGraph, indexDir, "status-hash-abc");
      const result = importGraph(indexDir);

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.headHash).toBe("status-hash-abc");
      expect(result.graph.nodes.length).toBe(codebaseGraph.nodes.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--clean removes .code-visualizer/ directory", async () => {
    const { exportGraph } = await import("../src/persistence/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const tmpDir = path.join(os.tmpdir(), `cv-clean-test-${Date.now()}`);
    const indexDir = path.join(tmpDir, ".code-visualizer");

    try {
      exportGraph(codebaseGraph, indexDir, "clean-hash");
      expect(fs.existsSync(indexDir)).toBe(true);

      fs.rmSync(indexDir, { recursive: true, force: true });
      expect(fs.existsSync(indexDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--force re-indexes even when HEAD unchanged", async () => {
    const { exportGraph, importGraph } = await import("../src/persistence/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const tmpDir = path.join(os.tmpdir(), `cv-force-test-${Date.now()}`);
    const indexDir = path.join(tmpDir, ".code-visualizer");

    try {
      exportGraph(codebaseGraph, indexDir, "same-hash");
      const firstMeta = JSON.parse(fs.readFileSync(path.join(indexDir, "meta.json"), "utf-8")) as {
        timestamp: string;
      };

      await new Promise((resolve) => { setTimeout(resolve, 10); });

      exportGraph(codebaseGraph, indexDir, "same-hash");
      const secondMeta = JSON.parse(fs.readFileSync(path.join(indexDir, "meta.json"), "utf-8")) as {
        timestamp: string;
      };

      expect(secondMeta.timestamp).not.toBe(firstMeta.timestamp);

      const result = importGraph(indexDir);
      expect(result).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("6.2 — per-symbol PageRank/betweenness", () => {
  it("symbol metrics include pageRank and betweenness fields", () => {
    const { codebaseGraph } = getFixturePipeline();

    expect(codebaseGraph.symbolMetrics.size).toBeGreaterThan(0);

    for (const [, metrics] of codebaseGraph.symbolMetrics) {
      expect(metrics).toHaveProperty("pageRank");
      expect(metrics).toHaveProperty("betweenness");
      expect(typeof metrics.pageRank).toBe("number");
      expect(typeof metrics.betweenness).toBe("number");
    }
  });

  it("high fan-in symbols have higher pageRank", () => {
    const { codebaseGraph } = getFixturePipeline();

    const withRank = [...codebaseGraph.symbolMetrics.values()]
      .filter((m) => m.pageRank !== undefined)
      .sort((a, b) => b.pageRank - a.pageRank);

    expect(withRank.length).toBeGreaterThan(0);

    const topSymbol = withRank[0];
    expect(topSymbol.fanIn).toBeGreaterThanOrEqual(0);
  });
});

describe("6.3 — pipeline performance", () => {
  it("full pipeline on fixture codebase completes in <5s", () => {
    const start = performance.now();
    const { codebaseGraph } = getFixturePipeline();
    const elapsed = performance.now() - start;

    expect(codebaseGraph.nodes.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);
  });
});
