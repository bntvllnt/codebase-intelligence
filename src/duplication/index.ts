import { createHash } from "node:crypto";
import type { CodebaseGraph, DuplicationMode, SymbolDuplicationFacts } from "../types/index.js";

export const DUPLICATION_MODES = ["strict", "mild", "weak"] as const;
export const DEFAULT_DUPLICATION_MODE: DuplicationMode = "mild";
export const DEFAULT_DUPLICATION_MIN_TOKENS = 30;

const DUPLICATION_THRESHOLDS: Record<DuplicationMode, number> = {
  strict: 1,
  mild: 1,
  weak: 0.72,
};

interface DuplicationCandidate {
  key: string;
  file: string;
  symbol: string;
  loc: number;
  tokenCount: number;
  tokens: string[];
  hash: string;
}

export interface DuplicationOptions {
  mode?: DuplicationMode;
  minTokens?: number;
  skipLocal?: boolean;
  trace?: string;
}

export interface DuplicationMember {
  file: string;
  symbol: string;
  loc: number;
  tokenCount: number;
  hash: string;
}

export interface DuplicationSimilarity {
  threshold: number;
  average: number;
  minimum: number;
}

export interface DuplicationFamily {
  id: string;
  mode: DuplicationMode;
  memberCount: number;
  tokenCount: number;
  similarity: DuplicationSimilarity;
  members: DuplicationMember[];
  evidence: string;
}

export interface DuplicationTraceMember {
  file: string;
  symbol: string;
  tokens: string[];
  truncated: boolean;
}

export interface DuplicationTracePair {
  left: string;
  right: string;
  similarity: number;
}

export interface DuplicationTrace {
  id: string;
  found: boolean;
  mode: DuplicationMode;
  threshold: number;
  members: DuplicationTraceMember[];
  pairwise: DuplicationTracePair[];
  reason?: string;
}

export interface DuplicationResult {
  mode: DuplicationMode;
  minTokens: number;
  skipLocal: boolean;
  threshold: number;
  totalCandidates: number;
  totalFamilies: number;
  families: DuplicationFamily[];
  trace?: DuplicationTrace;
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function memberKey(member: { file: string; symbol: string }): string {
  return `${member.file}::${member.symbol}`;
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compareCandidate(left: DuplicationCandidate, right: DuplicationCandidate): number {
  const byFile = left.file.localeCompare(right.file);
  if (byFile !== 0) return byFile;
  if (left.loc !== right.loc) return left.loc - right.loc;
  return left.symbol.localeCompare(right.symbol);
}

function symbolDuplication(
  duplication: SymbolDuplicationFacts | undefined,
  mode: DuplicationMode,
): { tokenCount: number; tokens: string[]; hash: string } | undefined {
  if (!duplication) return undefined;
  return {
    tokenCount: duplication.tokenCount,
    tokens: duplication.tokens[mode],
    hash: duplication.hashes[mode],
  };
}

function collectCandidates(graph: CodebaseGraph, mode: DuplicationMode, minTokens: number): DuplicationCandidate[] {
  return graph.symbolNodes
    .flatMap((symbol): DuplicationCandidate[] => {
      if (symbol.type !== "function") return [];
      const duplication = symbolDuplication(symbol.duplication, mode);
      if (!duplication || duplication.tokenCount < minTokens) return [];
      return [{
        key: memberKey({ file: symbol.file, symbol: symbol.name }),
        file: symbol.file,
        symbol: symbol.name,
        loc: symbol.loc,
        tokenCount: duplication.tokenCount,
        tokens: duplication.tokens,
        hash: duplication.hash,
      }];
    })
    .sort(compareCandidate);
}

function sequenceSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length === right.length && left.every((token, index) => token === right[index])) return 1;

  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1] + 1
        : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = current[rightIndex];
      current[rightIndex] = 0;
    }
  }

  return previous[right.length] / Math.max(left.length, right.length);
}

function tokenCountCanReachThreshold(
  left: DuplicationCandidate,
  right: DuplicationCandidate,
  threshold: number,
): boolean {
  return Math.min(left.tokens.length, right.tokens.length) / Math.max(left.tokens.length, right.tokens.length) >= threshold;
}

function exactGroups(candidates: DuplicationCandidate[]): DuplicationCandidate[][] {
  const byHash = new Map<string, DuplicationCandidate[]>();
  for (const candidate of candidates) {
    const existing = byHash.get(candidate.hash);
    if (existing) existing.push(candidate);
    else byHash.set(candidate.hash, [candidate]);
  }
  return [...byHash.values()].filter((group) => group.length > 1);
}

