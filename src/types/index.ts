export type AnalysisMode = "full-program" | "ast-only";
export type CallGraphPrecision = "type-resolved" | "syntax-only";

export interface ParsedFile {
  path: string;
  relativePath: string;
  loc: number;
  exports: ParsedExport[];
  symbols?: ParsedSymbol[];
  imports: ParsedImport[];
  callSites: CallSite[];
  churn: number;
  isTestFile: boolean;
  analysisMode?: AnalysisMode;
  testFile?: string;
}

export interface TypeParameterFact {
  name: string;
  constraint?: string;
  default?: string;
}

export interface ParameterTypeFact {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}

export interface SymbolTypeFacts {
  signature: string;
  parameters: ParameterTypeFact[];
  returnType?: string;
  typeParameters: TypeParameterFact[];
  consumes: string[];
  produces: string[];
  confidence: "resolved" | "syntax";
}

export type DuplicationMode = "strict" | "mild" | "weak";

export interface SymbolDuplicationFacts {
  tokenCount: number;
  tokens: Record<DuplicationMode, string[]>;
  hashes: Record<DuplicationMode, string>;
}

export interface ParsedExport {
  name: string;
  type: "function" | "class" | "variable" | "type" | "interface" | "enum";
  loc: number;
  isDefault: boolean;
  complexity: number;
  typeFacts?: SymbolTypeFacts;
  duplication?: SymbolDuplicationFacts;
}

export interface ParsedSymbol extends ParsedExport {
  isExported: boolean;
}

export interface ParsedImport {
  from: string;
  resolvedFrom: string;
  symbols: string[];
  isTypeOnly: boolean;
}

export interface GraphNode {
  id: string;
  type: "file" | "function" | "class";
  path: string;
  label: string;
  loc: number;
  module: string;
  parentFile?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  symbols: string[];
  isTypeOnly: boolean;
  weight: number;
}

export type CallConfidence = "type-resolved" | "text-inferred";

export interface CallSite {
  callerFile: string;
  callerSymbol: string;
  calleeFile: string;
  calleeSymbol: string;
  confidence: CallConfidence;
}

export interface CallEdge {
  source: string;
  target: string;
  callerSymbol: string;
  calleeSymbol: string;
  confidence: CallConfidence;
}

export interface SymbolNode {
  id: string;
  name: string;
  type: ParsedExport["type"];
  file: string;
  loc: number;
  isDefault: boolean;
  complexity: number;
  isExported?: boolean;
  typeFacts?: SymbolTypeFacts;
  duplication?: SymbolDuplicationFacts;
}

export interface SymbolMetrics {
  symbolId: string;
  name: string;
  file: string;
  fanIn: number;
  fanOut: number;
  pageRank: number;
  betweenness: number;
}

export interface FileMetrics {
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
}

export interface ModuleMetrics {
  path: string;
  files: number;
  loc: number;
  exports: number;
  internalDeps: number;
  externalDeps: number;
  cohesion: number;
  escapeVelocity: number;
  dependsOn: string[];
  dependedBy: string[];
}

export interface TensionFile {
  file: string;
  tension: number;
  pulledBy: Array<{
    module: string;
    strength: number;
    symbols: string[];
  }>;
  recommendation: string;
}

export interface BridgeFile {
  file: string;
  betweenness: number;
  connects: string[];
  role: string;
}

export interface ExtractionCandidate {
  target: string;
  escapeVelocity: number;
  internalDeps: number;
  externalDeps: number;
  dependedByModules: number;
  recommendation: string;
}

export interface ShallowModule {
  module: string;
  files: number;
  exports: number;
  exportsPerFile: number;
  cohesion: number;
  locPerExport: number;
  evidence: string;
}

export interface DeepModule {
  module: string;
  files: number;
  exports: number;
  exportsPerFile: number;
  locPerExport: number;
  dependedByModules: number;
  evidence: string;
}

export type SeamScope = "file" | "module";

export interface SeamCandidate {
  target: string;
  scope: SeamScope;
  exposedSymbols: number;
  fanIn: number;
  dependentModules: number;
  evidence: string;
}

export type LocalityRiskKind = "ripple-zone" | "bridge-blast" | "concept-spread";

