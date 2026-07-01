import { z } from "zod";
import {
  CHANGE_SCOPES,
  HOTSPOT_METRICS,
  computeChanges,
  computeClusters,
  computeDeadExports,
  computeDependents,
  computeDuplication,
  computeFileContext,
  computeForces,
  computeGroups,
  computeHotspots,
  computeModuleStructure,
  computeOpportunities,
  computeOverview,
  computeProcesses,
  computeSearch,
  computeSymbolContext,
  impactAnalysis,
  renameSymbol,
} from "../core/index.js";
import { DUPLICATION_MODES } from "../duplication/index.js";
import type { CodebaseGraph } from "../types/index.js";
import {
  formatChangesText,
  formatClustersText,
  formatDeadExportsText,
  formatDependentsText,
  formatDuplicationText,
  formatFileContextText,
  formatForcesText,
  formatGroupsText,
  formatHotspotsText,
  formatImpactText,
  formatModuleStructureText,
  formatOpportunitiesText,
  formatOverviewText,
  formatProcessesText,
  formatRenameText,
  formatSearchText,
  formatSymbolContextText,
} from "./formatters.js";

export const operationNames = [
  "overview",
  "fileContext",
  "dependents",
  "hotspots",
  "moduleStructure",
  "forces",
  "deadExports",
  "opportunities",
  "duplication",
  "groups",
  "symbolContext",
  "search",
  "changes",
  "impact",
  "rename",
  "processes",
  "clusters",
] as const;

export type OperationName = typeof operationNames[number];

export interface OperationContext {
  rootDir?: string;
}

export interface Operation<TInput extends object, TResult> {
  name: OperationName;
  cliCommand: string;
  mcpTool: string;
  description: string;
  inputShape: z.ZodRawShape;
  inputSchema: z.ZodType<TInput>;
  run: (graph: CodebaseGraph, input: TInput, context: OperationContext) => TResult;
  formatText: (result: TResult, input: TInput) => string;
}

export type OperationRunResult<TResult> =
  | { ok: true; data: TResult }
  | { ok: false; error: string; data?: TResult };

