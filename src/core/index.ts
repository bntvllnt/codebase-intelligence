import { execSync } from "node:child_process";
import path from "node:path";
import type { AnalysisMode, CallGraphPrecision, CodebaseGraph, SymbolTypeFacts } from "../types/index.js";
import { createSearchIndex, search, getSuggestions } from "../search/index.js";
import type { SearchIndex } from "../search/index.js";
import { impactAnalysis, renameSymbol } from "../impact/index.js";
export { computeDuplication } from "../duplication/index.js";
export type { DuplicationOptions, DuplicationResult } from "../duplication/index.js";

// ── Path helpers ────────────────────────────────────────────

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function stripCommonFilePrefix(normalizedPath: string): string {
  return normalizedPath.replace(/^(src|lib|app)\//, "");
}

export function resolveFilePath(normalizedPath: string, graph: CodebaseGraph): string | undefined {
  if (graph.fileMetrics.has(normalizedPath)) return normalizedPath;
  const stripped = stripCommonFilePrefix(normalizedPath);
  if (stripped !== normalizedPath && graph.fileMetrics.has(stripped)) return stripped;
  return undefined;
}

export function suggestSimilarPaths(queryPath: string, graph: CodebaseGraph): string[] {
  const allPaths = [...graph.fileMetrics.keys()];
  const queryLower = queryPath.toLowerCase();
  const queryBasename = queryPath.split("/").pop() ?? queryPath;
  const queryBasenameLower = queryBasename.toLowerCase();

  const scored = allPaths.map((p) => {
    const pLower = p.toLowerCase();
    const pBasename = (p.split("/").pop() ?? p).toLowerCase();
    let score = 0;
    if (pLower.includes(queryLower)) score += 10;
    if (pBasename === queryBasenameLower) score += 5;
    if (pLower.includes(queryBasenameLower)) score += 3;

    const shorter = queryLower.length < pLower.length ? queryLower : pLower;
    const longer = queryLower.length < pLower.length ? pLower : queryLower;
    let commonPrefix = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] === longer[i]) commonPrefix++;
      else break;
    }
    score += commonPrefix * 0.1;

    return { path: p, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.path);

  if (matches.length > 0) return matches;
  return allPaths.slice(0, 3);
}

// ── Search index cache ──────────────────────────────────────

const searchIndexCache = new WeakMap<CodebaseGraph, SearchIndex>();

export function getSearchIndex(graph: CodebaseGraph): SearchIndex {
  let idx = searchIndexCache.get(graph);
  if (!idx) {
    idx = createSearchIndex(graph);
    searchIndexCache.set(graph, idx);
  }
  return idx;
}

// ── Shared lookup helpers ───────────────────────────────────

function buildNodeById(graph: CodebaseGraph): Map<string, CodebaseGraph["nodes"][number]> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function buildReverseAdjacency(graph: CodebaseGraph): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const e of graph.edges) {
    const existing = rev.get(e.target);
    if (existing) existing.push(e.source);
    else rev.set(e.target, [e.source]);
  }
  return rev;
}

// ── Result computation functions ────────────────────────────
// Each returns a plain object. MCP wraps in protocol, CLI formats for terminal.

export interface OverviewResult {
  totalFiles: number;
  totalFunctions: number;
  totalDependencies: number;
  modules: Array<{ path: string; files: number; loc: number; avgCoupling: string; cohesion: number }>;
  topDependedFiles: string[];
  metrics: { avgLOC: number; maxDepth: number; circularDeps: number };
  analysis: {
    mode: AnalysisMode;
    callGraphPrecision: CallGraphPrecision;
    fullProgramFileLimit: number;
  };
}

export function computeOverview(graph: CodebaseGraph): OverviewResult {
  const modules = [...graph.moduleMetrics.values()].map((m) => ({
    path: m.path,
    files: m.files,
    loc: m.loc,
    avgCoupling: m.cohesion < 0.4 ? "HIGH" : m.cohesion < 0.7 ? "MEDIUM" : "LOW",
    cohesion: m.cohesion,
  }));

  const topDepended = [...graph.fileMetrics.entries()]
    .sort(([, a], [, b]) => b.fanIn - a.fanIn)
    .slice(0, 5)
    .map(([path, m]) => `${path} (${m.fanIn} dependents)`);

  const maxDepth = graph.nodes
    .filter((n) => n.type === "file")
    .reduce((max, n) => Math.max(max, n.path.split("/").length), 0);

  return {
    totalFiles: graph.stats.totalFiles,
    totalFunctions: graph.stats.totalFunctions,
    totalDependencies: graph.stats.totalDependencies,
    modules: modules.sort((a, b) => b.files - a.files),
    topDependedFiles: topDepended,
    metrics: {
      avgLOC: Math.round(
        graph.nodes.filter((n) => n.type === "file").reduce((sum, n) => sum + n.loc, 0) /
          graph.stats.totalFiles
      ),
      maxDepth,
      circularDeps: graph.stats.circularDeps.length,
    },
    analysis: {
      mode: graph.stats.analysisMode,
      callGraphPrecision: graph.stats.callGraphPrecision,
      fullProgramFileLimit: graph.stats.fullProgramFileLimit,
    },
  };
}

