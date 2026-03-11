export interface ParsedFile {
  path: string;
  relativePath: string;
  loc: number;
  exports: ParsedExport[];
  imports: ParsedImport[];
  callSites: CallSite[];
  churn: number;
  isTestFile: boolean;
  testFile?: string;
}

export interface ParsedExport {
  name: string;
  type: "function" | "class" | "variable" | "type" | "interface" | "enum";
  loc: number;
  isDefault: boolean;
  complexity: number;
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

export interface ForceAnalysis {
  moduleCohesion: Array<ModuleMetrics & { verdict: "COHESIVE" | "MODERATE" | "JUNK_DRAWER" | "LEAF" }>;
  tensionFiles: TensionFile[];
  bridgeFiles: BridgeFile[];
  extractionCandidates: ExtractionCandidate[];
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
  };
}
