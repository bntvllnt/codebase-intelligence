import { getOperationByMcpTool, type OperationName } from "../operations/index.js";

const OPERATION_HINTS: Record<OperationName, string[]> = {
  overview: [
    "Use file_context to drill into a specific file",
    "Use find_hotspots with metric='coupling' to find tightly coupled files",
    "Use get_module_structure to see cross-module dependencies",
    "Use analyze_forces to check module cohesion and tension",
  ],
  fileContext: [
    "Use get_dependents to see blast radius if this file changes",
    "Use symbol_context to inspect a specific function or class",
    "Use find_dead_exports to check for unused exports in this file's module",
    "Use analyze_forces to check if this file is under tension",
  ],
  dependents: [
    "Use file_context on high-impact dependents to understand coupling",
    "Use find_hotspots with metric='blast_radius' for system-wide view",
    "Use get_module_structure to see if dependencies cross module boundaries",
  ],
  hotspots: [
    "Use file_context on top hotspots to understand why they score high",
    "Use analyze_forces to find structural issues behind hotspots",
    "Use get_dependents on hotspot files to assess change risk",
  ],
  moduleStructure: [
    "Use analyze_forces to find junk-drawer modules with low cohesion",
    "Use find_hotspots with metric='escape_velocity' to find extractable modules",
    "Use file_context on cross-module boundary files",
  ],
  forces: [
    "Use file_context on tension files to understand what pulls them",
    "Use get_module_structure on junk-drawer modules to plan restructuring",
    "Use find_dead_exports on low-cohesion modules to find cleanup opportunities",
  ],
  deadExports: [
    "Use file_context on files with dead exports to check if they're truly unused",
    "Use codebase_overview to see overall API surface reduction opportunity",
  ],
  opportunities: [
    "Use file_context on the top opportunity target before editing",
    "Use get_dependents for stabilize-hotspot or add-tests opportunities",
    "Use analyze_forces for extract-seam, move-file, and split-module opportunities",
  ],
  duplication: [
    "Use trace with a family id to inspect token evidence",
    "Use file_context on duplicated members before refactoring",
    "Use --skip-local when you only care about cross-file duplication",
  ],
  groups: [
    "Use get_module_structure for detailed per-module breakdown",
    "Use find_hotspots with metric='coupling' to find cross-group coupling",
    "Use analyze_forces to check group-level cohesion",
  ],
  symbolContext: [
    "Use file_context on the file containing this symbol for file-level view",
    "Use get_dependents on the file to assess change blast radius",
    "Use find_hotspots with metric='fan_in' to find other high-traffic symbols",
  ],
  search: [
    "Use file_context on a result file for full dependency and metric details",
    "Use symbol_context on a matched symbol for callers/callees",
    "Refine query: try camelCase names, class names, or module paths",
  ],
  changes: [
    "Use symbol_context on changed symbols to assess impact",
    "Use get_dependents on affected files for full blast radius",
    "Use file_context on changed files for detailed metrics",
  ],
  impact: [
    "Use file_context on WILL BREAK files to understand coupling",
    "Use rename_symbol to plan safe refactoring of impacted symbols",
    "Use get_module_structure to check if impact crosses module boundaries",
  ],
  rename: [
    "Use impact_analysis on the symbol first to understand full blast radius",
    "Use file_context on referenced files to check for indirect usages",
    "Use detect_changes after renaming to verify all references updated",
  ],
  processes: [
    "Use symbol_context on an entry point symbol for detailed callers/callees",
    "Use file_context on files in the process steps for metrics",
    "Use get_module_structure to see how process crosses module boundaries",
  ],
  codebaseMap: [
    "Use get_context_pack with the same focus when preparing an LLM prompt",
    "Use get_scope_graph when you only need file/scope nodes and edges",
    "Use symbol_context or file_context on top-ranked context entries before editing",
  ],
  contentDrift: [
    "Use file_context on drift findings before moving or renaming files",
    "Use map with the same focus to inspect neighboring files and symbols",
    "Create a drift baseline before using drift findings as a CI gate",
  ],
  highways: [
    "Use impact_analysis on the proposed canonical node before editing",
    "Use symbol_context on bypass route entry points to inspect call chains",
    "Use get_processes to compare raw execution flows against highway findings",
  ],
  clusters: [
    "Use file_context on files within a cluster for detailed metrics",
    "Use get_module_structure to compare clusters against directory structure",
    "Use analyze_forces to check if cluster boundaries reveal tension",
  ],
};

export function getHintsForOperation(operationName: OperationName): string[] {
  return OPERATION_HINTS[operationName];
}

export function getHints(toolName: string): string[] {
  const operation = getOperationByMcpTool(toolName);
  return operation ? getHintsForOperation(operation.name) : [];
}
