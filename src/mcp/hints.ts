const TOOL_HINTS: Record<string, string[]> = {
  codebase_overview: [
    "Use file_context to drill into a specific file",
    "Use find_hotspots with metric='coupling' to find tightly coupled files",
    "Use get_module_structure to see cross-module dependencies",
    "Use analyze_forces to check module cohesion and tension",
  ],
  file_context: [
    "Use get_dependents to see blast radius if this file changes",
    "Use symbol_context to inspect a specific function or class",
    "Use find_dead_exports to check for unused exports in this file's module",
    "Use analyze_forces to check if this file is under tension",
  ],
  get_dependents: [
    "Use file_context on high-impact dependents to understand coupling",
    "Use find_hotspots with metric='blast_radius' for system-wide view",
    "Use get_module_structure to see if dependencies cross module boundaries",
  ],
  find_hotspots: [
    "Use file_context on top hotspots to understand why they score high",
    "Use analyze_forces to find structural issues behind hotspots",
    "Use get_dependents on hotspot files to assess change risk",
  ],
  get_module_structure: [
    "Use analyze_forces to find junk-drawer modules with low cohesion",
    "Use find_hotspots with metric='escape_velocity' to find extractable modules",
    "Use file_context on cross-module boundary files",
  ],
  analyze_forces: [
    "Use file_context on tension files to understand what pulls them",
    "Use get_module_structure on junk-drawer modules to plan restructuring",
    "Use find_dead_exports on low-cohesion modules to find cleanup opportunities",
  ],
  find_dead_exports: [
    "Use file_context on files with dead exports to check if they're truly unused",
    "Use codebase_overview to see overall API surface reduction opportunity",
  ],
  get_groups: [
    "Use get_module_structure for detailed per-module breakdown",
    "Use find_hotspots with metric='coupling' to find cross-group coupling",
    "Use analyze_forces to check group-level cohesion",
  ],
  symbol_context: [
    "Use file_context on the file containing this symbol for file-level view",
    "Use get_dependents on the file to assess change blast radius",
    "Use find_hotspots with metric='fan_in' to find other high-traffic symbols",
  ],
  search: [
    "Use file_context on a result file for full dependency and metric details",
    "Use symbol_context on a matched symbol for callers/callees",
    "Refine query: try camelCase names, class names, or module paths",
  ],
  detect_changes: [
    "Use symbol_context on changed symbols to assess impact",
    "Use get_dependents on affected files for full blast radius",
    "Use file_context on changed files for detailed metrics",
  ],
  impact_analysis: [
    "Use file_context on WILL BREAK files to understand coupling",
    "Use rename_symbol to plan safe refactoring of impacted symbols",
    "Use get_module_structure to check if impact crosses module boundaries",
  ],
  rename_symbol: [
    "Use impact_analysis on the symbol first to understand full blast radius",
    "Use file_context on referenced files to check for indirect usages",
    "Use detect_changes after renaming to verify all references updated",
  ],
  get_processes: [
    "Use symbol_context on an entry point symbol for detailed callers/callees",
    "Use file_context on files in the process steps for metrics",
    "Use get_module_structure to see how process crosses module boundaries",
  ],
  get_clusters: [
    "Use file_context on files within a cluster for detailed metrics",
    "Use get_module_structure to compare clusters against directory structure",
    "Use analyze_forces to check if cluster boundaries reveal tension",
  ],
};

export function getHints(toolName: string): string[] {
  return TOOL_HINTS[toolName] ?? [];
}
