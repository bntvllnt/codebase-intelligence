import type {
  ChangesError,
  ChangesResult,
  ClustersResult,
  DeadExportsResult,
  DependentsError,
  DependentsResult,
  FileContextError,
  FileContextResult,
  ForcesResult,
  GroupsResult,
  HotspotsResult,
  ModuleStructureResult,
  OpportunitiesResult,
  OverviewResult,
  ProcessesResult,
  SearchResult,
  SymbolContextError,
  SymbolContextResult,
} from "../core/index.js";
import type { ImpactResult, RenameResult } from "../impact/index.js";

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

function signatureSuffix(signature: string | undefined): string {
  return signature ? ` — ${signature}` : "";
}

/**
 * Format an overview operation result for human CLI output.
 */
export function formatOverviewText(result: OverviewResult): string {
  const lines = [
    "Codebase Overview",
    "─────────────────",
    `Files:        ${result.totalFiles}`,
    `Functions:    ${result.totalFunctions}`,
    `Dependencies: ${result.totalDependencies}`,
    `Analysis:     ${result.analysis.mode} (${result.analysis.callGraphPrecision} call graph)`,
    `Avg LOC:      ${result.metrics.avgLOC}`,
    `Max Depth:    ${result.metrics.maxDepth}`,
    `Circular:     ${result.metrics.circularDeps}`,
    "",
    "Modules",
    `${"Path".padEnd(40)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Coupling".padStart(10)} ${"Cohesion".padStart(10)}`,
    `${"─".repeat(40)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(10)}`,
    ...result.modules.map(
      (m) =>
        `${m.path.padEnd(40)} ${String(m.files).padStart(6)} ${String(m.loc).padStart(8)} ${m.avgCoupling.padStart(10)} ${m.cohesion.toFixed(2).padStart(10)}`,
    ),
    "",
    "Top Depended Files",
    ...result.topDependedFiles.map((file) => `  ${file}`),
  ];
  return text(lines);
}

/**
 * Format a hotspots operation result for human CLI output.
 */
export function formatHotspotsText(result: HotspotsResult): string {
  return text([
    `Hotspots: ${result.metric}`,
    `──────────${"─".repeat(result.metric.length)}`,
    `${"Path".padEnd(50)} ${"Score".padStart(10)} Reason`,
    `${"─".repeat(50)} ${"─".repeat(10)} ${"─".repeat(30)}`,
    ...result.hotspots.map((hotspot) => `${hotspot.path.padEnd(50)} ${hotspot.score.toFixed(2).padStart(10)} ${hotspot.reason}`),
    "",
    result.summary,
  ]);
}

/**
 * Format a file-context operation result for human CLI output.
 */
export function formatFileContextText(result: FileContextResult | FileContextError): string {
  if ("error" in result) return result.error;

  const lines = [
    `File: ${result.path}`,
    "─".repeat(6 + result.path.length),
    `LOC: ${result.loc}`,
    "",
  ];

  if (result.exports.length > 0) {
    lines.push(
      `Exports (${result.exports.length})`,
      ...result.exports.map(
        (fileExport) =>
          `  ${fileExport.type.padEnd(12)} ${fileExport.name} (${fileExport.loc} LOC)${signatureSuffix(fileExport.typeFacts?.signature)}`,
      ),
      "",
    );
  }

  if (result.imports.length > 0) {
    lines.push(
      `Imports (${result.imports.length})`,
      ...result.imports.map((fileImport) => {
        const typeTag = fileImport.isTypeOnly ? " [type]" : "";
        return `  ${fileImport.from} → {${fileImport.symbols.join(", ")}}${typeTag}`;
      }),
      "",
    );
  }

  if (result.dependents.length > 0) {
    lines.push(
      `Dependents (${result.dependents.length})`,
      ...result.dependents.map((dependent) => {
        const typeTag = dependent.isTypeOnly ? " [type]" : "";
        return `  ${dependent.path} → {${dependent.symbols.join(", ")}}${typeTag}`;
      }),
      "",
    );
  }

  lines.push(
    "Metrics",
    `  PageRank:    ${result.metrics.pageRank}`,
    `  Betweenness: ${result.metrics.betweenness}`,
    `  Fan-in:      ${result.metrics.fanIn}`,
    `  Fan-out:     ${result.metrics.fanOut}`,
    `  Coupling:    ${result.metrics.coupling}`,
    `  Tension:     ${result.metrics.tension}`,
    `  Bridge:      ${result.metrics.isBridge ? "yes" : "no"}`,
    `  Churn:       ${result.metrics.churn}`,
    `  Complexity:  ${result.metrics.cyclomaticComplexity}`,
    `  Blast radius: ${result.metrics.blastRadius}`,
    `  Has tests:   ${result.metrics.hasTests ? `yes (${result.metrics.testFile})` : "no"}`,
  );

  if (result.metrics.deadExports.length > 0) {
    lines.push(`  Dead exports: ${result.metrics.deadExports.join(", ")}`);
  }

  return text(lines);
}

