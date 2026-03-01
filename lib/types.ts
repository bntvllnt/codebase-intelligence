export interface GraphApiNode {
  id: string;
  type: "file" | "function";
  label: string;
  path: string;
  loc: number;
  module: string;
  pageRank: number;
  betweenness: number;
  coupling: number;
  fanIn: number;
  fanOut: number;
  tension: number;
  isBridge: boolean;
  churn: number;
  cyclomaticComplexity: number;
  blastRadius: number;
  deadExports: string[];
  hasTests: boolean;
  testFile: string;
  functions: Array<{
    name: string;
    loc: number;
    fanIn?: number;
    fanOut?: number;
    pageRank?: number;
  }>;
}

export interface GraphApiEdge {
  source: string;
  target: string;
  symbols: string[];
  isTypeOnly: boolean;
  weight: number;
}

export interface GraphApiStats {
  totalFiles: number;
  totalFunctions: number;
  totalDependencies: number;
  circularDeps: string[][];
}

export interface GraphApiResponse {
  nodes: GraphApiNode[];
  edges: GraphApiEdge[];
  stats: GraphApiStats;
}

export interface ForceApiResponse {
  moduleCohesion: Array<{
    path: string;
    verdict: "COHESIVE" | "MODERATE" | "JUNK_DRAWER";
  }>;
  tensionFiles: Array<{ file: string; tension: number }>;
  bridgeFiles: Array<{ file: string; betweenness: number; connects: string[] }>;
  extractionCandidates: Array<{ target: string; escapeVelocity: number }>;
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

export type ViewType =
  | "galaxy"
  | "depflow"
  | "hotspot"
  | "focus"
  | "module"
  | "forces"
  | "churn"
  | "coverage"
  | "symbols"
  | "types";

export interface SymbolApiNode {
  id: string;
  name: string;
  type: "function" | "class" | "variable" | "type" | "interface" | "enum";
  file: string;
  loc: number;
  isDefault: boolean;
  fanIn: number;
  fanOut: number;
  pageRank: number;
  betweenness: number;
}

export interface CallApiEdge {
  source: string;
  target: string;
  callerSymbol: string;
  calleeSymbol: string;
  confidence: "type-resolved" | "text-inferred";
}

export interface SymbolGraphResponse {
  symbolNodes: SymbolApiNode[];
  callEdges: CallApiEdge[];
  symbolMetrics: Array<{
    symbolId: string;
    name: string;
    file: string;
    fanIn: number;
    fanOut: number;
    pageRank: number;
    betweenness: number;
  }>;
}

export interface GraphConfig {
  nodeOpacity: number;
  nodeSize: number;
  isolatedDim: number;
  linkColor: string;
  linkOpacity: number;
  linkWidth: number;
  charge: number;
  distance: number;
  showModuleBoxes: boolean;
  boxOpacity: number;
}

export const DEFAULT_CONFIG: GraphConfig = {
  nodeOpacity: 0.9,
  nodeSize: 1.0,
  isolatedDim: 0.3,
  linkColor: "#969696",
  linkOpacity: 0.8,
  linkWidth: 0.3,
  charge: -30,
  distance: 120,
  showModuleBoxes: true,
  boxOpacity: 0.4,
};

export interface RenderNode {
  id: string;
  path: string;
  label: string;
  module: string;
  loc: number;
  pageRank: number;
  betweenness: number;
  coupling: number;
  fanIn: number;
  fanOut: number;
  tension: number;
  isBridge: boolean;
  churn: number;
  cyclomaticComplexity: number;
  blastRadius: number;
  deadExports: string[];
  hasTests: boolean;
  testFile: string;
  functions: Array<{
    name: string;
    loc: number;
    fanIn?: number;
    fanOut?: number;
    pageRank?: number;
  }>;
  color: string;
  size: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface RenderLink {
  source: string;
  target: string;
  color: string;
  width: number;
}