export interface FileContextResult {
  path: string;
  loc: number;
  exports: Array<{ name: string; type: string; loc: number; typeFacts?: SymbolTypeFacts }>;
  imports: Array<{ from: string; symbols: string[]; isTypeOnly: boolean; weight: number }>;
  dependents: Array<{ path: string; symbols: string[]; isTypeOnly: boolean; weight: number }>;
  metrics: {
    pageRank: number;
    betweenness: number;
    fanIn: number;
    fanOut: number;
    coupling: number;
    tension: number;
    isBridge: boolean;
    churn: number;
    cyclomaticComplexity: number;
    blastRadius: number;
    deadExports: string[];
    totalExports: number;
    isPackageEntrypoint: boolean;
    packageEntrypointReason: string;
    hasTests: boolean;
    testFile: string;
    isTestFile: boolean;
  };
}

export type FileContextError = { error: string; suggestions: string[] };

export function computeFileContext(
  graph: CodebaseGraph,
  rawFilePath: string,
): FileContextResult | FileContextError {
  const normalizedPath = normalizeFilePath(rawFilePath);
  const filePath = resolveFilePath(normalizedPath, graph);
  if (!filePath) {
    const lookupPath = stripCommonFilePrefix(normalizedPath);
    return { error: `File not found in graph: ${lookupPath}`, suggestions: suggestSimilarPaths(lookupPath, graph) };
  }

  const metrics = graph.fileMetrics.get(filePath);
  if (!metrics) {
    return { error: `File not found in graph: ${filePath}`, suggestions: suggestSimilarPaths(filePath, graph) };
  }

  const nodeById = buildNodeById(graph);
  const node = nodeById.get(filePath);
  const fileExports = graph.symbolNodes
    .filter((symbol) => symbol.file === filePath && symbol.isExported !== false)
    .map((symbol) => ({ name: symbol.name, type: symbol.type, loc: symbol.loc, typeFacts: symbol.typeFacts }));

  const imports = graph.edges
    .filter((e) => e.source === filePath)
    .map((e) => ({ from: e.target, symbols: e.symbols, isTypeOnly: e.isTypeOnly, weight: e.weight }));

  const dependents = graph.edges
    .filter((e) => e.target === filePath)
    .map((e) => ({ path: e.source, symbols: e.symbols, isTypeOnly: e.isTypeOnly, weight: e.weight }));

  return {
    path: filePath,
    loc: node?.loc ?? 0,
    exports: fileExports,
    imports,
    dependents,
    metrics: {
      pageRank: Math.round(metrics.pageRank * 1000) / 1000,
      betweenness: Math.round(metrics.betweenness * 100) / 100,
      fanIn: metrics.fanIn,
      fanOut: metrics.fanOut,
      coupling: Math.round(metrics.coupling * 100) / 100,
      tension: metrics.tension,
      isBridge: metrics.isBridge,
      churn: metrics.churn,
      cyclomaticComplexity: metrics.cyclomaticComplexity,
      blastRadius: metrics.blastRadius,
      deadExports: metrics.deadExports,
      totalExports: metrics.totalExports,
      isPackageEntrypoint: metrics.isPackageEntrypoint,
      packageEntrypointReason: metrics.packageEntrypointReason,
      hasTests: metrics.hasTests,
      testFile: metrics.testFile,
      isTestFile: metrics.isTestFile,
    },
  };
}

export interface HotspotEntry {
  path: string;
  score: number;
  reason: string;
}

export interface HotspotsResult {
  metric: string;
  hotspots: HotspotEntry[];
  summary: string;
}

export const HOTSPOT_METRICS = [
  "coupling",
  "pagerank",
  "fan_in",
  "fan_out",
  "betweenness",
  "tension",
  "escape_velocity",
  "churn",
  "complexity",
  "blast_radius",
  "coverage",
] as const;

export type HotspotMetric = typeof HOTSPOT_METRICS[number];

const HOTSPOT_METRIC_SET: ReadonlySet<string> = new Set(HOTSPOT_METRICS);

export function isHotspotMetric(metric: string): metric is HotspotMetric {
  return HOTSPOT_METRIC_SET.has(metric);
}