/**
 * Format a search operation result for human CLI output.
 */
export function formatSearchText(result: SearchResult): string {
  if (result.results.length === 0) {
    const lines = [`No results for "${result.query}"`];
    if (result.suggestions && result.suggestions.length > 0) {
      lines.push("", `Did you mean: ${result.suggestions.join(", ")}?`);
    }
    return text(lines);
  }

  const lines = [
    `Search: "${result.query}" (${result.results.length} results)`,
    "─".repeat(40),
  ];
  for (const searchResult of result.results) {
    lines.push(`${searchResult.file} (score: ${searchResult.score.toFixed(2)})`);
    lines.push(
      ...searchResult.symbols.map(
        (symbol) => `  ${symbol.type.padEnd(12)} ${symbol.name} (${symbol.loc} LOC, relevance: ${symbol.relevance.toFixed(2)})`,
      ),
    );
  }
  return text(lines);
}

/**
 * Format a changes operation result for human CLI output.
 */
export function formatChangesText(result: ChangesResult | ChangesError): string {
  if ("error" in result) return result.error;

  const lines = [
    `Changes (${result.scope})`,
    "─".repeat(20),
  ];

  if (result.changedFiles.length === 0) {
    lines.push("No changes detected.");
    return text(lines);
  }

  lines.push(
    `Changed files (${result.changedFiles.length}):`,
    ...result.changedFiles.map((file) => `  ${file}`),
  );

  if (result.changedSymbols.length > 0) {
    lines.push(
      "",
      "Changed symbols:",
      ...result.changedSymbols.map((changedSymbol) => `  ${changedSymbol.file}: ${changedSymbol.symbols.join(", ")}`),
    );
  }

  if (result.affectedFiles.length > 0) {
    lines.push(
      "",
      `Affected files (${result.affectedFiles.length}):`,
      ...result.affectedFiles.map((file) => `  ${file}`),
    );
  }

  if (result.fileRiskMetrics.length > 0) {
    lines.push(
      "",
      "Risk Metrics",
      `${"File".padEnd(50)} ${"Blast".padStart(8)} ${"Cmplx".padStart(8)} ${"Churn".padStart(8)}`,
      `${"─".repeat(50)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)}`,
      ...result.fileRiskMetrics.map(
        (metric) =>
          `${metric.file.padEnd(50)} ${String(metric.blastRadius).padStart(8)} ${metric.complexity.toFixed(1).padStart(8)} ${String(metric.churn).padStart(8)}`,
      ),
    );
  }

  return text(lines);
}

/**
 * Format a dependents operation result for human CLI output.
 */