const overviewInputShape = {
  depth: z.number().int().positive().optional().describe("Module depth (default: 1)"),
} satisfies z.ZodRawShape;
const overviewInputSchema = z.object(overviewInputShape).strict();
const fileContextInputShape = {
  filePath: z.string().min(1).describe("Relative path to the file"),
} satisfies z.ZodRawShape;
const fileContextInputSchema = z.object(fileContextInputShape).strict();
const dependentsInputShape = {
  filePath: z.string().min(1).describe("Relative path to the file"),
  depth: z.number().int().positive().optional().describe("Max traversal depth (default: 2)"),
} satisfies z.ZodRawShape;
const dependentsInputSchema = z.object(dependentsInputShape).strict();
const hotspotsInputShape = {
  metric: z.enum(HOTSPOT_METRICS).describe("Metric to rank by"),
  limit: z.number().int().positive().optional().describe("Number of results (default: 10)"),
} satisfies z.ZodRawShape;
const hotspotsInputSchema = z.object(hotspotsInputShape).strict();
const moduleStructureInputShape = {
  depth: z.number().int().positive().optional().describe("Module depth (default: 2)"),
} satisfies z.ZodRawShape;
const moduleStructureInputSchema = z.object(moduleStructureInputShape).strict();
const forcesInputShape = {
  cohesionThreshold: z.number().optional().describe("Min cohesion to be 'COHESIVE' (default: 0.6)"),
  tensionThreshold: z.number().optional().describe("Min tension to flag (default: 0.3)"),
  escapeThreshold: z.number().optional().describe("Min escape velocity to flag (default: 0.5)"),
} satisfies z.ZodRawShape;
const forcesInputSchema = z.object(forcesInputShape).strict();
const deadExportsInputShape = {
  module: z.string().min(1).optional().describe("Filter by module path (default: all modules)"),
  limit: z.number().int().positive().optional().describe("Max results (default: 20)"),
} satisfies z.ZodRawShape;
const deadExportsInputSchema = z.object(deadExportsInputShape).strict();
const opportunitiesInputShape = {
  limit: z.number().int().positive().optional().describe("Max opportunities (default: 20)"),
} satisfies z.ZodRawShape;
const opportunitiesInputSchema = z.object(opportunitiesInputShape).strict();
const duplicationInputShape = {
  mode: z.enum(DUPLICATION_MODES).optional().describe("Clone mode: strict, mild, or weak (default: mild)"),
  minTokens: z.number().int().positive().optional().describe("Minimum function body tokens to consider (default: 30)"),
  skipLocal: z.boolean().optional().describe("Ignore duplicate families confined to one file"),
  trace: z.string().min(1).optional().describe("Return token evidence for a duplicate family id"),
} satisfies z.ZodRawShape;
const duplicationInputSchema = z.object(duplicationInputShape).strict();
const emptyInputShape = {} satisfies z.ZodRawShape;
const emptyInputSchema = z.object(emptyInputShape).strict();
const symbolContextInputShape = {
  name: z.string().min(1).describe("Symbol name (e.g., 'AuthService', 'getUserById')"),
} satisfies z.ZodRawShape;
const symbolContextInputSchema = z.object(symbolContextInputShape).strict();
const searchInputShape = {
  query: z.string().min(1).describe("Search query (supports camelCase, snake_case splitting)"),
  limit: z.number().int().positive().optional().describe("Max results (default: 20)"),
} satisfies z.ZodRawShape;
const searchInputSchema = z.object(searchInputShape).strict();
const changesInputShape = {
  scope: z.enum(CHANGE_SCOPES).optional().describe("Git diff scope (default: all)"),
} satisfies z.ZodRawShape;
const changesInputSchema = z.object(changesInputShape).strict();
const impactInputShape = {
  symbol: z.string().min(1).describe("Symbol name or qualified name (e.g., 'getUserById' or 'UserService.getUserById')"),
} satisfies z.ZodRawShape;
const impactInputSchema = z.object(impactInputShape).strict();
const renameInputShape = {
  oldName: z.string().min(1).describe("Current symbol name"),
  newName: z.string().min(1).describe("New symbol name"),
  dryRun: z.boolean().optional().describe("If true, only report references without renaming (default: true)"),
} satisfies z.ZodRawShape;
const renameInputSchema = z.object(renameInputShape).strict();
const processesInputShape = {
  entryPoint: z.string().min(1).optional().describe("Filter by entry point symbol name"),
  limit: z.number().int().positive().optional().describe("Max processes to return (default: all)"),
} satisfies z.ZodRawShape;
const processesInputSchema = z.object(processesInputShape).strict();
const clustersInputShape = {
  minFiles: z.number().int().positive().optional().describe("Filter clusters with at least N files (default: 0)"),
} satisfies z.ZodRawShape;
const clustersInputSchema = z.object(clustersInputShape).strict();

type OverviewInput = z.infer<typeof overviewInputSchema>;
type FileContextInput = z.infer<typeof fileContextInputSchema>;
type DependentsInput = z.infer<typeof dependentsInputSchema>;
type HotspotsInput = z.infer<typeof hotspotsInputSchema>;
type ModuleStructureInput = z.infer<typeof moduleStructureInputSchema>;
type ForcesInput = z.infer<typeof forcesInputSchema>;
type DeadExportsInput = z.infer<typeof deadExportsInputSchema>;
type OpportunitiesInput = z.infer<typeof opportunitiesInputSchema>;
type DuplicationInput = z.infer<typeof duplicationInputSchema>;
type EmptyInput = z.infer<typeof emptyInputSchema>;
type SymbolContextInput = z.infer<typeof symbolContextInputSchema>;
type SearchInput = z.infer<typeof searchInputSchema>;
type ChangesInput = z.infer<typeof changesInputSchema>;
type ImpactInput = z.infer<typeof impactInputSchema>;
type RenameInput = z.infer<typeof renameInputSchema>;
type ProcessesInput = z.infer<typeof processesInputSchema>;
type ClustersInput = z.infer<typeof clustersInputSchema>;