export function computeHotspots(
  graph: CodebaseGraph,
  metric: string,
  limit?: number,
): HotspotsResult {
  const maxResults = limit ?? 10;
  const scored: HotspotEntry[] = [];

  if (metric === "escape_velocity") {
    for (const mod of graph.moduleMetrics.values()) {
      scored.push({
        path: mod.path,
        score: mod.escapeVelocity,
        reason: `${mod.dependedBy.length} modules depend on it, ${mod.externalDeps} external deps`,
      });
    }
  } else {
    const filterTestFiles = metric === "coverage" || metric === "coupling";
    for (const [filePath, metrics] of graph.fileMetrics) {
      if (filterTestFiles && metrics.isTestFile) continue;

      let score: number;
      let reason: string;

      switch (metric) {
        case "coupling":
          score = metrics.coupling;
          reason = `fan-in: ${metrics.fanIn}, fan-out: ${metrics.fanOut}`;
          break;
        case "pagerank":
          score = metrics.pageRank;
          reason = `${metrics.fanIn} dependents`;
          break;
        case "fan_in":
          score = metrics.fanIn;
          reason = `${metrics.fanIn} files import this`;
          break;
        case "fan_out":
          score = metrics.fanOut;
          reason = `imports ${metrics.fanOut} files`;
          break;
        case "betweenness":
          score = metrics.betweenness;
          reason = metrics.isBridge ? "bridge between clusters" : "on many shortest paths";
          break;
        case "tension":
          score = metrics.tension;
          reason = score > 0 ? "pulled by multiple modules" : "no tension";
          break;
        case "churn":
          score = metrics.churn;
          reason = `${metrics.churn} commits touching this file`;
          break;
        case "complexity":
          score = metrics.cyclomaticComplexity;
          reason = `avg cyclomatic complexity: ${metrics.cyclomaticComplexity.toFixed(1)}`;
          break;
        case "blast_radius":
          score = metrics.blastRadius;
          reason = `${metrics.blastRadius} transitive dependents affected if changed`;
          break;
        case "coverage":
          score = metrics.hasTests ? 0 : 1;
          reason = metrics.hasTests ? `tested (${metrics.testFile})` : "no test file found";
          break;
        default:
          score = 0;
          reason = "";
      }

      scored.push({ path: filePath, score, reason });
    }
  }

  const hotspots = scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
  const topIssue = hotspots[0];
  const summary =
    hotspots.length > 0
      ? `Top ${metric} hotspot: ${topIssue.path} (${topIssue.score.toFixed(2)}). ${topIssue.reason}.`
      : `No significant ${metric} hotspots found.`;

  return { metric, hotspots, summary };
}

export interface SearchResultEntry {
  file: string;
  score: number;
  symbols: Array<{ name: string; type: string; loc: number; relevance: number; typeFacts?: SymbolTypeFacts }>;
}

export interface SearchResult {
  query: string;
  results: SearchResultEntry[];
  suggestions?: string[];
}

export function computeSearch(
  graph: CodebaseGraph,
  query: string,
  limit?: number,
): SearchResult {
  const idx = getSearchIndex(graph);
  const results = search(idx, query, limit ?? 20);

  if (results.length === 0) {
    const suggestions = getSuggestions(idx, query);
    return { query, results: [], suggestions };
  }

  const mapped = results.map((r) => ({
    file: r.file,
    score: r.score,
    symbols: r.symbols.map((s) => ({
      name: s.name,
      type: s.type,
      loc: s.loc,
      relevance: s.score,
      typeFacts: s.typeFacts,
    })),
  }));

  return { query, results: mapped };
}

export interface ChangesResult {
  scope: string;
  changedFiles: string[];
  changedSymbols: Array<{ file: string; symbols: string[] }>;
  affectedFiles: string[];
  fileRiskMetrics: Array<{ file: string; blastRadius: number; complexity: number; churn: number }>;
}

export type ChangesError = { error: string; scope: string };

export const CHANGE_SCOPES = ["staged", "unstaged", "all"] as const;

export type ChangeScope = typeof CHANGE_SCOPES[number];

const CHANGE_SCOPE_SET: ReadonlySet<string> = new Set(CHANGE_SCOPES);

export function isChangeScope(scope: string): scope is ChangeScope {
  return CHANGE_SCOPE_SET.has(scope);
}

