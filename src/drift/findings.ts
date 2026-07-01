import { addEvidence, evidenceSummaries } from "./evidence.js";
import type {
  ContentDriftAction,
  ContentDriftFinding,
  ContentDriftKind,
  ContentDriftOptions,
  EvidenceRegistry,
  FileProfile,
  FindingDraft,
} from "./types.js";
import { DEFAULT_MIN_SCORE } from "./types.js";
import {
  dirname,
  firstWords,
  hashId,
  hasOverlap,
  normalizePath,
  scoreSeverity,
  SIDE_EFFECT_TOKENS,
  splitWords,
  uniqueSorted,
} from "./tokens.js";

function profileActions(profile: FileProfile, kind: ContentDriftKind): ContentDriftAction[] {
  const actions: ContentDriftAction[] = [
    {
      kind: "inspect-file",
      command: `codebase-intelligence file . "${profile.file}" --json`,
      description: "Inspect dependency and metric evidence before moving or renaming.",
    },
  ];

  if (kind === "misplaced-test") {
    actions.push({
      kind: "move-test",
      command: `codebase-intelligence drift . --focus "${profile.file}" --json`,
      description: "Re-run drift after moving the test beside the covered implementation.",
    });
  } else {
    actions.push({
      kind: "rename-or-split",
      command: `codebase-intelligence map . --focus "${profile.file}" --json`,
      description: "Map the affected neighborhood before renaming or splitting responsibilities.",
    });
  }

  actions.push({
    kind: "establish-baseline",
    command: "codebase-intelligence drift . --json",
    description: "Store a baseline before turning drift into a CI gate.",
  });

  return actions;
}

function buildContentDriftFinding(
  draft: FindingDraft,
  profile: FileProfile,
  registry: EvidenceRegistry,
): ContentDriftFinding {
  const evidence = draft.evidenceIds;
  const id = `drift-${hashId([draft.kind, draft.file, draft.scope, ...evidence])}`;
  return {
    id,
    kind: draft.kind,
    severity: scoreSeverity(draft.score),
    score: Math.min(100, Math.round(draft.score)),
    file: draft.file,
    scope: draft.scope,
    title: draft.title,
    recommendation: draft.recommendation,
    declaredIntent: draft.declaredIntent,
    actualBehavior: draft.actualBehavior,
    evidenceIds: evidence,
    evidence: evidenceSummaries(registry, evidence),
    actions: profileActions(profile, draft.kind),
  };
}