export function formatDependentsText(result: DependentsResult | DependentsError): string {
  if ("error" in result) return result.error;

  const lines = [
    `Dependents: ${result.file}`,
    "─".repeat(13 + result.file.length),
    `Risk level: ${result.riskLevel}`,
    `Total affected: ${result.totalAffected}`,
    "",
  ];

  if (result.directDependents.length > 0) {
    lines.push(
      `Direct dependents (${result.directDependents.length}):`,
      ...result.directDependents.map((dependent) => `  ${dependent.path} → {${dependent.symbols.join(", ")}}`),
      "",
    );
  }

  if (result.transitiveDependents.length > 0) {
    lines.push(
      `Transitive dependents (${result.transitiveDependents.length}):`,
      ...result.transitiveDependents.map(
        (dependent) => `  ${dependent.path} (depth ${dependent.depth}, via ${dependent.throughPath.join(" → ")})`,
      ),
    );
  }

  return text(lines);
}

/**
 * Format a module-structure operation result for human CLI output.
 */
export function formatModuleStructureText(result: ModuleStructureResult): string {
  const lines = [
    "Module Structure",
    "────────────────",
    `${"Path".padEnd(30)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Cohesion".padStart(10)} ${"EscVel".padStart(8)}`,
    `${"─".repeat(30)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(8)}`,
    ...result.modules.map(
      (module) =>
        `${module.path.padEnd(30)} ${String(module.files).padStart(6)} ${String(module.loc).padStart(8)} ${module.cohesion.toFixed(2).padStart(10)} ${module.escapeVelocity.toFixed(2).padStart(8)}`,
    ),
  ];

  if (result.crossModuleDeps.length > 0) {
    lines.push(
      "",
      `Cross-Module Dependencies (${result.crossModuleDeps.length}):`,
      ...result.crossModuleDeps.slice(0, 20).map((dependency) => `  ${dependency.from} → ${dependency.to} (weight: ${dependency.weight})`),
    );
  }

  if (result.circularDeps.length > 0) {
    lines.push(
      "",
      `Circular Dependencies (${result.circularDeps.length}):`,
      ...result.circularDeps.map((cycle) => `  [${cycle.severity}] ${cycle.cycle.map((path) => path.join(" → ")).join("; ")}`),
    );
  }

  return text(lines);
}

/**
 * Format a forces operation result for human CLI output.
 */
export function formatForcesText(result: ForcesResult): string {
  const lines = [
    "Force Analysis",
    "──────────────",
    result.summary,
    "",
    "Module Cohesion:",
    ...result.moduleCohesion.map((module) => `  ${module.path.padEnd(30)} ${module.verdict.padEnd(14)} cohesion: ${module.cohesion.toFixed(2)}`),
  ];

  if (result.tensionFiles.length > 0) {
    lines.push("", `Tension Files (${result.tensionFiles.length}):`);
    for (const tensionFile of result.tensionFiles) {
      lines.push(`  ${tensionFile.file} (tension: ${tensionFile.tension.toFixed(2)})`);
      lines.push(
        ...tensionFile.pulledBy.map(
          (pull) => `    ← ${pull.module} (strength: ${pull.strength.toFixed(2)}, symbols: ${pull.symbols.join(", ")})`,
        ),
      );
    }
  }

  if (result.bridgeFiles.length > 0) {
    lines.push(
      "",
      `Bridge Files (${result.bridgeFiles.length}):`,
      ...result.bridgeFiles.map((bridge) => `  ${bridge.file} (betweenness: ${bridge.betweenness.toFixed(3)}, role: ${bridge.role})`),
    );
  }

  if (result.extractionCandidates.length > 0) {
    lines.push("", `Extraction Candidates (${result.extractionCandidates.length}):`);
    for (const extraction of result.extractionCandidates) {
      lines.push(`  ${extraction.target} (escape velocity: ${extraction.escapeVelocity.toFixed(2)})`);
      lines.push(`    ${extraction.recommendation}`);
    }
  }

  if (result.shallowModules.length > 0) {
    lines.push("", `Shallow Modules (${result.shallowModules.length}):`);
    for (const module of result.shallowModules) {
      lines.push(`  ${module.module} (${module.exports} exports, cohesion: ${module.cohesion.toFixed(2)})`);
      lines.push(`    ${module.evidence}`);
    }
  }

  if (result.deepModules.length > 0) {
    lines.push("", `Deep Modules (${result.deepModules.length}):`);
    for (const module of result.deepModules) {
      lines.push(`  ${module.module} (${module.exports} exports, depended by: ${module.dependedByModules})`);
      lines.push(`    ${module.evidence}`);
    }
  }

  if (result.seamCandidates.length > 0) {
    lines.push("", `Seam Candidates (${result.seamCandidates.length}):`);
    for (const seam of result.seamCandidates) {
      lines.push(`  ${seam.target} [${seam.scope}] (dependents: ${seam.dependentModules}, fan-in: ${seam.fanIn})`);
      lines.push(`    ${seam.evidence}`);
    }
  }

  if (result.localityRisks.length > 0) {
    lines.push("", `Locality Risks (${result.localityRisks.length}):`);
    for (const risk of result.localityRisks) {
      lines.push(`  ${risk.file} [${risk.kind}] (blast radius: ${risk.blastRadius}, tension: ${risk.tension.toFixed(2)})`);
      lines.push(`    ${risk.evidence}`);
    }
  }

  return text(lines);
}

