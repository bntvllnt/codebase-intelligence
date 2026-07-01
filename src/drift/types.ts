import type { FileMetrics, GraphEdge, SymbolNode } from "../types/index.js";

export const CONTENT_DRIFT_KINDS = [
  "name-drift",
  "scope-drift",
  "mixed-responsibility",
  "hidden-side-effect",
  "shape-drift",
  "orphan-scope",
  "misplaced-test",
] as const;

export type ContentDriftKind = typeof CONTENT_DRIFT_KINDS[number];
export type ContentDriftEvidenceKind = "name" | "scope" | "imports" | "calls" | "types" | "tests" | "metric";
export type ContentDriftSeverity = "low" | "medium" | "high";
export type ContentDriftActionKind = "inspect-file" | "map-scope" | "rename-or-split" | "move-test" | "establish-baseline";

export interface ContentDriftOptions {
  focus?: string;
  scope?: string;
  minScore?: number;
}

export interface ContentDriftEvidence {
  id: string;
  kind: ContentDriftEvidenceKind;
  summary: string;
  file?: string;
  symbol?: string;
}

export interface ContentDriftIntent {
  path: string;
  fileName: string;
  scope: string;
  tokens: string[];
  exports: string[];
}

export interface ContentDriftBehavior {
  tokens: string[];
  imports: string[];
  calls: string[];
  types: string[];
  sideEffects: string[];
  tests: string[];
}

export interface ContentDriftAction {
  kind: ContentDriftActionKind;
  command: string;
  description: string;
}

export interface ContentDriftFinding {
  id: string;
  kind: ContentDriftKind;
  severity: ContentDriftSeverity;
  score: number;
  file: string;
  scope: string;
  title: string;
  recommendation: string;
  declaredIntent: ContentDriftIntent;
  actualBehavior: ContentDriftBehavior;
  evidenceIds: string[];
  evidence: string[];
  actions: ContentDriftAction[];
}

export interface ContentDriftBaseline {
  status: "not-configured";
  requiredForGate: true;
  reason: string;
}

export interface ContentDriftResult {
  mode: "report-only";
  baseline: ContentDriftBaseline;
  focus?: string;
  scope?: string;
  minScore: number;
  totalFindings: number;
  findings: ContentDriftFinding[];
  evidence: ContentDriftEvidence[];
  summary: string;
}

export interface EvidenceRegistry {
  byId: Map<string, ContentDriftEvidence>;
}

export interface FileProfile {
  file: string;
  scope: string;
  fileName: string;
  declared: ContentDriftIntent;
  behavior: ContentDriftBehavior;
  metrics?: FileMetrics;
  importEdges: GraphEdge[];
  importedBy: GraphEdge[];
  symbols: SymbolNode[];
  isTestFile: boolean;
}

export interface FindingDraft {
  kind: ContentDriftKind;
  file: string;
  scope: string;
  score: number;
  title: string;
  recommendation: string;
  evidenceIds: string[];
  declaredIntent: ContentDriftIntent;
  actualBehavior: ContentDriftBehavior;
}

export const DEFAULT_MIN_SCORE = 35;
