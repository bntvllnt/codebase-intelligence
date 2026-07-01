import type { CodebaseGraph, FileMetrics, GraphNode } from "../types/index.js";
import { loadCoverage, type CoverageSource } from "./coverage.js";
import {
  averageHealth,
  componentHealth,
  computeCrapScore,
  computeMaintainabilityIndex,
  computeRiskScore,
  roundHealthScore,
} from "./scoring.js";

export interface HealthOptions {
  minScore?: number;
  score?: boolean;
}

export interface HealthContext {
  rootDir?: string;
}

export type HealthVerdict = "pass" | "fail";

export interface HealthFileResult {
  file: string;
  loc: number;
  maintainabilityIndex: number;
  crapScore: number;
  riskScore: number;
  coverage: number;
  coverageSource: CoverageSource;
  metrics: {
    complexity: number;
    cognitiveComplexity: number;
    churn: number;
    coupling: number;
    blastRadius: number;
    fanIn: number;
    fanOut: number;
    hasTests: boolean;
  };
  evidence: string[];
}

export interface HealthResult {
  score: number;
  minScore: number;
  verdict: HealthVerdict;
  summary: string;
  components: {
    maintainability: number;
    complexity: number;
    cognitiveComplexity: number;
    churn: number;
    coupling: number;
    coverage: number;
    blastRadius: number;
  };
  coverage: {
    source: CoverageSource;
    coveredFiles: number;
    totalFiles: number;
    warning?: string;
  };
  files: HealthFileResult[];
  hotspots: HealthFileResult[];
  actions: Array<{ command: string; reason: string }>;
}

function nodeMap(graph: CodebaseGraph): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (node.type === "file") nodes.set(node.path, node);
  }
  return nodes;
}

function fileEvidence(metrics: FileMetrics, coverage: number, loc: number): string[] {
  const evidence = [
    `complexity=${metrics.cyclomaticComplexity.toFixed(1)}`,
    `cognitiveComplexity=${(metrics.cognitiveComplexity ?? metrics.cyclomaticComplexity).toFixed(1)}`,
    `churn=${metrics.churn}`,
    `coupling=${metrics.coupling.toFixed(2)}`,
    `loc=${loc}`,
    `coverage=${Math.round(coverage * 100)}%`,
  ];

  if (!metrics.hasTests) evidence.push("hasTests=false");
  if (metrics.blastRadius > 0) evidence.push(`blastRadius=${metrics.blastRadius}`);
  return evidence;
}

function coverageForFile(
  filePath: string,
  metrics: FileMetrics,
  lookup: ReturnType<typeof loadCoverage>,
): { coverage: number; source: CoverageSource } {
  const exactCoverage = lookup.files.get(filePath);
  if (lookup.source === "istanbul" && exactCoverage !== undefined) {
    return { coverage: exactCoverage, source: "istanbul" };
  }

  return { coverage: metrics.hasTests ? 1 : 0, source: "static-tests" };
}

function compareFiles(left: HealthFileResult, right: HealthFileResult): number {
  return right.riskScore - left.riskScore
    || right.crapScore - left.crapScore
    || left.maintainabilityIndex - right.maintainabilityIndex
    || left.file.localeCompare(right.file);
}

function healthSummary(hotspots: readonly HealthFileResult[], score: number, minScore: number, verdict: HealthVerdict): string {
  if (hotspots.length === 0) return `Health ${score.toFixed(2)}/${minScore} ${verdict}; no source files found.`;
  const [top] = hotspots;
  return `Health ${score.toFixed(2)}/${minScore} ${verdict}; top risk ${top.file} (${top.riskScore.toFixed(2)}).`;
}

export function computeHealth(
  graph: CodebaseGraph,
  options: HealthOptions = {},
  context: HealthContext = {},
): HealthResult {
  const minScore = options.minScore ?? 70;
  const nodes = nodeMap(graph);
  const coverageLookup = loadCoverage(context.rootDir);
  const files: HealthFileResult[] = [];

  for (const [filePath, metrics] of graph.fileMetrics) {
    if (metrics.isTestFile) continue;

    const loc = nodes.get(filePath)?.loc ?? 0;
    const fileCoverage = coverageForFile(filePath, metrics, coverageLookup);
    const scoreInput = { loc, coverage: fileCoverage.coverage, metrics };
    const maintainabilityIndex = computeMaintainabilityIndex(scoreInput);
    const crapScore = computeCrapScore(metrics.cyclomaticComplexity, fileCoverage.coverage);
    const riskScore = computeRiskScore(scoreInput);

    files.push({
      file: filePath,
      loc,
      maintainabilityIndex,
      crapScore,
      riskScore,
      coverage: roundHealthScore(fileCoverage.coverage * 100),
      coverageSource: fileCoverage.source,
      metrics: {
        complexity: metrics.cyclomaticComplexity,
        cognitiveComplexity: metrics.cognitiveComplexity ?? metrics.cyclomaticComplexity,
        churn: metrics.churn,
        coupling: metrics.coupling,
        blastRadius: metrics.blastRadius,
        fanIn: metrics.fanIn,
        fanOut: metrics.fanOut,
        hasTests: metrics.hasTests,
      },
      evidence: fileEvidence(metrics, fileCoverage.coverage, loc),
    });
  }

  const sortedFiles = files.sort(compareFiles);
  const components = {
    maintainability: averageHealth(sortedFiles.map((file) => file.maintainabilityIndex)),
    complexity: componentHealth(sortedFiles.map((file) => file.metrics.complexity), 20),
    cognitiveComplexity: componentHealth(sortedFiles.map((file) => file.metrics.cognitiveComplexity), 25),
    churn: componentHealth(sortedFiles.map((file) => file.metrics.churn), 20),
    coupling: componentHealth(sortedFiles.map((file) => file.metrics.coupling), 20),
    coverage: averageHealth(sortedFiles.map((file) => file.coverage)),
    blastRadius: componentHealth(sortedFiles.map((file) => file.metrics.blastRadius), 50),
  };

  const score = roundHealthScore(
    components.maintainability * 0.35
    + components.coverage * 0.2
    + components.complexity * 0.15
    + components.coupling * 0.1
    + components.churn * 0.1
    + components.blastRadius * 0.1,
  );
  const verdict: HealthVerdict = score >= minScore ? "pass" : "fail";
  const hotspots = sortedFiles.slice(0, 10);
  const coveredFiles = sortedFiles.filter((file) => file.coverage > 0).length;

  return {
    score,
    minScore,
    verdict,
    summary: healthSummary(hotspots, score, minScore, verdict),
    components,
    coverage: {
      source: coverageLookup.source,
      coveredFiles,
      totalFiles: sortedFiles.length,
      warning: coverageLookup.warning,
    },
    files: sortedFiles,
    hotspots,
    actions: hotspots.slice(0, 3).map((file) => ({
      command: `codebase-intelligence file . ${file.file}`,
      reason: `risk=${file.riskScore.toFixed(2)}, maintainability=${file.maintainabilityIndex.toFixed(2)}, crap=${file.crapScore.toFixed(2)}`,
    })),
  };
}
