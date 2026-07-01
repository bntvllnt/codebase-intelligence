import { z } from "zod";
import {
  CHANGE_SCOPES,
  HOTSPOT_METRICS,
  computeChanges,
  computeClusters,
  computeDeadExports,
  computeDependents,
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
import type { CodebaseGraph } from "../types/index.js";

export const operationNames = [
  "overview",
  "fileContext",
  "dependents",
  "hotspots",
  "moduleStructure",
  "forces",
  "deadExports",
  "opportunities",
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
  inputSchema: z.ZodType<TInput>;
  run: (graph: CodebaseGraph, input: TInput, context: OperationContext) => TResult;
}

export type OperationRunResult<TResult> =
  | { ok: true; data: TResult }
  | { ok: false; error: string; data?: TResult };

const overviewInputSchema = z.object({
  depth: z.number().int().positive().optional(),
}).strict();
const fileContextInputSchema = z.object({ filePath: z.string().min(1) }).strict();
const dependentsInputSchema = z.object({
  filePath: z.string().min(1),
  depth: z.number().int().positive().optional(),
}).strict();
const hotspotsInputSchema = z.object({
  metric: z.enum(HOTSPOT_METRICS),
  limit: z.number().int().positive().optional(),
}).strict();
const moduleStructureInputSchema = z.object({
  depth: z.number().int().positive().optional(),
}).strict();
const forcesInputSchema = z.object({
  cohesionThreshold: z.number().optional(),
  tensionThreshold: z.number().optional(),
  escapeThreshold: z.number().optional(),
}).strict();
const deadExportsInputSchema = z.object({
  module: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
}).strict();
const opportunitiesInputSchema = z.object({
  limit: z.number().int().positive().optional(),
}).strict();
const emptyInputSchema = z.object({}).strict();
const symbolContextInputSchema = z.object({ name: z.string().min(1) }).strict();
const searchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
}).strict();
const changesInputSchema = z.object({
  scope: z.enum(CHANGE_SCOPES).optional(),
}).strict();
const impactInputSchema = z.object({ symbol: z.string().min(1) }).strict();
const renameInputSchema = z.object({
  oldName: z.string().min(1),
  newName: z.string().min(1),
  dryRun: z.boolean().optional(),
}).strict();
const processesInputSchema = z.object({
  entryPoint: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
}).strict();
const clustersInputSchema = z.object({
  minFiles: z.number().int().positive().optional(),
}).strict();