export function computeChanges(
  graph: CodebaseGraph,
  scope?: string,
  rootDir = process.cwd(),
): ChangesResult | ChangesError {
  const diffScope = scope ?? "all";
  try {
    let diffCmd: string;
    switch (diffScope) {
      case "staged": diffCmd = "git diff --relative --cached --name-only"; break;
      case "unstaged": diffCmd = "git diff --relative --name-only"; break;
      default: diffCmd = "git diff --relative HEAD --name-only"; break;
    }

    const output = execSync(diffCmd, {
      cwd: path.resolve(rootDir),
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const changedFiles = output ? output.split("\n").filter((f) => f.length > 0) : [];

    const changedSymbols: Array<{ file: string; symbols: string[] }> = [];
    const affectedFiles: string[] = [];
    const fileRiskMetrics: Array<{ file: string; blastRadius: number; complexity: number; churn: number }> = [];

    const symbolsByFile = new Map<string, string[]>();
    for (const m of graph.symbolMetrics.values()) {
      const existing = symbolsByFile.get(m.file);
      if (existing) {
        existing.push(m.name);
      } else {
        symbolsByFile.set(m.file, [m.name]);
      }
    }

    const edgesByTarget = new Map<string, string[]>();
    for (const e of graph.edges) {
      const existing = edgesByTarget.get(e.target);
      if (existing) {
        existing.push(e.source);
      } else {
        edgesByTarget.set(e.target, [e.source]);
      }
    }

    const fileMetricKeys = [...graph.fileMetrics.keys()];

    for (const file of changedFiles) {
      const fileSymbols = symbolsByFile.get(file)
        ?? fileMetricKeys.filter((k) => file.endsWith(k)).flatMap((k) => symbolsByFile.get(k) ?? []);
      if (fileSymbols.length > 0) {
        changedSymbols.push({ file, symbols: fileSymbols });
      }

      const dependents = edgesByTarget.get(file)
        ?? fileMetricKeys.filter((k) => file.endsWith(k)).flatMap((k) => edgesByTarget.get(k) ?? []);
      affectedFiles.push(...dependents);

      const matchKey = graph.fileMetrics.has(file)
        ? file
        : fileMetricKeys.find((k) => file.endsWith(k));
      const metrics = matchKey ? graph.fileMetrics.get(matchKey) : undefined;
      if (metrics) {
        fileRiskMetrics.push({
          file,
          blastRadius: metrics.blastRadius,
          complexity: metrics.cyclomaticComplexity,
          churn: metrics.churn,
        });
      }
    }

    return {
      scope: diffScope,
      changedFiles,
      changedSymbols,
      affectedFiles: [...new Set(affectedFiles)],
      fileRiskMetrics,
    };
  } catch {
    return { error: "Git not available or not in a git repository", scope: diffScope };
  }
}

// ── Dependents ──────────────────────────────────────────────

export interface DependentsResult {
  file: string;
  directDependents: Array<{ path: string; symbols: string[] }>;
  transitiveDependents: Array<{ path: string; throughPath: string[]; depth: number }>;
  totalAffected: number;
  riskLevel: string;
}

export type DependentsError = { error: string };

export function computeDependents(
  graph: CodebaseGraph,
  filePath: string,
  depth?: number,
): DependentsResult | DependentsError {
  if (!graph.fileMetrics.has(filePath)) {
    return { error: `File not found in graph: ${filePath}` };
  }

  const maxDepth = depth ?? 2;
  const directDependents = graph.edges
    .filter((e) => e.target === filePath)
    .map((e) => ({ path: e.source, symbols: e.symbols }));

  const reverseAdj = buildReverseAdjacency(graph);
  const transitive: Array<{ path: string; throughPath: string[]; depth: number }> = [];
  const visited = new Set<string>([filePath]);
  const parentChain = new Map<string, string[]>();
  parentChain.set(filePath, []);

  let currentLevel = [filePath];
  for (let currentDepth = 1; currentDepth <= maxDepth && currentLevel.length > 0; currentDepth++) {
    const nextLevel: string[] = [];
    for (const node of currentLevel) {
      const deps = reverseAdj.get(node) ?? [];
      for (const dep of deps) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        const chain = [...(parentChain.get(node) ?? []), node];
        parentChain.set(dep, chain);
        if (currentDepth > 1) {
          transitive.push({ path: dep, throughPath: chain, depth: currentDepth });
        }
        nextLevel.push(dep);
      }
    }
    currentLevel = nextLevel;
  }
  const totalAffected = visited.size - 1;
  const riskLevel = totalAffected > 20 ? "HIGH" : totalAffected > 5 ? "MEDIUM" : "LOW";

  return { file: filePath, directDependents, transitiveDependents: transitive, totalAffected, riskLevel };
}

// ── Module Structure ────────────────────────────────────────

export interface ModuleStructureResult {
  modules: Array<{
    path: string; files: number; loc: number; exports: number;
    internalDeps: number; externalDeps: number; cohesion: number;
    escapeVelocity: number; dependsOn: string[]; dependedBy: string[];
  }>;
  crossModuleDeps: Array<{ from: string; to: string; weight: number }>;
  circularDeps: Array<{ cycle: string[][]; severity: string }>;
}

export function computeModuleStructure(graph: CodebaseGraph): ModuleStructureResult {
  const modules = [...graph.moduleMetrics.values()].map((m) => ({
    path: m.path, files: m.files, loc: m.loc, exports: m.exports,
    internalDeps: m.internalDeps, externalDeps: m.externalDeps,
    cohesion: m.cohesion, escapeVelocity: m.escapeVelocity,
    dependsOn: m.dependsOn, dependedBy: m.dependedBy,
  }));

  const nodeById = buildNodeById(graph);
  const crossMap = new Map<string, { from: string; to: string; weight: number }>();
  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.module === targetNode.module) continue;
    const key = `${sourceNode.module}\0${targetNode.module}`;
    const existing = crossMap.get(key);
    if (existing) existing.weight++;
    else crossMap.set(key, { from: sourceNode.module, to: targetNode.module, weight: 1 });
  }

  const crossModuleDeps = [...crossMap.values()];

  return {
    modules: modules.sort((a, b) => b.files - a.files),
    crossModuleDeps: crossModuleDeps.sort((a, b) => b.weight - a.weight),
    circularDeps: graph.stats.circularDeps.map((cycle) => ({
      cycle: [cycle],
      severity: cycle.length > 3 ? "HIGH" : "LOW",
    })),
  };
}

// ── Forces ──────────────────────────────────────────────────

