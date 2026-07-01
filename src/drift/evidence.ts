import type { ContentDriftEvidenceKind, EvidenceRegistry } from "./types.js";
import { hashId } from "./tokens.js";

function evidenceKey(kind: ContentDriftEvidenceKind, summary: string, file?: string, symbol?: string): string {
  return hashId([kind, summary, file ?? "", symbol ?? ""]);
}

export function createEvidenceRegistry(): EvidenceRegistry {
  return { byId: new Map() };
}

export function addEvidence(
  registry: EvidenceRegistry,
  kind: ContentDriftEvidenceKind,
  summary: string,
  file?: string,
  symbol?: string,
): string {
  const id = `evidence-${evidenceKey(kind, summary, file, symbol)}`;
  if (!registry.byId.has(id)) {
    registry.byId.set(id, { id, kind, summary, file, symbol });
  }
  return id;
}

export function evidenceSummaries(registry: EvidenceRegistry, evidenceIds: readonly string[]): string[] {
  return evidenceIds
    .map((id) => registry.byId.get(id)?.summary)
    .filter((summary): summary is string => summary !== undefined);
}