function nameDrift(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile) return undefined;
  const fileTokens = splitWords(profile.fileName);
  if (fileTokens.length === 0) return undefined;
  const behaviorTokens = profile.behavior.tokens;
  if (behaviorTokens.length === 0) return undefined;
  if (hasOverlap(fileTokens, behaviorTokens)) return undefined;

  const shownBehavior = firstWords(behaviorTokens, 4).join(", ");
  const evidenceId = addEvidence(
    evidence,
    "name",
    `File name tokens [${fileTokens.join(", ")}] do not match dominant behavior tokens [${shownBehavior}]`,
    profile.file,
  );
  return {
    kind: "name-drift",
    file: profile.file,
    scope: profile.scope,
    score: 62 + Math.min(18, behaviorTokens.length * 3),
    title: `${profile.file} name does not describe its dominant behavior`,
    recommendation: `Rename ${profile.fileName} or split behavior around ${shownBehavior}.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function scopeDrift(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile) return undefined;
  const scopeTokens = splitWords(profile.scope);
  if (scopeTokens.length === 0) return undefined;
  const behaviorTokens = profile.behavior.tokens;
  if (behaviorTokens.length === 0 || hasOverlap(scopeTokens, behaviorTokens)) return undefined;
  if (profile.importEdges.length < 2 && (profile.metrics?.tension ?? 0) < 0.3) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "scope",
    `Scope [${scopeTokens.join(", ")}] differs from behavior [${firstWords(behaviorTokens, 5).join(", ")}]`,
    profile.file,
  );
  return {
    kind: "scope-drift",
    file: profile.file,
    scope: profile.scope,
    score: 55 + Math.min(25, Math.round((profile.metrics?.tension ?? 0) * 50) + profile.importEdges.length * 3),
    title: `${profile.file} behaves outside its folder scope`,
    recommendation: `Move ${profile.file} closer to ${behaviorTokens[0] ?? "its dominant behavior"} or extract the cross-scope behavior.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function mixedResponsibility(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile) return undefined;
  const domains = profile.behavior.tokens.filter((token) => !profile.declared.tokens.includes(token));
  const uniqueDomains = firstWords(uniqueSorted(domains), 5);
  const fanOut = profile.metrics?.fanOut ?? profile.importEdges.length;
  const tension = profile.metrics?.tension ?? 0;
  if (uniqueDomains.length < 3 || (fanOut < 4 && tension < 0.4 && profile.behavior.sideEffects.length === 0)) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "metric",
    `Behavior spans ${uniqueDomains.length} outside-domain tokens, fan-out ${fanOut}, tension ${tension.toFixed(2)}, and ${profile.behavior.sideEffects.length} side-effect signals`,
    profile.file,
  );
  return {
    kind: "mixed-responsibility",
    file: profile.file,
    scope: profile.scope,
    score: 50 + Math.min(30, uniqueDomains.length * 5 + fanOut * 2),
    title: `${profile.file} mixes multiple responsibilities`,
    recommendation: `Split ${profile.file} by dominant behavior tokens: ${uniqueDomains.join(", ")}.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function hiddenSideEffect(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile || profile.behavior.sideEffects.length === 0) return undefined;
  const declaredSideEffects = profile.declared.tokens.filter((token) => SIDE_EFFECT_TOKENS.has(token));
  if (declaredSideEffects.length > 0) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "calls",
    `Side-effect calls/symbols [${profile.behavior.sideEffects.join(", ")}] are not declared by path/name tokens`,
    profile.file,
  );
  return {
    kind: "hidden-side-effect",
    file: profile.file,
    scope: profile.scope,
    score: 72 + Math.min(18, profile.behavior.sideEffects.length * 3),
    title: `${profile.file} hides side-effect behavior`,
    recommendation: `Move side effects behind an explicit gateway or rename the file to declare ${profile.behavior.sideEffects[0]}.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function shapeDrift(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile || profile.behavior.types.length === 0) return undefined;
  const typeTokens = uniqueSorted(profile.behavior.types.flatMap((typeName) => splitWords(typeName)));
  const outsideTypes = typeTokens.filter((token) => !profile.declared.tokens.includes(token));
  if (outsideTypes.length === 0) return undefined;
  if (typeTokens.length > 0 && outsideTypes.length < typeTokens.length) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "types",
    `Type facts mention [${firstWords(profile.behavior.types, 5).join(", ")}] but declared tokens are [${profile.declared.tokens.join(", ")}]`,
    profile.file,
  );
  return {
    kind: "shape-drift",
    file: profile.file,
    scope: profile.scope,
    score: 58 + Math.min(22, outsideTypes.length * 4),
    title: `${profile.file} moves shapes its path does not declare`,
    recommendation: `Move shape handling near ${outsideTypes[0] ?? "the owning domain"} or rename the boundary.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function misplacedTest(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (!profile.isTestFile) return undefined;
  const testedEdges = profile.importEdges.filter((edge) => !edge.isTypeOnly && !edge.target.includes(".spec.") && !edge.target.includes(".test."));
  const misplaced = testedEdges.find((edge) => dirname(edge.target) !== dirname(profile.file));
  if (!misplaced) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "tests",
    `Test ${profile.file} imports implementation ${misplaced.target} from a different scope`,
    profile.file,
  );
  return {
    kind: "misplaced-test",
    file: profile.file,
    scope: profile.scope,
    score: 70,
    title: `${profile.file} is not close to the implementation it tests`,
    recommendation: `Move the test beside ${misplaced.target} or rename its scope to match the covered implementation.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function orphanScope(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft | undefined {
  if (profile.isTestFile || profile.scope === ".") return undefined;
  const metrics = profile.metrics;
  if (!metrics) return undefined;
  if (metrics.fanIn > 0 || metrics.fanOut > 0 || profile.importedBy.length > 0 || profile.importEdges.length > 0) return undefined;

  const evidenceId = addEvidence(
    evidence,
    "scope",
    `Scope ${profile.scope} has no import edges in or out for ${profile.file}`,
    profile.file,
  );
  return {
    kind: "orphan-scope",
    file: profile.file,
    scope: profile.scope,
    score: 42,
    title: `${profile.scope} appears disconnected from the codebase graph`,
    recommendation: `Keep ${profile.scope} only if it is a deliberate boundary; otherwise merge or delete it after inspection.`,
    declaredIntent: profile.declared,
    actualBehavior: profile.behavior,
    evidenceIds: [evidenceId],
  };
}

function draftFindings(profile: FileProfile, evidence: EvidenceRegistry): FindingDraft[] {
  return [
    nameDrift(profile, evidence),
    scopeDrift(profile, evidence),
    mixedResponsibility(profile, evidence),
    hiddenSideEffect(profile, evidence),
    shapeDrift(profile, evidence),
    misplacedTest(profile, evidence),
    orphanScope(profile, evidence),
  ].filter((finding): finding is FindingDraft => finding !== undefined);
}

function normalizeScopeFilter(scope: string | undefined): string | undefined {
  if (!scope) return undefined;
  const normalized = normalizePath(scope).replace(/\/+$/, "");
  return normalized.length === 0 ? undefined : `${normalized}/`;
}

export function buildFindings(profile: FileProfile, evidence: EvidenceRegistry): ContentDriftFinding[] {
  return draftFindings(profile, evidence).map((draft) => buildContentDriftFinding(draft, profile, evidence));
}

export function matchesFilters(finding: ContentDriftFinding, options: ContentDriftOptions): boolean {
  const focus = options.focus?.toLowerCase();
  if (focus) {
    const haystack = [
      finding.file,
      finding.scope,
      finding.title,
      ...finding.declaredIntent.exports,
      ...finding.actualBehavior.calls,
      ...finding.actualBehavior.types,
    ].join(" ").toLowerCase();
    if (!haystack.includes(focus)) return false;
  }

  const scope = normalizeScopeFilter(options.scope);
  if (scope && !finding.file.startsWith(scope) && finding.scope !== scope) return false;

  return finding.score >= (options.minScore ?? DEFAULT_MIN_SCORE);
}

export function resultSummary(total: number, minScore: number): string {
  if (total === 0) return `No content drift findings at or above score ${minScore}.`;
  return `${total} content drift findings at or above score ${minScore}. Report-only until a baseline is configured.`;
}