export interface ForcesResult {
  moduleCohesion: Array<{ path: string; cohesion: number; verdict: string; files: number }>;
  tensionFiles: Array<{ file: string; tension: number; pulledBy: Array<{ module: string; strength: number; symbols: string[] }>; recommendation: string }>;
  bridgeFiles: Array<{ file: string; betweenness: number; connects: string[]; role: string }>;
  extractionCandidates: Array<{ target: string; escapeVelocity: number; recommendation: string }>;
  shallowModules: Array<{ module: string; files: number; exports: number; exportsPerFile: number; cohesion: number; locPerExport: number; evidence: string }>;
  deepModules: Array<{ module: string; files: number; exports: number; exportsPerFile: number; locPerExport: number; dependedByModules: number; evidence: string }>;
  seamCandidates: Array<{ target: string; scope: string; exposedSymbols: number; fanIn: number; dependentModules: number; evidence: string }>;
  localityRisks: Array<{ file: string; kind: string; tension: number; blastRadius: number; isBridge: boolean; pulledByModuleCount: number; evidence: string }>;
  summary: string;
}

export function computeForces(
  graph: CodebaseGraph,
  cohesionThreshold?: number,
  tensionThreshold?: number,
  escapeThreshold?: number,
): ForcesResult {
  const cohesionMin = cohesionThreshold ?? 0.6;
  const tensionMin = tensionThreshold ?? 0.3;
  const escapeMin = escapeThreshold ?? 0.5;

  type CohesionVerdict = "COHESIVE" | "MODERATE" | "JUNK_DRAWER" | "LEAF";
  const moduleCohesion = graph.forceAnalysis.moduleCohesion.map((m) => {
    if (m.verdict === "LEAF") return { path: m.path, cohesion: m.cohesion, verdict: "LEAF" as CohesionVerdict, files: m.files };
    const verdict: CohesionVerdict = m.cohesion >= cohesionMin ? "COHESIVE" : m.cohesion >= cohesionMin * 0.67 ? "MODERATE" : "JUNK_DRAWER";
    return { path: m.path, cohesion: m.cohesion, verdict, files: m.files };
  });

  const tensionFiles = graph.forceAnalysis.tensionFiles.filter((t) => t.tension > tensionMin);
  const extractionCandidates = graph.forceAnalysis.extractionCandidates
    .filter((e) => e.escapeVelocity >= escapeMin)
    .map((e) => ({ target: e.target, escapeVelocity: e.escapeVelocity, recommendation: e.recommendation }));

  return {
    moduleCohesion,
    tensionFiles,
    bridgeFiles: graph.forceAnalysis.bridgeFiles,
    extractionCandidates,
    shallowModules: graph.forceAnalysis.shallowModules,
    deepModules: graph.forceAnalysis.deepModules,
    seamCandidates: graph.forceAnalysis.seamCandidates,
    localityRisks: graph.forceAnalysis.localityRisks,
    summary: graph.forceAnalysis.summary,
  };
}

// ── Dead Exports ────────────────────────────────────────────

export interface DeadExportsResult {
  totalDeadExports: number;
  files: Array<{
    path: string;
    module: string;
    deadExports: string[];
    totalExports: number;
    confidence: OpportunityConfidence;
    isPackageEntrypoint: boolean;
    packageEntrypointReason: string;
  }>;
  summary: string;
}

export function computeDeadExports(
  graph: CodebaseGraph,
  module?: string,
  limit?: number,
): DeadExportsResult {
  const maxResults = limit ?? 20;
  const nodeById = buildNodeById(graph);
  const deadFiles: DeadExportsResult["files"] = [];

  for (const [filePath, metrics] of graph.fileMetrics) {
    if (metrics.deadExports.length === 0) continue;
    const node = nodeById.get(filePath);
    if (!node) continue;
    if (module && node.module !== module) continue;
    deadFiles.push({
      path: filePath,
      module: node.module,
      deadExports: metrics.deadExports,
      totalExports: metrics.totalExports,
      confidence: metrics.isPackageEntrypoint ? "low" : "high",
      isPackageEntrypoint: metrics.isPackageEntrypoint,
      packageEntrypointReason: metrics.packageEntrypointReason,
    });
  }

  deadFiles.sort((a, b) => confidenceSortValue(b.confidence) - confidenceSortValue(a.confidence) || b.deadExports.length - a.deadExports.length);
  const totalDead = deadFiles.reduce((sum, f) => sum + f.deadExports.length, 0);
  const sorted = deadFiles.slice(0, maxResults);

  return {
    totalDeadExports: totalDead,
    files: sorted,
    summary: totalDead > 0
      ? `${totalDead} unused exports across ${sorted.length} files. Consider removing to reduce API surface.`
      : "No dead exports found.",
  };
}