export const operations = {
  overview: {
    name: "overview",
    cliCommand: "overview",
    mcpTool: "codebase_overview",
    description: "Get a high-level overview of the codebase: total files, modules, top-depended files, and key metrics. Use when: first exploring a codebase, 'what does this project look like'. Not for: module details (use get_module_structure) or data flow (use analyze_forces)",
    inputShape: overviewInputShape,
    inputSchema: overviewInputSchema,
    run: (graph: CodebaseGraph, _input: OverviewInput) => computeOverview(graph),
    formatText: formatOverviewText,
  } satisfies Operation<OverviewInput, ReturnType<typeof computeOverview>>,
  fileContext: {
    name: "fileContext",
    cliCommand: "file",
    mcpTool: "file_context",
    description: "Get detailed context for a specific file: exports, imports, dependents, and all metrics. Use when: 'tell me about this file', understanding a file before modifying it. Not for: symbol-level detail (use symbol_context)",
    inputShape: fileContextInputShape,
    inputSchema: fileContextInputSchema,
    run: (graph: CodebaseGraph, input: FileContextInput) => computeFileContext(graph, input.filePath),
    formatText: formatFileContextText,
  } satisfies Operation<FileContextInput, ReturnType<typeof computeFileContext>>,
  dependents: {
    name: "dependents",
    cliCommand: "dependents",
    mcpTool: "get_dependents",
    description: "Get all files that import a given file, with transitive dependents. File-level blast radius. Use when: 'what breaks if I change this file'. Not for: symbol-level impact (use impact_analysis)",
    inputShape: dependentsInputShape,
    inputSchema: dependentsInputSchema,
    run: (graph: CodebaseGraph, input: DependentsInput) => computeDependents(graph, input.filePath, input.depth),
    formatText: formatDependentsText,
  } satisfies Operation<DependentsInput, ReturnType<typeof computeDependents>>,
  hotspots: {
    name: "hotspots",
    cliCommand: "hotspots",
    mcpTool: "find_hotspots",
    description: "Rank files by any metric: coupling, pagerank, fan_in, fan_out, betweenness, tension, escape_velocity, churn, complexity, blast_radius, coverage. Use when: 'what are the riskiest files', 'which files need tests', 'most complex files'. Not for: module-level analysis (use get_module_structure)",
    inputShape: hotspotsInputShape,
    inputSchema: hotspotsInputSchema,
    run: (graph: CodebaseGraph, input: HotspotsInput) => computeHotspots(graph, input.metric, input.limit),
    formatText: formatHotspotsText,
  } satisfies Operation<HotspotsInput, ReturnType<typeof computeHotspots>>,
  moduleStructure: {
    name: "moduleStructure",
    cliCommand: "modules",
    mcpTool: "get_module_structure",
    description: "Get module/directory structure with cross-module dependencies, cohesion scores, and circular deps. Use when: 'how are modules organized', 'what depends on what module'. Not for: emergent clusters (use get_clusters) or file-level metrics (use find_hotspots)",
    inputShape: moduleStructureInputShape,
    inputSchema: moduleStructureInputSchema,
    run: (graph: CodebaseGraph, _input: ModuleStructureInput) => computeModuleStructure(graph),
    formatText: formatModuleStructureText,
  } satisfies Operation<ModuleStructureInput, ReturnType<typeof computeModuleStructure>>,
  forces: {
    name: "forces",
    cliCommand: "forces",
    mcpTool: "analyze_forces",
    description: "Analyze module health: find misplaced files (tension), bridge files connecting otherwise-disconnected modules, and extraction candidates. Use when: 'what is architecturally wrong', 'which modules are coupled', 'what files should be moved'. Not for: file-level metrics (use find_hotspots)",
    inputShape: forcesInputShape,
    inputSchema: forcesInputSchema,
    run: (graph: CodebaseGraph, input: ForcesInput) =>
      computeForces(graph, input.cohesionThreshold, input.tensionThreshold, input.escapeThreshold),
    formatText: formatForcesText,
  } satisfies Operation<ForcesInput, ReturnType<typeof computeForces>>,
  deadExports: {
    name: "deadExports",
    cliCommand: "dead-exports",
    mcpTool: "find_dead_exports",
    description: "Find unused exports across the codebase - exports that no other file imports. Use when: cleaning up dead code, reducing API surface. Not for: finding used exports (use file_context)",
    inputShape: deadExportsInputShape,
    inputSchema: deadExportsInputSchema,
    run: (graph: CodebaseGraph, input: DeadExportsInput) => computeDeadExports(graph, input.module, input.limit),
    formatText: formatDeadExportsText,
  } satisfies Operation<DeadExportsInput, ReturnType<typeof computeDeadExports>>,
  opportunities: {
    name: "opportunities",
    cliCommand: "opportunities",
    mcpTool: "find_opportunities",
    description: "Rank code quality and refactoring opportunities with evidence, confidence, and suggested follow-up commands. Use when: 'what should I improve', 'find refactoring opportunities', 'what needs tests'. Not for: raw metrics only (use find_hotspots or analyze_forces)",
    inputShape: opportunitiesInputShape,
    inputSchema: opportunitiesInputSchema,
    run: (graph: CodebaseGraph, input: OpportunitiesInput) => computeOpportunities(graph, input.limit),
    formatText: formatOpportunitiesText,
  } satisfies Operation<OpportunitiesInput, ReturnType<typeof computeOpportunities>>,
  duplication: {
    name: "duplication",
    cliCommand: "duplicates",
    mcpTool: "find_duplicates",
    description: "Detect duplicate function families with strict, mild, or weak clone modes. Use when: finding copy-paste logic, drift between similar functions, or refactor candidates. Not for: unused code (use find_dead_exports) or module-level cohesion (use analyze_forces)",
    inputShape: duplicationInputShape,
    inputSchema: duplicationInputSchema,
    run: (graph: CodebaseGraph, input: DuplicationInput) => computeDuplication(graph, input),
    formatText: formatDuplicationText,
  } satisfies Operation<DuplicationInput, ReturnType<typeof computeDuplication>>,
  groups: {
    name: "groups",
    cliCommand: "groups",
    mcpTool: "get_groups",
    description: "Get top-level directory groups with aggregate metrics: files, LOC, importance (PageRank), coupling. Use when: 'what are the main areas of this codebase', high-level grouping overview. Not for: detailed module metrics (use get_module_structure)",
    inputShape: emptyInputShape,
    inputSchema: emptyInputSchema,
    run: (graph: CodebaseGraph, _input: EmptyInput) => computeGroups(graph),
    formatText: formatGroupsText,
  } satisfies Operation<EmptyInput, ReturnType<typeof computeGroups>>,
  symbolContext: {
    name: "symbolContext",
    cliCommand: "symbol",
    mcpTool: "symbol_context",
    description: "Find all callers and callees of a function, class, or method with importance metrics. Use when: 'who calls X', 'trace this function', 'what depends on this symbol'. Not for: text search (use search) or file-level dependencies (use get_dependents)",
    inputShape: symbolContextInputShape,
    inputSchema: symbolContextInputSchema,
    run: (graph: CodebaseGraph, input: SymbolContextInput) => computeSymbolContext(graph, input.name),
    formatText: formatSymbolContextText,
  } satisfies Operation<SymbolContextInput, ReturnType<typeof computeSymbolContext>>,
  search: {
    name: "search",
    cliCommand: "search",
    mcpTool: "search",
    description: "Search files and symbols by keyword. Returns ranked results with symbol locations. Use when: 'find files related to auth', 'where is getUserById defined'. Not for: structured call graph queries (use symbol_context)",
    inputShape: searchInputShape,
    inputSchema: searchInputSchema,
    run: (graph: CodebaseGraph, input: SearchInput) => computeSearch(graph, input.query, input.limit),
    formatText: formatSearchText,
  } satisfies Operation<SearchInput, ReturnType<typeof computeSearch>>,
  changes: {
    name: "changes",
    cliCommand: "changes",
    mcpTool: "detect_changes",
    description: "Detect changed files from git diff with risk metrics per file. Use when: starting a review, triaging changes, 'what changed'. Not for: symbol-level impact (use impact_analysis)",
    inputShape: changesInputShape,
    inputSchema: changesInputSchema,
    run: (graph: CodebaseGraph, input: ChangesInput, context: OperationContext) =>
      computeChanges(graph, input.scope, context.rootDir),
    formatText: formatChangesText,
  } satisfies Operation<ChangesInput, ReturnType<typeof computeChanges>>,
  impact: {
    name: "impact",
    cliCommand: "impact",
    mcpTool: "impact_analysis",
    description: "Analyze blast radius of changing a specific function or class. Symbol-level, depth-grouped, with risk labels (WILL BREAK / LIKELY / MAY NEED TESTING). Use when: 'what breaks if I change getUserById'. Not for: file-level dependencies (use get_dependents)",
    inputShape: impactInputShape,
    inputSchema: impactInputSchema,
    run: (graph: CodebaseGraph, input: ImpactInput) => impactAnalysis(graph, input.symbol),
    formatText: formatImpactText,
  } satisfies Operation<ImpactInput, ReturnType<typeof impactAnalysis>>,
  rename: {
    name: "rename",
    cliCommand: "rename",
    mcpTool: "rename_symbol",
    description: "Read-only: find all reference locations for a symbol across the codebase, with confidence levels. Does not modify files. Use when: planning a rename, finding all usages. Not for: call graph analysis (use symbol_context)",
    inputShape: renameInputShape,
    inputSchema: renameInputSchema,
    run: (graph: CodebaseGraph, input: RenameInput) =>
      renameSymbol(graph, input.oldName, input.newName, input.dryRun ?? true),
    formatText: formatRenameText,
  } satisfies Operation<RenameInput, ReturnType<typeof renameSymbol>>,
  processes: {
    name: "processes",
    cliCommand: "processes",
    mcpTool: "get_processes",
    description: "Trace execution flows from entry points through the call graph. Returns step-by-step paths showing how requests flow through the codebase. Use when: 'how does this app start', 'trace request flow', 'what are the entry points'. Not for: static file dependencies (use get_dependents)",
    inputShape: processesInputShape,
    inputSchema: processesInputSchema,
    run: (graph: CodebaseGraph, input: ProcessesInput) => computeProcesses(graph, input.entryPoint, input.limit),
    formatText: formatProcessesText,
  } satisfies Operation<ProcessesInput, ReturnType<typeof computeProcesses>>,
  clusters: {
    name: "clusters",
    cliCommand: "clusters",
    mcpTool: "get_clusters",
    description: "Get community-detected clusters of related files using Louvain algorithm. Discovers emergent groupings that may differ from directory structure. Use when: 'what files are related', 'find natural groupings', 'which files change together'. Not for: directory-based modules (use get_module_structure)",
    inputShape: clustersInputShape,
    inputSchema: clustersInputSchema,
    run: (graph: CodebaseGraph, input: ClustersInput) => computeClusters(graph, input.minFiles),
    formatText: formatClustersText,
  } satisfies Operation<ClustersInput, ReturnType<typeof computeClusters>>,
} as const;

