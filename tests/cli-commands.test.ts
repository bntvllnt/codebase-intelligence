import { describe, it, expect } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import {
  computeOverview,
  computeFileContext,
  computeHotspots,
  computeSearch,
  computeChanges,
  computeDependents,
  computeModuleStructure,
  computeForces,
  computeDeadExports,
  computeGroups,
  computeSymbolContext,
  computeProcesses,
  computeClusters,
  impactAnalysis,
  renameSymbol,
} from "../src/core/index.js";

describe("CLI core commands (integration)", () => {
  describe("computeOverview", () => {
    it("returns file, function, and dependency counts", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeOverview(codebaseGraph);

      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.totalFunctions).toBeGreaterThanOrEqual(0);
      expect(result.totalDependencies).toBeGreaterThanOrEqual(0);
    });

    it("returns modules sorted by file count", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeOverview(codebaseGraph);

      expect(result.modules.length).toBeGreaterThan(0);
      for (const m of result.modules) {
        expect(m).toHaveProperty("path");
        expect(m).toHaveProperty("files");
        expect(m).toHaveProperty("loc");
        expect(m).toHaveProperty("avgCoupling");
        expect(m).toHaveProperty("cohesion");
      }

      for (let i = 1; i < result.modules.length; i++) {
        expect(result.modules[i - 1].files).toBeGreaterThanOrEqual(result.modules[i].files);
      }
    });

    it("returns top depended files", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeOverview(codebaseGraph);

      expect(result.topDependedFiles.length).toBeGreaterThan(0);
      expect(result.topDependedFiles.length).toBeLessThanOrEqual(5);
      for (const f of result.topDependedFiles) {
        expect(f).toContain("dependents");
      }
    });

    it("returns global metrics", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeOverview(codebaseGraph);

      expect(result.metrics.avgLOC).toBeGreaterThan(0);
      expect(result.metrics.maxDepth).toBeGreaterThan(0);
      expect(typeof result.metrics.circularDeps).toBe("number");
    });

    it("JSON output is valid and stable schema", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeOverview(codebaseGraph);
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed).toHaveProperty("totalFiles");
      expect(parsed).toHaveProperty("totalFunctions");
      expect(parsed).toHaveProperty("totalDependencies");
      expect(parsed).toHaveProperty("modules");
      expect(parsed).toHaveProperty("topDependedFiles");
      expect(parsed).toHaveProperty("metrics");
    });
  });

  describe("computeHotspots", () => {
    it("returns ranked files by coupling (default metric)", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeHotspots(codebaseGraph, "coupling", 5);

      expect(result.metric).toBe("coupling");
      expect(result.hotspots.length).toBeLessThanOrEqual(5);
      expect(result.hotspots.length).toBeGreaterThan(0);

      for (let i = 1; i < result.hotspots.length; i++) {
        expect(result.hotspots[i - 1].score).toBeGreaterThanOrEqual(result.hotspots[i].score);
      }
    });

    it("each hotspot has path, score, and reason", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeHotspots(codebaseGraph, "coupling");

      for (const h of result.hotspots) {
        expect(h).toHaveProperty("path");
        expect(h).toHaveProperty("score");
        expect(h).toHaveProperty("reason");
        expect(typeof h.path).toBe("string");
        expect(typeof h.score).toBe("number");
        expect(typeof h.reason).toBe("string");
      }
    });

    it("returns summary with top hotspot info", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeHotspots(codebaseGraph, "coupling");

      expect(result.summary).toContain("coupling");
    });

    it("supports all valid metrics", () => {
      const { codebaseGraph } = getFixturePipeline();
      const metrics = [
        "coupling",
        "pagerank",
        "fan_in",
        "fan_out",
        "betweenness",
        "tension",
        "churn",
        "complexity",
        "blast_radius",
        "coverage",
        "escape_velocity",
      ];

      for (const metric of metrics) {
        const result = computeHotspots(codebaseGraph, metric, 3);
        expect(result.metric).toBe(metric);
        expect(result.hotspots).toBeDefined();
      }
    });

    it("respects limit parameter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeHotspots(codebaseGraph, "coupling", 2);

      expect(result.hotspots.length).toBeLessThanOrEqual(2);
    });

    it("JSON output is valid", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeHotspots(codebaseGraph, "coupling");
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed).toHaveProperty("metric");
      expect(parsed).toHaveProperty("hotspots");
      expect(parsed).toHaveProperty("summary");
    });
  });

  describe("computeFileContext", () => {
    it("returns file context for a known file", () => {
      const { codebaseGraph } = getFixturePipeline();
      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const result = computeFileContext(codebaseGraph, knownFile);

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.path).toBe(knownFile);
        expect(typeof result.loc).toBe("number");
        expect(Array.isArray(result.exports)).toBe(true);
        expect(Array.isArray(result.imports)).toBe(true);
        expect(Array.isArray(result.dependents)).toBe(true);
        expect(result.metrics).toHaveProperty("pageRank");
        expect(result.metrics).toHaveProperty("betweenness");
        expect(result.metrics).toHaveProperty("fanIn");
        expect(result.metrics).toHaveProperty("fanOut");
        expect(result.metrics).toHaveProperty("coupling");
        expect(result.metrics).toHaveProperty("tension");
        expect(result.metrics).toHaveProperty("isBridge");
        expect(result.metrics).toHaveProperty("churn");
        expect(result.metrics).toHaveProperty("cyclomaticComplexity");
        expect(result.metrics).toHaveProperty("blastRadius");
        expect(result.metrics).toHaveProperty("deadExports");
        expect(result.metrics).toHaveProperty("hasTests");
        expect(result.metrics).toHaveProperty("testFile");
      }
    });

    it("returns error with suggestions for unknown file", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeFileContext(codebaseGraph, "nonexistent/file.ts");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("not found");
        expect(result.suggestions.length).toBeGreaterThan(0);
        expect(result.suggestions.length).toBeLessThanOrEqual(3);
      }
    });

    it("strips common prefixes from file path", () => {
      const { codebaseGraph } = getFixturePipeline();
      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const result = computeFileContext(codebaseGraph, `src/${knownFile}`);

      expect("error" in result).toBe(false);
    });

    it("JSON output is valid for success result", () => {
      const { codebaseGraph } = getFixturePipeline();
      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const result = computeFileContext(codebaseGraph, knownFile);

      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed).toHaveProperty("path");
      expect(parsed).toHaveProperty("metrics");
    });

    it("JSON output is valid for error result", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeFileContext(codebaseGraph, "nonexistent.ts");

      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed).toHaveProperty("error");
      expect(parsed).toHaveProperty("suggestions");
    });
  });

  describe("computeSearch", () => {
    it("returns results for a term that exists in the fixture", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSearch(codebaseGraph, "logger");

      expect(result.query).toBe("logger");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("each result has file, score, and symbols", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSearch(codebaseGraph, "logger");

      for (const r of result.results) {
        expect(r).toHaveProperty("file");
        expect(r).toHaveProperty("score");
        expect(r).toHaveProperty("symbols");
        expect(typeof r.file).toBe("string");
        expect(typeof r.score).toBe("number");
        expect(Array.isArray(r.symbols)).toBe(true);
      }
    });

    it("returns suggestions for no-match query", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSearch(codebaseGraph, "xyznonexistentterm");

      expect(result.results.length).toBe(0);
    });

    it("respects limit parameter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSearch(codebaseGraph, "auth", 2);

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it("JSON output is valid", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSearch(codebaseGraph, "logger");
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed).toHaveProperty("query");
      expect(parsed).toHaveProperty("results");
    });
  });

  describe("computeChanges", () => {
    it("returns changes result with scope", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeChanges(codebaseGraph);

      if ("error" in result) {
        expect(result.error).toContain("Git");
      } else {
        expect(result.scope).toBe("all");
        expect(Array.isArray(result.changedFiles)).toBe(true);
        expect(Array.isArray(result.changedSymbols)).toBe(true);
        expect(Array.isArray(result.affectedFiles)).toBe(true);
        expect(Array.isArray(result.fileRiskMetrics)).toBe(true);
      }
    });

    it("supports staged scope", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeChanges(codebaseGraph, "staged");

      if (!("error" in result)) {
        expect(result.scope).toBe("staged");
      }
    });

    it("JSON output is valid", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeChanges(codebaseGraph);
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed).toHaveProperty("scope");
    });
  });

  describe("computeDependents", () => {
    it("returns direct dependents for a known file", () => {
      const { codebaseGraph } = getFixturePipeline();
      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const result = computeDependents(codebaseGraph, knownFile);

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.file).toBe(knownFile);
        expect(Array.isArray(result.directDependents)).toBe(true);
        expect(Array.isArray(result.transitiveDependents)).toBe(true);
        expect(typeof result.totalAffected).toBe("number");
        expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.riskLevel);
      }
    });

    it("returns error for unknown file", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeDependents(codebaseGraph, "nonexistent.ts");

      expect("error" in result).toBe(true);
    });

    it("respects depth parameter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const shallow = computeDependents(codebaseGraph, knownFile, 1);
      const deep = computeDependents(codebaseGraph, knownFile, 5);

      if (!("error" in shallow) && !("error" in deep)) {
        expect(deep.totalAffected).toBeGreaterThanOrEqual(shallow.totalAffected);
      }
    });
  });

  describe("computeModuleStructure", () => {
    it("returns modules with metrics", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeModuleStructure(codebaseGraph);

      expect(result.modules.length).toBeGreaterThan(0);
      for (const m of result.modules) {
        expect(m).toHaveProperty("path");
        expect(m).toHaveProperty("files");
        expect(m).toHaveProperty("cohesion");
        expect(m).toHaveProperty("escapeVelocity");
      }
    });

    it("includes cross-module dependencies", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeModuleStructure(codebaseGraph);

      expect(Array.isArray(result.crossModuleDeps)).toBe(true);
      expect(Array.isArray(result.circularDeps)).toBe(true);
    });

    it("JSON output is stable", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeModuleStructure(codebaseGraph);
      const parsed = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;

      expect(parsed).toHaveProperty("modules");
      expect(parsed).toHaveProperty("crossModuleDeps");
      expect(parsed).toHaveProperty("circularDeps");
    });
  });

  describe("computeForces", () => {
    it("returns force analysis with all sections", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeForces(codebaseGraph);

      expect(Array.isArray(result.moduleCohesion)).toBe(true);
      expect(Array.isArray(result.tensionFiles)).toBe(true);
      expect(Array.isArray(result.bridgeFiles)).toBe(true);
      expect(Array.isArray(result.extractionCandidates)).toBe(true);
      expect(typeof result.summary).toBe("string");
    });

    it("module cohesion includes verdicts", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeForces(codebaseGraph);

      for (const m of result.moduleCohesion) {
        expect(["COHESIVE", "MODERATE", "JUNK_DRAWER", "LEAF"]).toContain(m.verdict);
      }
    });

    it("respects custom thresholds", () => {
      const { codebaseGraph } = getFixturePipeline();
      const strict = computeForces(codebaseGraph, 0.9, 0.1, 0.1);
      const lenient = computeForces(codebaseGraph, 0.1, 0.9, 0.9);

      expect(strict.tensionFiles.length).toBeGreaterThanOrEqual(lenient.tensionFiles.length);
    });
  });

  describe("computeDeadExports", () => {
    it("returns dead exports result", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeDeadExports(codebaseGraph);

      expect(typeof result.totalDeadExports).toBe("number");
      expect(Array.isArray(result.files)).toBe(true);
      expect(typeof result.summary).toBe("string");
    });

    it("each dead export file has correct structure", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeDeadExports(codebaseGraph);

      for (const f of result.files) {
        expect(f).toHaveProperty("path");
        expect(f).toHaveProperty("module");
        expect(f).toHaveProperty("deadExports");
        expect(f).toHaveProperty("totalExports");
        expect(f.deadExports.length).toBeGreaterThan(0);
      }
    });

    it("respects limit parameter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeDeadExports(codebaseGraph, undefined, 2);

      expect(result.files.length).toBeLessThanOrEqual(2);
    });
  });

  describe("computeGroups", () => {
    it("returns ranked groups", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeGroups(codebaseGraph);

      expect(Array.isArray(result.groups)).toBe(true);
      for (const g of result.groups) {
        expect(g).toHaveProperty("rank");
        expect(g).toHaveProperty("name");
        expect(g).toHaveProperty("files");
        expect(g).toHaveProperty("loc");
        expect(g).toHaveProperty("importance");
        expect(g).toHaveProperty("coupling");
      }
    });
  });

  describe("computeSymbolContext", () => {
    it("returns context for a known symbol", () => {
      const { codebaseGraph } = getFixturePipeline();
      const firstSymbol = [...codebaseGraph.symbolMetrics.values()][0];
      if (!firstSymbol) return;

      const result = computeSymbolContext(codebaseGraph, firstSymbol.name);

      if (!("error" in result)) {
        expect(result.name).toBe(firstSymbol.name);
        expect(typeof result.file).toBe("string");
        expect(Array.isArray(result.callers)).toBe(true);
        expect(Array.isArray(result.callees)).toBe(true);
      }
    });

    it("returns error for unknown symbol", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeSymbolContext(codebaseGraph, "xyzNonexistentSymbol");

      expect("error" in result).toBe(true);
    });
  });

  describe("computeProcesses", () => {
    it("returns processes list", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeProcesses(codebaseGraph);

      expect(typeof result.totalProcesses).toBe("number");
      expect(Array.isArray(result.processes)).toBe(true);

      for (const p of result.processes) {
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("entryPoint");
        expect(p).toHaveProperty("steps");
        expect(p).toHaveProperty("depth");
        expect(p).toHaveProperty("modulesTouched");
      }
    });

    it("respects limit parameter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeProcesses(codebaseGraph, undefined, 1);

      expect(result.processes.length).toBeLessThanOrEqual(1);
    });
  });

  describe("computeClusters", () => {
    it("returns clusters list", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = computeClusters(codebaseGraph);

      expect(typeof result.totalClusters).toBe("number");
      expect(Array.isArray(result.clusters)).toBe(true);

      for (const c of result.clusters) {
        expect(c).toHaveProperty("id");
        expect(c).toHaveProperty("name");
        expect(c).toHaveProperty("files");
        expect(c).toHaveProperty("fileCount");
        expect(c).toHaveProperty("cohesion");
      }
    });

    it("respects minFiles filter", () => {
      const { codebaseGraph } = getFixturePipeline();
      const all = computeClusters(codebaseGraph);
      const filtered = computeClusters(codebaseGraph, 100);

      expect(filtered.clusters.length).toBeLessThanOrEqual(all.clusters.length);
    });
  });

  describe("impactAnalysis (re-exported from core)", () => {
    it("returns impact levels for a known symbol", () => {
      const { codebaseGraph } = getFixturePipeline();
      const firstSymbol = [...codebaseGraph.symbolMetrics.values()][0];
      if (!firstSymbol) return;

      const result = impactAnalysis(codebaseGraph, firstSymbol.name);

      expect(result.symbol).toBe(firstSymbol.name);
      expect(typeof result.totalAffected).toBe("number");
      expect(Array.isArray(result.levels)).toBe(true);
    });

    it("returns notFound for unknown symbol", () => {
      const { codebaseGraph } = getFixturePipeline();
      const result = impactAnalysis(codebaseGraph, "xyzNonexistent");

      expect(result.notFound).toBe(true);
    });
  });

  describe("renameSymbol (re-exported from core)", () => {
    it("finds references for a known symbol", () => {
      const { codebaseGraph } = getFixturePipeline();
      const firstSymbol = [...codebaseGraph.symbolMetrics.values()][0];
      if (!firstSymbol) return;

      const result = renameSymbol(codebaseGraph, firstSymbol.name, "newName", true);

      expect(result.dryRun).toBe(true);
      expect(result.oldName).toBe(firstSymbol.name);
      expect(result.newName).toBe("newName");
      expect(typeof result.totalReferences).toBe("number");
      expect(Array.isArray(result.references)).toBe(true);
    });
  });

  describe("MCP backward compatibility (core extraction)", () => {
    it("all compute functions return consistent types", () => {
      const { codebaseGraph } = getFixturePipeline();

      const overview = computeOverview(codebaseGraph);
      expect(typeof overview.totalFiles).toBe("number");

      const hotspots = computeHotspots(codebaseGraph, "coupling");
      expect(typeof hotspots.metric).toBe("string");

      const knownFile = [...codebaseGraph.fileMetrics.keys()][0];
      const fileCtx = computeFileContext(codebaseGraph, knownFile);
      expect("path" in fileCtx || "error" in fileCtx).toBe(true);

      const search = computeSearch(codebaseGraph, "test");
      expect(typeof search.query).toBe("string");

      const changes = computeChanges(codebaseGraph);
      expect("scope" in changes || "error" in changes).toBe(true);
    });
  });
});