/**
 * Format a dead-exports operation result for human CLI output.
 */
export function formatDeadExportsText(result: DeadExportsResult): string {
  const lines = [
    "Dead Exports",
    "────────────",
    result.summary,
  ];

  if (result.files.length > 0) {
    lines.push("");
    for (const file of result.files) {
      lines.push(`${file.path} (${file.deadExports.length}/${file.totalExports} unused, ${file.confidence} confidence):`);
      if (file.packageEntrypointReason) lines.push(`  public API: ${file.packageEntrypointReason}`);
      lines.push(...file.deadExports.map((deadExport) => `  - ${deadExport}`));
    }
  }

  return text(lines);
}

/**
 * Format an opportunities operation result for human CLI output.
 */
export function formatOpportunitiesText(result: OpportunitiesResult): string {
  const lines = [
    `Opportunities (${result.opportunities.length} of ${result.totalOpportunities})`,
    "─".repeat(40),
    result.summary,
  ];

  for (const opportunity of result.opportunities) {
    lines.push(
      "",
      `#${opportunity.rank} [${opportunity.priority}] ${opportunity.title}`,
      `  Target:     ${opportunity.target}`,
      `  Kind:       ${opportunity.kind}`,
      `  Score:      ${opportunity.score.toFixed(1)} (${opportunity.confidence} confidence)`,
      `  Why:        ${opportunity.why}`,
      `  Evidence:   ${opportunity.evidence.join("; ")}`,
      `  Next:       ${opportunity.suggestedCommands[0] ?? "Review target manually"}`,
    );
  }

  return text(lines);
}

/**
 * Format a groups operation result for human CLI output.
 */
export function formatGroupsText(result: GroupsResult): string {
  return text([
    "Groups",
    "──────",
    `${"#".padStart(3)} ${"Name".padEnd(20)} ${"Files".padStart(6)} ${"LOC".padStart(8)} ${"Importance".padStart(12)} ${"Coupling".padStart(10)}`,
    `${"─".repeat(3)} ${"─".repeat(20)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(10)}`,
    ...result.groups.map(
      (group) =>
        `${String(group.rank).padStart(3)} ${group.name.padEnd(20)} ${String(group.files).padStart(6)} ${String(group.loc).padStart(8)} ${group.importance.padStart(12)} ${String(group.coupling.total).padStart(10)}`,
    ),
  ]);
}

/**
 * Format a symbol-context operation result for human CLI output.
 */