function weakGroups(candidates: DuplicationCandidate[], threshold: number): DuplicationCandidate[][] {
  const groups: DuplicationCandidate[][] = [];
  const assigned = new Set<string>();

  for (const candidate of candidates) {
    if (assigned.has(candidate.key)) continue;
    const group = [candidate];

    for (const other of candidates) {
      if (candidate.key === other.key || assigned.has(other.key)) continue;
      const similarToAll = group.every((member) =>
        tokenCountCanReachThreshold(member, other, threshold)
        && sequenceSimilarity(member.tokens, other.tokens) >= threshold
      );
      if (similarToAll) group.push(other);
    }

    if (group.length > 1) {
      for (const member of group) assigned.add(member.key);
      groups.push(group);
    }
  }

  return groups;
}

function isCrossFileGroup(group: DuplicationCandidate[]): boolean {
  return new Set(group.map((candidate) => candidate.file)).size > 1;
}

function pairwiseSimilarities(group: DuplicationCandidate[]): DuplicationTracePair[] {
  const pairs: DuplicationTracePair[] = [];
  for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
      const left = group[leftIndex];
      const right = group[rightIndex];
      pairs.push({
        left: left.key,
        right: right.key,
        similarity: roundSimilarity(sequenceSimilarity(left.tokens, right.tokens)),
      });
    }
  }
  return pairs;
}

function summarizeSimilarity(threshold: number, pairs: DuplicationTracePair[]): DuplicationSimilarity {
  if (pairs.length === 0) return { threshold, average: 1, minimum: 1 };
  const scores = pairs.map((pair) => pair.similarity);
  const sum = scores.reduce((total, score) => total + score, 0);
  return {
    threshold,
    average: roundSimilarity(sum / scores.length),
    minimum: Math.min(...scores),
  };
}

function buildFamily(mode: DuplicationMode, threshold: number, group: DuplicationCandidate[]): DuplicationFamily {
  const members = [...group]
    .sort(compareCandidate)
    .map((member) => ({
      file: member.file,
      symbol: member.symbol,
      loc: member.loc,
      tokenCount: member.tokenCount,
      hash: member.hash,
    }));
  const seed = `${mode}:${members.map(memberKey).join("|")}:${members.map((member) => member.hash).join("|")}`;
  const pairs = pairwiseSimilarities(group);
  const tokenCount = Math.min(...members.map((member) => member.tokenCount));

  return {
    id: `dup-${mode}-${hashString(seed)}`,
    mode,
    memberCount: members.length,
    tokenCount,
    similarity: summarizeSimilarity(threshold, pairs),
    members,
    evidence: `${members.length} function-like symbols share at least ${tokenCount} normalized tokens`,
  };
}

function compareFamily(left: DuplicationFamily, right: DuplicationFamily): number {
  const leftFirst = left.members[0];
  const rightFirst = right.members[0];
  const byFile = leftFirst.file.localeCompare(rightFirst.file);
  if (byFile !== 0) return byFile;
  if (leftFirst.loc !== rightFirst.loc) return leftFirst.loc - rightFirst.loc;
  return left.id.localeCompare(right.id);
}

function traceFamily(
  id: string,
  mode: DuplicationMode,
  threshold: number,
  family: DuplicationFamily | undefined,
  candidatesByKey: Map<string, DuplicationCandidate>,
): DuplicationTrace {
  if (!family) {
    return {
      id,
      found: false,
      mode,
      threshold,
      members: [],
      pairwise: [],
      reason: "No duplicate family matched the current mode, minTokens, and skipLocal filters.",
    };
  }

  const candidates = family.members
    .map((member) => candidatesByKey.get(memberKey(member)))
    .filter((candidate): candidate is DuplicationCandidate => candidate !== undefined);

  return {
    id,
    found: true,
    mode,
    threshold,
    members: candidates.map((candidate) => ({
      file: candidate.file,
      symbol: candidate.symbol,
      tokens: candidate.tokens.slice(0, 120),
      truncated: candidate.tokens.length > 120,
    })),
    pairwise: pairwiseSimilarities(candidates),
  };
}

export function computeDuplication(graph: CodebaseGraph, options: DuplicationOptions = {}): DuplicationResult {
  const mode = options.mode ?? DEFAULT_DUPLICATION_MODE;
  const minTokens = options.minTokens ?? DEFAULT_DUPLICATION_MIN_TOKENS;
  const skipLocal = options.skipLocal ?? false;
  const threshold = DUPLICATION_THRESHOLDS[mode];
  const candidates = collectCandidates(graph, mode, minTokens);
  const groups = mode === "weak" ? weakGroups(candidates, threshold) : exactGroups(candidates);
  const families = groups
    .filter((group) => !skipLocal || isCrossFileGroup(group))
    .map((group) => buildFamily(mode, threshold, group))
    .sort(compareFamily);
  const candidatesByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const tracedFamily = options.trace ? families.find((family) => family.id === options.trace) : undefined;

  return {
    mode,
    minTokens,
    skipLocal,
    threshold,
    totalCandidates: candidates.length,
    totalFamilies: families.length,
    families: options.trace ? families.filter((family) => family.id === options.trace) : families,
    trace: options.trace ? traceFamily(options.trace, mode, threshold, tracedFamily, candidatesByKey) : undefined,
  };
}
