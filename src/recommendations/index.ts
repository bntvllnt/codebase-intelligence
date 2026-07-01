import type { CodebaseGraph } from "../types/index.js";

export type ArchitectureRecommendationKind = "extract-module" | "reduce-tension" | "add-seam" | "improve-locality";

export interface ArchitectureRecommendation {
  id: string;
  kind: ArchitectureRecommendationKind;
  title: string;
  effort: "small" | "medium" | "large";
  score: number;
  affectedFiles: string[];
  evidence: string[];
  contextPack: {
    files: string[];
    symbols: string[];
    commands: string[];
  };
}

export interface ArchitectureRecommendationsResult {
  recommendations: ArchitectureRecommendation[];
  summary: string;
}

function effortFor(score: number): ArchitectureRecommendation["effort"] {
  if (score >= 70) return "large";
  if (score >= 35) return "medium";
  return "small";
}

function stableId(kind: ArchitectureRecommendationKind, target: string): string {
  const clean = target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `arch:${kind}:${clean || "root"}`;
}

export function computeArchitectureRecommendations(graph: CodebaseGraph): ArchitectureRecommendationsResult {
  const recommendations: ArchitectureRecommendation[] = [];

  for (const candidate of graph.forceAnalysis.extractionCandidates) {
    const score = candidate.escapeVelocity * 80 + candidate.dependedByModules * 5;
    recommendations.push({
      id: stableId("extract-module", candidate.target),
      kind: "extract-module",
      title: `Extract ${candidate.target} behind a package boundary`,
      effort: effortFor(score),
      score,
      affectedFiles: graph.nodes.filter((node) => node.type === "file" && node.module === candidate.target).map((node) => node.id),
      evidence: [
        `escapeVelocity=${candidate.escapeVelocity.toFixed(2)}`,
        `dependedByModules=${String(candidate.dependedByModules)}`,
        `externalDeps=${String(candidate.externalDeps)}`,
      ],
      contextPack: {
        files: graph.nodes.filter((node) => node.type === "file" && node.module === candidate.target).map((node) => node.id).slice(0, 8),
        symbols: graph.symbolNodes.filter((symbol) => symbol.file.startsWith(candidate.target)).map((symbol) => symbol.name).slice(0, 12),
        commands: [`codebase-intelligence forces .`, `codebase-intelligence map . --scope ${candidate.target} --json`],
      },
    });
  }

  for (const tension of graph.forceAnalysis.tensionFiles.slice(0, 20)) {
    const score = tension.tension * 60 + tension.pulledBy.length * 5;
    recommendations.push({
      id: stableId("reduce-tension", tension.file),
      kind: "reduce-tension",
      title: `Reduce mixed ownership in ${tension.file}`,
      effort: effortFor(score),
      score,
      affectedFiles: [tension.file],
      evidence: [`tension=${tension.tension.toFixed(2)}`, `pulledBy=${tension.pulledBy.map((pull) => pull.module).join(",")}`],
      contextPack: {
        files: [tension.file],
        symbols: tension.pulledBy.flatMap((pull) => pull.symbols).slice(0, 12),
        commands: [`codebase-intelligence file . ${tension.file}`, "codebase-intelligence forces . --json"],
      },
    });
  }

  for (const seam of graph.forceAnalysis.seamCandidates.slice(0, 20)) {
    const score = seam.fanIn * 15 + seam.exposedSymbols;
    recommendations.push({
      id: stableId("add-seam", seam.target),
      kind: "add-seam",
      title: `Formalize ${seam.target} as an explicit interface seam`,
      effort: effortFor(score),
      score,
      affectedFiles: graph.nodes.filter((node) => node.type === "file" && node.module === seam.target).map((node) => node.id),
      evidence: [seam.evidence, `fanIn=${String(seam.fanIn)}`],
      contextPack: {
        files: graph.nodes.filter((node) => node.type === "file" && node.module === seam.target).map((node) => node.id).slice(0, 8),
        symbols: graph.symbolNodes.filter((symbol) => symbol.file.startsWith(seam.target)).map((symbol) => symbol.name).slice(0, 12),
        commands: [`codebase-intelligence map . --scope ${seam.target} --context-budget 1200 --json`],
      },
    });
  }

  for (const risk of graph.forceAnalysis.localityRisks.slice(0, 20)) {
    const score = risk.tension * 40 + risk.blastRadius + (risk.isBridge ? 10 : 0);
    recommendations.push({
      id: stableId("improve-locality", risk.file),
      kind: "improve-locality",
      title: `Improve locality around ${risk.file}`,
      effort: effortFor(score),
      score,
      affectedFiles: [risk.file],
      evidence: [risk.evidence, `blastRadius=${String(risk.blastRadius)}`, `bridge=${String(risk.isBridge)}`],
      contextPack: {
        files: [risk.file],
        symbols: graph.symbolNodes.filter((symbol) => symbol.file === risk.file).map((symbol) => symbol.name).slice(0, 12),
        commands: [`codebase-intelligence dependents . ${risk.file} --json`],
      },
    });
  }

  const sorted = recommendations.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return {
    recommendations: sorted,
    summary: `${String(sorted.length)} architecture recommendation(s); top ${sorted[0]?.id ?? "none"}.`,
  };
}

export function formatArchitectureRecommendationsText(result: ArchitectureRecommendationsResult): string {
  const lines = ["Architecture Recommendations", result.summary, ""];
  for (const item of result.recommendations.slice(0, 10)) {
    lines.push(`${item.id} ${item.effort} score=${item.score.toFixed(2)} — ${item.title}`);
    lines.push(`  files: ${item.affectedFiles.slice(0, 5).join(", ")}`);
  }
  return lines.join("\n");
}