function confidenceSortValue(confidence: OpportunityConfidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

// ── Opportunities ──────────────────────────────────────────

export type OpportunityKind =
  | "add-tests"
  | "split-file"
  | "stabilize-hotspot"
  | "extract-seam"
  | "move-file"
  | "split-module"
  | "reduce-api-surface";

export type OpportunityPriority = "critical" | "high" | "medium" | "low";
export type OpportunityConfidence = "high" | "medium" | "low";

export interface OpportunityEntry {
  rank: number;
  kind: OpportunityKind;
  target: string;
  title: string;
  priority: OpportunityPriority;
  score: number;
  confidence: OpportunityConfidence;
  why: string;
  evidence: string[];
  suggestedCommands: string[];
}

export interface OpportunitiesResult {
  totalOpportunities: number;
  opportunities: OpportunityEntry[];
  summary: string;
}

type OpportunityDraft = Omit<OpportunityEntry, "rank" | "priority">;

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function priorityForScore(score: number): OpportunityPriority {
  if (score >= 80) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function isFrameworkEntrypoint(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? normalized;
  return basename === "page.tsx"
    || basename === "page.ts"
    || basename === "layout.tsx"
    || basename === "layout.ts"
    || basename === "route.ts"
    || basename === "route.tsx"
    || basename === "template.tsx"
    || basename === "error.tsx"
    || basename === "loading.tsx"
    || basename === "not-found.tsx"
    || basename === "global-error.tsx"
    || basename === "instrumentation.ts";
}

function addOpportunity(
  opportunities: Map<string, OpportunityDraft>,
  opportunity: OpportunityDraft,
): void {
  const key = `${opportunity.kind}\0${opportunity.target}`;
  const existing = opportunities.get(key);
  if (!existing || opportunity.score > existing.score) {
    opportunities.set(key, {
      ...opportunity,
      score: roundScore(opportunity.score),
    });
  }
}

function selectDiverseOpportunities(sorted: OpportunityDraft[], maxResults: number): OpportunityDraft[] {
  const selected: OpportunityDraft[] = [];
  const overflow: OpportunityDraft[] = [];
  const targetCounts = new Map<string, number>();

  for (const opportunity of sorted) {
    const targetCount = targetCounts.get(opportunity.target) ?? 0;
    if (targetCount < 2) {
      selected.push(opportunity);
      targetCounts.set(opportunity.target, targetCount + 1);
      if (selected.length === maxResults) return selected;
    } else {
      overflow.push(opportunity);
    }
  }

  for (const opportunity of overflow) {
    if (selected.length === maxResults) break;
    selected.push(opportunity);
  }

  return selected.sort((left, right) => right.score - left.score);
}

export function computeOpportunities(graph: CodebaseGraph, limit?: number): OpportunitiesResult {
  const maxResults = limit ?? 20;
  const nodeById = buildNodeById(graph);
  const opportunities = new Map<string, OpportunityDraft>();

  for (const [filePath, metrics] of graph.fileMetrics) {
    if (metrics.isTestFile) continue;

    const node = nodeById.get(filePath);
    const loc = node?.loc ?? 0;

    if (!metrics.hasTests && (metrics.cyclomaticComplexity >= 8 || metrics.blastRadius >= 5 || metrics.fanIn >= 3)) {
      addOpportunity(opportunities, {
        kind: "add-tests",
        target: filePath,
        title: "Add regression coverage before refactoring",
        score: metrics.cyclomaticComplexity * 2 + metrics.blastRadius + metrics.fanIn * 2 + metrics.churn,
        confidence: "high",
        why: "Important file has no matching test file.",
        evidence: [
          `complexity=${metrics.cyclomaticComplexity.toFixed(1)}`,
          `blastRadius=${metrics.blastRadius}`,
          `fanIn=${metrics.fanIn}`,
          "hasTests=false",
        ],
        suggestedCommands: [
          `codebase-intelligence file . ${filePath}`,
          `codebase-intelligence dependents . ${filePath}`,
        ],
      });
    }

    if (metrics.cyclomaticComplexity >= 12 || loc >= 300) {
      addOpportunity(opportunities, {
        kind: "split-file",
        target: filePath,
        title: "Split complex file into smaller units",
        score: metrics.cyclomaticComplexity * 3 + loc / 40 + metrics.tension * 20,
        confidence: metrics.hasTests ? "high" : "medium",
        why: "High complexity or large file size makes future changes risky.",
        evidence: [
          `complexity=${metrics.cyclomaticComplexity.toFixed(1)}`,
          `loc=${loc}`,
          `tension=${metrics.tension.toFixed(2)}`,
        ],
        suggestedCommands: [
          `codebase-intelligence file . ${filePath}`,
          "codebase-intelligence hotspots . --metric complexity --limit 10",
        ],
      });
    }

    if (metrics.blastRadius >= 15 || metrics.fanIn >= 10 || metrics.isBridge) {
      addOpportunity(opportunities, {
        kind: "stabilize-hotspot",
        target: filePath,
        title: "Stabilize high-blast-radius file",
        score: metrics.blastRadius * 2 + metrics.fanIn * 2 + metrics.betweenness * 10 + (metrics.isBridge ? 15 : 0),
        confidence: metrics.hasTests ? "high" : "medium",
        why: "Many files depend on this file, so small changes can ripple broadly.",
        evidence: [
          `blastRadius=${metrics.blastRadius}`,
          `fanIn=${metrics.fanIn}`,
          `isBridge=${metrics.isBridge}`,
        ],
        suggestedCommands: [
          `codebase-intelligence dependents . ${filePath} --depth 3`,
          `codebase-intelligence file . ${filePath}`,
        ],
      });
    }

    if (metrics.deadExports.length > 0) {
      const frameworkEntrypoint = isFrameworkEntrypoint(filePath);
      const packageEntrypoint = metrics.isPackageEntrypoint;
      const conventionEntrypoint = frameworkEntrypoint || packageEntrypoint;
      addOpportunity(opportunities, {
        kind: "reduce-api-surface",
        target: filePath,
        title: conventionEntrypoint ? "Audit public API surface" : "Review unused exports",
        score: conventionEntrypoint
          ? Math.min(metrics.deadExports.length, 30) + Math.min(metrics.fanIn, 10)
          : metrics.deadExports.length * 6 + metrics.fanIn,
        confidence: conventionEntrypoint ? "low" : "medium",
        why: packageEntrypoint
          ? "Exports look unused internally, but package consumers may rely on this public entrypoint."
          : frameworkEntrypoint
          ? "Exports look unused by imports, but framework entrypoints may be consumed by convention."
          : "Unused exports increase API surface and rename/refactor cost.",
        evidence: [
          `deadExports=${metrics.deadExports.length}`,
          `sample=${metrics.deadExports.slice(0, 5).join(", ")}`,
          `frameworkEntrypoint=${frameworkEntrypoint}`,
          `packageEntrypoint=${packageEntrypoint}`,
          metrics.packageEntrypointReason ? `packageEntrypointReason=${metrics.packageEntrypointReason}` : "",
        ].filter(Boolean),
        suggestedCommands: [
          `codebase-intelligence file . ${filePath}`,
          packageEntrypoint ? "Review package.json exports/main/types/bin before removing symbols" : "codebase-intelligence dead-exports . --limit 20",
        ],
      });
    }
  }

  for (const seam of graph.forceAnalysis.seamCandidates) {
    addOpportunity(opportunities, {
      kind: "extract-seam",
      target: seam.target,
      title: seam.scope === "module" ? "Extract module boundary seam" : "Extract file boundary seam",
      score: seam.fanIn + seam.dependentModules * 5 + seam.exposedSymbols,
      confidence: seam.dependentModules > 1 ? "high" : "medium",
      why: "This target exposes symbols used across module boundaries.",
      evidence: [
        seam.evidence,
        `scope=${seam.scope}`,
        `fanIn=${seam.fanIn}`,
        `dependentModules=${seam.dependentModules}`,
      ],
      suggestedCommands: [
        "codebase-intelligence forces .",
        seam.scope === "file"
          ? `codebase-intelligence dependents . ${seam.target}`
          : "codebase-intelligence modules .",
      ],
    });
  }

  for (const risk of graph.forceAnalysis.localityRisks) {
    addOpportunity(opportunities, {
      kind: "move-file",
      target: risk.file,
      title: "Review file placement and ownership",
      score: risk.blastRadius * 2 + risk.tension * 25 + risk.pulledByModuleCount * 5 + (risk.isBridge ? 10 : 0),
      confidence: risk.tension > 0.3 ? "high" : "medium",
      why: "Dependency pulls suggest this file may sit in the wrong module or own too many concepts.",
      evidence: [
        risk.evidence,
        `kind=${risk.kind}`,
        `blastRadius=${risk.blastRadius}`,
        `tension=${risk.tension.toFixed(2)}`,
      ],
      suggestedCommands: [
        `codebase-intelligence file . ${risk.file}`,
        "codebase-intelligence forces .",
      ],
    });
  }

  for (const module of graph.forceAnalysis.moduleCohesion) {
    if (module.verdict !== "JUNK_DRAWER" || module.files < 3) continue;
    addOpportunity(opportunities, {
      kind: "split-module",
      target: module.path,
      title: "Split low-cohesion module",
      score: module.files + module.externalDeps + (1 - module.cohesion) * 40,
      confidence: "medium",
      why: "Module files do not form a cohesive dependency group.",
      evidence: [
        `files=${module.files}`,
        `cohesion=${module.cohesion.toFixed(2)}`,
        `externalDeps=${module.externalDeps}`,
      ],
      suggestedCommands: [
        "codebase-intelligence modules .",
        "codebase-intelligence forces .",
      ],
    });
  }

  for (const candidate of graph.forceAnalysis.extractionCandidates) {
    addOpportunity(opportunities, {
      kind: "extract-seam",
      target: candidate.target,
      title: "Extract high-escape-velocity module",
      score: candidate.escapeVelocity * 50 + candidate.dependedByModules * 5,
      confidence: candidate.escapeVelocity >= 0.7 ? "high" : "medium",
      why: candidate.recommendation,
      evidence: [
        `escapeVelocity=${candidate.escapeVelocity.toFixed(2)}`,
        `internalDeps=${candidate.internalDeps}`,
        `externalDeps=${candidate.externalDeps}`,
        `dependedByModules=${candidate.dependedByModules}`,
      ],
      suggestedCommands: [
        "codebase-intelligence forces .",
        "codebase-intelligence modules .",
      ],
    });
  }

  const sorted = [...opportunities.values()].sort((left, right) => right.score - left.score);
  const ranked = selectDiverseOpportunities(sorted, maxResults)
    .map((opportunity, index): OpportunityEntry => ({
      rank: index + 1,
      priority: priorityForScore(opportunity.score),
      ...opportunity,
    }));

  const summary = ranked.length > 0
    ? `${ranked.length} ranked opportunities. Top: ${ranked[0].title} (${ranked[0].target}).`
    : "No high-signal opportunities found.";

  return {
    totalOpportunities: opportunities.size,
    opportunities: ranked,
    summary,
  };
}

// ── Groups ──────────────────────────────────────────────────

export interface GroupsResult {
  groups: Array<{ rank: number; name: string; files: number; loc: number; importance: string; coupling: { total: number; fanIn: number; fanOut: number } }>;
}

export function computeGroups(graph: CodebaseGraph): GroupsResult {
  return {
    groups: graph.groups.map((g, i) => ({
      rank: i + 1,
      name: g.name.toUpperCase(),
      files: g.files,
      loc: g.loc,
      importance: `${(g.importance * 100).toFixed(1)}%`,
      coupling: { total: g.fanIn + g.fanOut, fanIn: g.fanIn, fanOut: g.fanOut },
    })),
  };
}

// ── Symbol Context ──────────────────────────────────────────

export interface SymbolContextResult {
  name: string; file: string; type: string; loc: number;
  isDefault: boolean; complexity: number;
  typeFacts?: SymbolTypeFacts;
  fanIn: number; fanOut: number; pageRank: number; betweenness: number;
  callers: Array<{ symbol: string; file: string; confidence: string }>;
  callees: Array<{ symbol: string; file: string; confidence: string }>;
}

export type SymbolContextError = { error: string };

export function computeSymbolContext(
  graph: CodebaseGraph,
  symbolName: string,
): SymbolContextResult | SymbolContextError {
  const matches = [...graph.symbolMetrics.values()].filter(
    (m) => m.name === symbolName || m.symbolId.endsWith(`::${symbolName}`)
  );

  if (matches.length === 0) {
    return { error: `Symbol not found: ${symbolName}` };
  }

  const sym = matches[0];
  const symNode = graph.symbolNodes.find((n) => n.id === sym.symbolId);
  const callers = graph.callEdges
    .filter((e) => e.calleeSymbol === symbolName || e.target === sym.symbolId)
    .map((e) => ({ symbol: e.callerSymbol, file: e.source.split("::")[0], confidence: e.confidence }));

  const callees = graph.callEdges
    .filter((e) => e.callerSymbol === symbolName || e.source === sym.symbolId)
    .map((e) => ({ symbol: e.calleeSymbol, file: e.target.split("::")[0], confidence: e.confidence }));

  return {
    name: sym.name, file: sym.file,
    type: symNode?.type ?? "function", loc: symNode?.loc ?? 0,
    isDefault: symNode?.isDefault ?? false, complexity: symNode?.complexity ?? 0,
    typeFacts: symNode?.typeFacts,
    fanIn: sym.fanIn, fanOut: sym.fanOut,
    pageRank: Math.round(sym.pageRank * 10000) / 10000,
    betweenness: Math.round(sym.betweenness * 10000) / 10000,
    callers, callees,
  };
}

// ── Processes ───────────────────────────────────────────────

export interface ProcessesResult {
  processes: Array<{
    name: string; entryPoint: { file: string; symbol: string };
    steps: Array<{ step: number; file: string; symbol: string }>;
    depth: number; modulesTouched: string[];
  }>;
  totalProcesses: number;
}

export function computeProcesses(
  graph: CodebaseGraph,
  entryPoint?: string,
  limit?: number,
): ProcessesResult {
  let processes = graph.processes;
  if (entryPoint) {
    processes = processes.filter((p) =>
      p.entryPoint.symbol === entryPoint ||
      p.name.toLowerCase().includes(entryPoint.toLowerCase())
    );
  }
  if (limit) {
    processes = processes.slice(0, limit);
  }

  return {
    processes: processes.map((p) => ({
      name: p.name, entryPoint: p.entryPoint,
      steps: p.steps, depth: p.depth, modulesTouched: p.modulesTouched,
    })),
    totalProcesses: graph.processes.length,
  };
}

// ── Clusters ────────────────────────────────────────────────

export interface ClustersResult {
  clusters: Array<{ id: string; name: string; files: string[]; fileCount: number; cohesion: number }>;
  totalClusters: number;
}

export function computeClusters(
  graph: CodebaseGraph,
  minFiles?: number,
): ClustersResult {
  let clusters = graph.clusters;
  if (minFiles) {
    clusters = clusters.filter((c) => c.files.length >= minFiles);
  }

  return {
    clusters: clusters.map((c) => ({
      id: c.id, name: c.name, files: c.files,
      fileCount: c.files.length, cohesion: c.cohesion,
    })),
    totalClusters: graph.clusters.length,
  };
}

// Re-export impact analysis functions
export { impactAnalysis, renameSymbol };
