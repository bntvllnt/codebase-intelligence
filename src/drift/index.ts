import type { CodebaseGraph } from "../types/index.js";
import { createEvidenceRegistry } from "./evidence.js";
import { buildFindings, matchesFilters, resultSummary } from "./findings.js";
import { buildProfiles } from "./profiles.js";
import type { ContentDriftEvidence, ContentDriftOptions, ContentDriftResult } from "./types.js";
import { DEFAULT_MIN_SCORE } from "./types.js";

export { CONTENT_DRIFT_KINDS } from "./types.js";
export type {
  ContentDriftAction,
  ContentDriftActionKind,
  ContentDriftBaseline,
  ContentDriftBehavior,
  ContentDriftEvidence,
  ContentDriftEvidenceKind,
  ContentDriftFinding,
  ContentDriftIntent,
  ContentDriftKind,
  ContentDriftOptions,
  ContentDriftResult,
  ContentDriftSeverity,
} from "./types.js";

export function computeContentDrift(graph: CodebaseGraph, options: ContentDriftOptions = {}): ContentDriftResult {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const evidenceRegistry = createEvidenceRegistry();
  const findings = buildProfiles(graph)
    .flatMap((profile) => buildFindings(profile, evidenceRegistry))
    .filter((finding) => matchesFilters(finding, { ...options, minScore }))
    .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind) || left.file.localeCompare(right.file));

  const evidenceIds = new Set(findings.flatMap((finding) => finding.evidenceIds));
  const evidence: ContentDriftEvidence[] = [...evidenceRegistry.byId.values()]
    .filter((item) => evidenceIds.has(item.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    mode: "report-only",
    baseline: {
      status: "not-configured",
      requiredForGate: true,
      reason: "Content drift is advisory until a drift baseline exists; CI gating is intentionally deferred.",
    },
    focus: options.focus,
    scope: options.scope,
    minScore,
    totalFindings: findings.length,
    findings,
    evidence,
    summary: resultSummary(findings.length, minScore),
  };
}