export function formatSymbolContextText(result: SymbolContextResult | SymbolContextError): string {
  if ("error" in result) return result.error;

  const lines = [
    `Symbol: ${result.name}`,
    "─".repeat(8 + result.name.length),
    `File:       ${result.file}`,
    `Type:       ${result.type}`,
    `LOC:        ${result.loc}`,
    `Default:    ${result.isDefault ? "yes" : "no"}`,
    `Complexity: ${result.complexity}`,
    ...(result.typeFacts ? [
      `Signature:  ${result.typeFacts.signature}`,
      `Consumes:   ${result.typeFacts.consumes.length > 0 ? result.typeFacts.consumes.join(", ") : "none"}`,
      `Produces:   ${result.typeFacts.produces.length > 0 ? result.typeFacts.produces.join(", ") : "none"}`,
    ] : []),
    `Fan-in:     ${result.fanIn}`,
    `Fan-out:    ${result.fanOut}`,
    `PageRank:   ${result.pageRank}`,
    `Betweenness:${result.betweenness}`,
  ];

  if (result.callers.length > 0) {
    lines.push(
      "",
      `Callers (${result.callers.length}):`,
      ...result.callers.map((caller) => `  ${caller.symbol} (${caller.file}) [${caller.confidence}]`),
    );
  }

  if (result.callees.length > 0) {
    lines.push(
      "",
      `Callees (${result.callees.length}):`,
      ...result.callees.map((callee) => `  ${callee.symbol} (${callee.file}) [${callee.confidence}]`),
    );
  }

  return text(lines);
}

/**
 * Format an impact operation result for human CLI output.
 */
export function formatImpactText(result: ImpactResult): string {
  const lines = [
    `Impact Analysis: ${result.symbol}`,
    "─".repeat(18 + result.symbol.length),
    `Total affected: ${result.totalAffected}`,
  ];

  if (result.levels.length > 0) {
    lines.push("");
    for (const level of result.levels) {
      lines.push(`Depth ${level.depth} — ${level.risk} (${level.affected.length}):`);
      lines.push(...level.affected.map((affected) => `  ${affected.symbol} (${affected.file}) [${affected.confidence}]`));
    }
  }

  return text(lines);
}

/**
 * Format a rename operation result for human CLI output.
 */
export function formatRenameText(result: RenameResult): string {
  const lines = [
    `Rename: ${result.oldName} → ${result.newName}${result.dryRun ? " (dry run)" : ""}`,
    "─".repeat(40),
  ];

  if (result.references.length === 0) {
    lines.push(`No references found for "${result.oldName}"`);
    return text(lines);
  }

  lines.push(
    `References (${result.references.length}):`,
    ...result.references.map((reference) => `  ${reference.file} [${reference.confidence}] ${reference.symbol}`),
  );
  return text(lines);
}

/**
 * Format a processes operation result for human CLI output.
 */
export function formatProcessesText(result: ProcessesResult): string {
  const lines = [
    `Processes (${result.processes.length} of ${result.totalProcesses})`,
    "─".repeat(30),
  ];

  if (result.processes.length === 0) {
    lines.push("No processes found.");
    return text(lines);
  }

  for (const process of result.processes) {
    lines.push(
      "",
      `${process.name} (depth: ${process.depth}, modules: ${process.modulesTouched.join(", ")})`,
      `  Entry: ${process.entryPoint.file}::${process.entryPoint.symbol}`,
      ...process.steps.map((step) => `  ${String(step.step).padStart(3)}. ${step.file}::${step.symbol}`),
    );
  }

  return text(lines);
}

/**
 * Format a clusters operation result for human CLI output.
 */
export function formatClustersText(result: ClustersResult): string {
  const lines = [
    `Clusters (${result.clusters.length} of ${result.totalClusters})`,
    "─".repeat(30),
  ];

  for (const cluster of result.clusters) {
    lines.push(
      "",
      `${cluster.name} (${cluster.fileCount} files, cohesion: ${cluster.cohesion.toFixed(2)})`,
      ...cluster.files.map((file) => `  ${file}`),
    );
  }

  return text(lines);
}
