import { describe, it, expect } from "vitest";
import { getFixturePipeline, getFixtureSrcPath } from "./helpers/pipeline.js";
import fs from "fs";
import path from "path";

interface ExpectedSymbol {
  name: string;
  type: string;
  file: string;
}

interface ExpectedSymbolsFile {
  symbols: ExpectedSymbol[];
}

interface ExpectedFileGraph {
  stats: {
    totalEdges: number;
    totalFiles: number;
  };
}

describe("fixture-codebase smoke test", () => {
  it("fixture source directory exists", () => {
    expect(fs.existsSync(getFixtureSrcPath())).toBe(true);
  });

  it("pipeline parses fixture without errors", () => {
    const { parsedFiles } = getFixturePipeline();
    expect(parsedFiles.length).toBeGreaterThan(0);
  });

  it("parses expected number of files", () => {
    const { parsedFiles } = getFixturePipeline();
    expect(parsedFiles.length).toBeGreaterThanOrEqual(14);
  });

  it("builds graph with nodes and edges", () => {
    const { builtGraph } = getFixturePipeline();
    expect(builtGraph.nodes.length).toBeGreaterThan(0);
    expect(builtGraph.edges.length).toBeGreaterThan(0);
  });

  it("analyzes graph with metrics", () => {
    const { codebaseGraph } = getFixturePipeline();
    expect(codebaseGraph.fileMetrics.size).toBeGreaterThan(0);
    expect(codebaseGraph.stats.totalFiles).toBeGreaterThan(0);
  });

  it("logger.ts has high fan-in (imported by many files)", () => {
    const { codebaseGraph } = getFixturePipeline();
    const loggerKey = Array.from(codebaseGraph.fileMetrics.keys()).find((k) =>
      k.endsWith("logger.ts")
    );
    expect(loggerKey).toBeDefined();
    if (!loggerKey) return;
    const metrics = codebaseGraph.fileMetrics.get(loggerKey);
    expect(metrics).toBeDefined();
    if (!metrics) return;
    expect(metrics.fanIn).toBeGreaterThanOrEqual(5);
  });

  it("settings.ts has dead exports", () => {
    const { codebaseGraph } = getFixturePipeline();
    const settingsKey = Array.from(codebaseGraph.fileMetrics.keys()).find((k) =>
      k.endsWith("settings.ts")
    );
    expect(settingsKey).toBeDefined();
    if (!settingsKey) return;
    const metrics = codebaseGraph.fileMetrics.get(settingsKey);
    expect(metrics).toBeDefined();
    if (!metrics) return;
    expect(metrics.deadExports.length).toBeGreaterThan(0);
  });

  it("detects modules correctly", () => {
    const { codebaseGraph } = getFixturePipeline();
    const moduleNames = Array.from(codebaseGraph.moduleMetrics.keys());
    expect(moduleNames.some((m) => m.includes("auth"))).toBe(true);
    expect(moduleNames.some((m) => m.includes("users"))).toBe(true);
    expect(moduleNames.some((m) => m.includes("utils"))).toBe(true);
  });

  it("caches pipeline results across calls", () => {
    const result1 = getFixturePipeline();
    const result2 = getFixturePipeline();
    expect(result1).toBe(result2);
  });
});

describe("ground truth validation", () => {
  it("expected/ JSON files exist and parse", () => {
    const expectedDir = path.resolve(getFixtureSrcPath(), "../expected");
    const files = ["file-graph.json", "symbols.json", "call-graph.json", "processes.json"];

    for (const file of files) {
      const filePath = path.join(expectedDir, file);
      expect(fs.existsSync(filePath), `${file} should exist`).toBe(true);
      const content: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content).toBeDefined();
    }
  });

  it("parsed file count matches expected symbols file count", () => {
    const { parsedFiles } = getFixturePipeline();
    const expectedDir = path.resolve(getFixtureSrcPath(), "../expected");
    const symbols = JSON.parse(
      fs.readFileSync(path.join(expectedDir, "symbols.json"), "utf-8")
    ) as ExpectedSymbolsFile;

    const symbolFiles = new Set(symbols.symbols.map((s) => s.file));
    const parsedWithExports = parsedFiles.filter((f) => f.exports.length > 0);
    expect(parsedWithExports.length).toBeGreaterThanOrEqual(symbolFiles.size - 2);
  });

  it("graph edges count is reasonable vs expected file-graph", () => {
    const { builtGraph } = getFixturePipeline();
    const expectedDir = path.resolve(getFixtureSrcPath(), "../expected");
    const fileGraph = JSON.parse(
      fs.readFileSync(path.join(expectedDir, "file-graph.json"), "utf-8")
    ) as ExpectedFileGraph;

    const expectedEdgeCount = fileGraph.stats.totalEdges;
    expect(builtGraph.edges.length).toBeGreaterThanOrEqual(expectedEdgeCount * 0.5);
    expect(builtGraph.edges.length).toBeLessThanOrEqual(expectedEdgeCount * 2);
  });
});