type OverviewInput = z.infer<typeof overviewInputSchema>;
type FileContextInput = z.infer<typeof fileContextInputSchema>;
type DependentsInput = z.infer<typeof dependentsInputSchema>;
type HotspotsInput = z.infer<typeof hotspotsInputSchema>;
type ModuleStructureInput = z.infer<typeof moduleStructureInputSchema>;
type ForcesInput = z.infer<typeof forcesInputSchema>;
type DeadExportsInput = z.infer<typeof deadExportsInputSchema>;
type OpportunitiesInput = z.infer<typeof opportunitiesInputSchema>;
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
    description: "High-level codebase snapshot: files, functions, modules, dependencies.",
    inputSchema: overviewInputSchema,
    run: (graph: CodebaseGraph, _input: OverviewInput) => computeOverview(graph),
  } satisfies Operation<OverviewInput, ReturnType<typeof computeOverview>>,
  fileContext: {
    name: "fileContext",
    cliCommand: "file",
    mcpTool: "file_context",
    description: "Detailed file context: exports, imports, dependents, and metrics.",
    inputSchema: fileContextInputSchema,
    run: (graph: CodebaseGraph, input: FileContextInput) => computeFileContext(graph, input.filePath),
  } satisfies Operation<FileContextInput, ReturnType<typeof computeFileContext>>,
  dependents: {
    name: "dependents",
    cliCommand: "dependents",
    mcpTool: "get_dependents",
    description: "File-level blast radius with direct and transitive dependents.",
    inputSchema: dependentsInputSchema,
    run: (graph: CodebaseGraph, input: DependentsInput) => computeDependents(graph, input.filePath, input.depth),
  } satisfies Operation<DependentsInput, ReturnType<typeof computeDependents>>,
  hotspots: {
    name: "hotspots",
    cliCommand: "hotspots",
    mcpTool: "find_hotspots",
    description: "Rank files or modules by architectural risk metric.",
    inputSchema: hotspotsInputSchema,
    run: (graph: CodebaseGraph, input: HotspotsInput) => computeHotspots(graph, input.metric, input.limit),
  } satisfies Operation<HotspotsInput, ReturnType<typeof computeHotspots>>,
  moduleStructure: {
    name: "moduleStructure",
    cliCommand: "modules",
    mcpTool: "get_module_structure",
    description: "Module structure with cohesion, cross-module dependencies, and circular dependencies.",
    inputSchema: moduleStructureInputSchema,
    run: (graph: CodebaseGraph, _input: ModuleStructureInput) => computeModuleStructure(graph),
  } satisfies Operation<ModuleStructureInput, ReturnType<typeof computeModuleStructure>>,
  forces: {
    name: "forces",
    cliCommand: "forces",
    mcpTool: "analyze_forces",
    description: "Architectural force analysis for tension, bridge files, and extraction candidates.",
    inputSchema: forcesInputSchema,
    run: (graph: CodebaseGraph, input: ForcesInput) =>
      computeForces(graph, input.cohesionThreshold, input.tensionThreshold, input.escapeThreshold),
  } satisfies Operation<ForcesInput, ReturnType<typeof computeForces>>,
  deadExports: {
    name: "deadExports",
    cliCommand: "dead-exports",
    mcpTool: "find_dead_exports",
    description: "Unused exports across the codebase.",
    inputSchema: deadExportsInputSchema,
    run: (graph: CodebaseGraph, input: DeadExportsInput) => computeDeadExports(graph, input.module, input.limit),
  } satisfies Operation<DeadExportsInput, ReturnType<typeof computeDeadExports>>,
  opportunities: {
    name: "opportunities",
    cliCommand: "opportunities",
    mcpTool: "find_opportunities",
    description: "Ranked code quality and refactoring opportunities.",
    inputSchema: opportunitiesInputSchema,
    run: (graph: CodebaseGraph, input: OpportunitiesInput) => computeOpportunities(graph, input.limit),
  } satisfies Operation<OpportunitiesInput, ReturnType<typeof computeOpportunities>>,
  groups: {
    name: "groups",
    cliCommand: "groups",
    mcpTool: "get_groups",
    description: "Top-level directory groups with aggregate metrics.",
    inputSchema: emptyInputSchema,
    run: (graph: CodebaseGraph, _input: EmptyInput) => computeGroups(graph),
  } satisfies Operation<EmptyInput, ReturnType<typeof computeGroups>>,
  symbolContext: {
    name: "symbolContext",
    cliCommand: "symbol",
    mcpTool: "symbol_context",
    description: "Symbol callers, callees, and importance metrics.",
    inputSchema: symbolContextInputSchema,
    run: (graph: CodebaseGraph, input: SymbolContextInput) => computeSymbolContext(graph, input.name),
  } satisfies Operation<SymbolContextInput, ReturnType<typeof computeSymbolContext>>,
  search: {
    name: "search",
    cliCommand: "search",
    mcpTool: "search",
    description: "Keyword search across files and symbols.",
    inputSchema: searchInputSchema,
    run: (graph: CodebaseGraph, input: SearchInput) => computeSearch(graph, input.query, input.limit),
  } satisfies Operation<SearchInput, ReturnType<typeof computeSearch>>,
  changes: {
    name: "changes",
    cliCommand: "changes",
    mcpTool: "detect_changes",
    description: "Git diff analysis with changed files, symbols, and risk metrics.",
    inputSchema: changesInputSchema,
    run: (graph: CodebaseGraph, input: ChangesInput, context: OperationContext) =>
      computeChanges(graph, input.scope, context.rootDir),
  } satisfies Operation<ChangesInput, ReturnType<typeof computeChanges>>,
  impact: {
    name: "impact",
    cliCommand: "impact",
    mcpTool: "impact_analysis",
    description: "Symbol-level blast radius with depth-grouped impact levels.",
    inputSchema: impactInputSchema,
    run: (graph: CodebaseGraph, input: ImpactInput) => impactAnalysis(graph, input.symbol),
  } satisfies Operation<ImpactInput, ReturnType<typeof impactAnalysis>>,
  rename: {
    name: "rename",
    cliCommand: "rename",
    mcpTool: "rename_symbol",
    description: "Read-only rename reference planning for a symbol.",
    inputSchema: renameInputSchema,
    run: (graph: CodebaseGraph, input: RenameInput) =>
      renameSymbol(graph, input.oldName, input.newName, input.dryRun ?? true),
  } satisfies Operation<RenameInput, ReturnType<typeof renameSymbol>>,
  processes: {
    name: "processes",
    cliCommand: "processes",
    mcpTool: "get_processes",
    description: "Execution flows from entry points through the call graph.",
    inputSchema: processesInputSchema,
    run: (graph: CodebaseGraph, input: ProcessesInput) => computeProcesses(graph, input.entryPoint, input.limit),
  } satisfies Operation<ProcessesInput, ReturnType<typeof computeProcesses>>,
  clusters: {
    name: "clusters",
    cliCommand: "clusters",
    mcpTool: "get_clusters",
    description: "Community-detected file clusters.",
    inputSchema: clustersInputSchema,
    run: (graph: CodebaseGraph, input: ClustersInput) => computeClusters(graph, input.minFiles),
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

export function parseOperationInput<TInput extends object>(
  operation: Operation<TInput, unknown>,
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