export type RegisteredOperation = typeof operations[OperationName];
export type OperationCliCommand = RegisteredOperation["cliCommand"];
export type OperationMcpTool = RegisteredOperation["mcpTool"];

export const operationList: readonly RegisteredOperation[] = operationNames.map((name) => operations[name]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessageForData(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.error === "string") return data.error;
  if (data.notFound === true && typeof data.symbol === "string") return `Symbol not found: ${data.symbol}`;
  if (data.notFound === true) return "Result not found";
  return undefined;
}

function validationErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.join(".");
      return issuePath ? `${issuePath}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function getOperation(name: OperationName): RegisteredOperation {
  return operations[name];
}

export function getOperationByCliCommand(command: string): RegisteredOperation | undefined {
  return operationList.find((operation) => operation.cliCommand === command);
}

export function getOperationByMcpTool(toolName: string): RegisteredOperation | undefined {
  return operationList.find((operation) => operation.mcpTool === toolName);
}

export function parseOperationInput<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  input: unknown,
): OperationRunResult<TInput> {
  const parsed = operation.inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: validationErrorMessage(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export function runOperation<TInput extends object, TResult>(
  operation: Operation<TInput, TResult>,
  graph: CodebaseGraph,
  input: TInput,
  context: OperationContext = {},
): OperationRunResult<TResult> {
  try {
    const data = operation.run(graph, input, context);
    const error = errorMessageForData(data);
    if (error) return { ok: false, error, data };
    return { ok: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