export interface LocalityRisk {
  file: string;
  kind: LocalityRiskKind;
  tension: number;
  blastRadius: number;
  isBridge: boolean;
  pulledByModuleCount: number;
  evidence: string;
}

export interface ForceAnalysis {
  moduleCohesion: Array<ModuleMetrics & { verdict: "COHESIVE" | "MODERATE" | "JUNK_DRAWER" | "LEAF" }>;
  tensionFiles: TensionFile[];
  bridgeFiles: BridgeFile[];
  extractionCandidates: ExtractionCandidate[];
  shallowModules: ShallowModule[];
  deepModules: DeepModule[];
  seamCandidates: SeamCandidate[];
  localityRisks: LocalityRisk[];
  summary: string;
}

export interface GroupMetrics {
  name: string;
  files: number;
  loc: number;
  importance: number;
  fanIn: number;
  fanOut: number;
  color: string;
}

export interface ProcessStep {
  step: number;
  file: string;
  symbol: string;
}

export interface ProcessFlow {
  name: string;
  entryPoint: { file: string; symbol: string };
  steps: ProcessStep[];
  depth: number;
  modulesTouched: string[];
}

export interface Cluster {
  id: string;
  name: string;
  files: string[];
  cohesion: number;
}

export interface CodebaseGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  callEdges: CallEdge[];
  symbolNodes: SymbolNode[];
  symbolMetrics: Map<string, SymbolMetrics>;
  fileMetrics: Map<string, FileMetrics>;
  moduleMetrics: Map<string, ModuleMetrics>;
  groups: GroupMetrics[];
  processes: ProcessFlow[];
  clusters: Cluster[];
  forceAnalysis: ForceAnalysis;
  stats: {
    totalFiles: number;
    totalFunctions: number;
    totalDependencies: number;
    circularDeps: string[][];
    analysisMode: AnalysisMode;
    callGraphPrecision: CallGraphPrecision;
    fullProgramFileLimit: number;
  };
}

// ── Config + Rules Engine ────────────────────────────────

export type Severity = "off" | "warn" | "error";
export type FindingSeverity = "warn" | "error";

export type RuleSetting =
  | Severity
  | 0
  | 1
  | 2
  | [Exclude<Severity, "off"> | 1 | 2, Record<string, unknown>];

export interface BoundaryZone {
  name: string;
  patterns: string[];
  autoDiscover?: boolean;
}

export interface BoundaryRule {
  from: string;
  allow?: string[];
  forbid?: string[];
}

export interface BoundariesConfig {
  preset?: "bulletproof" | "layered" | "hexagonal" | "feature-sliced";
  zones?: BoundaryZone[];
  rules?: BoundaryRule[];
}

export type OutputFormat = "text" | "json" | "sarif";

export interface CacheFacts {
  cacheDir: string;
  legacyCacheDir: string;
  migrated: boolean;
  gitignoreUpdated: boolean;
  warnings: string[];
}

export interface CodebaseIntelligenceConfig {
  root?: string;
  include?: string[];
  exclude?: string[];
  entry?: string[];
  ignore?: {
    dependencies?: string[];
    unresolvedImports?: string[];
    exportsUsedInFile?: boolean;
  };
  rules?: Record<string, RuleSetting>;
  boundaries?: BoundariesConfig;
  thresholds?: { health?: { minScore?: number } };
  output?: { format?: OutputFormat; quiet?: boolean; summary?: boolean };
  baseline?: string;
  ci?: {
    gate?: "all" | "new-only";
    failOn?: FindingSeverity | "never";
    maxWarnings?: number;
    tolerance?: number;
    base?: string;
  };
}

export type ActionKind = "remove-comment";
export type FindingConfidence = "high" | "medium" | "low";

export interface FindingAction {
  kind: ActionKind;
  /** snake_case is intentional — this is an agent-facing wire field. */
  auto_fixable: boolean;
  range?: { start: number; end: number };
}

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  kind?: string;
  confidence?: FindingConfidence;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  evidence?: string[];
  actions?: FindingAction[];
  fingerprint: string;
}

export interface CheckSummary {
  error: number;
  warn: number;
  rules: Record<string, number>;
}

export type Verdict = "pass" | "warn" | "fail";

export interface CheckResult {
  findings: Finding[];
  summary: CheckSummary;
  verdict: Verdict;
  configPath: string | null;
}
