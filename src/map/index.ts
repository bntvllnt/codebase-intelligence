import { createHash } from "node:crypto";
import type { CallEdge, CodebaseGraph, FileMetrics, GraphEdge, SymbolNode } from "../types/index.js";

export const CODEBASE_MAP_FORMATS = ["json", "markdown", "dot", "graphml"] as const;

export type CodebaseMapFormat = typeof CODEBASE_MAP_FORMATS[number];
export type CodebaseMapNodeKind = "file" | "symbol" | "test" | "scope";
export type CodebaseMapEdgeKind = "calls" | "contains" | "imports" | "tests";
export type CodebaseMapEvidenceKind = "focus" | "metric" | "call" | "contains" | "import" | "test" | "scope";

export interface CodebaseMapOptions {
  focus?: string;
  scope?: string;
  depth?: number;
  format?: CodebaseMapFormat;
  contextBudget?: number;
}

export interface CodebaseMapEvidence {
  id: string;
  kind: CodebaseMapEvidenceKind;
  summary: string;
  file?: string;
  symbol?: string;
}

export interface CodebaseMapNode {
  id: string;
  kind: CodebaseMapNodeKind;
  label: string;
  file?: string;
  symbol?: string;
  type?: string;
  loc?: number;
  module?: string;
  score: number;
  evidenceIds: string[];
}

export interface CodebaseMapEdge {
  id: string;
  kind: CodebaseMapEdgeKind;
  from: string;
  to: string;
  label: string;
  weight: number;
  evidenceIds: string[];
}

export interface CodebaseMapOverview {
  focus?: string;
  scope?: string;
  depth: number;
  contextBudget: number;
  totalNodes: number;
  totalEdges: number;
  totalEvidence: number;
}

export interface ContextPackFile {
  path: string;
  rank: number;
  reason: string;
  tokenEstimate: number;
  evidenceIds: string[];
}

export interface ContextPackSymbol {
  file: string;
  symbol: string;
  rank: number;
  reason: string;
  tokenEstimate: number;
  evidenceIds: string[];
}

export interface ContextPackTest {
  path: string;
  covers: string;
  rank: number;
  reason: string;
  tokenEstimate: number;
  evidenceIds: string[];
}

export interface CodebaseContextPack {
  tokenBudget: number;
  tokenEstimate: number;
  rankedFiles: ContextPackFile[];
  rankedSymbols: ContextPackSymbol[];
  tests: ContextPackTest[];
  evidenceIds: string[];
  nextCommands: string[];
}

export interface CodebaseMapResult {
  overview: CodebaseMapOverview;
  focus?: CodebaseMapNode;
  nodes: CodebaseMapNode[];
  edges: CodebaseMapEdge[];
  evidence: CodebaseMapEvidence[];
  contextPack: CodebaseContextPack;
  summary: string;
}

interface EvidenceStore {
  byId: Map<string, CodebaseMapEvidence>;
}

interface MapState {
  graph: CodebaseGraph;
  evidence: EvidenceStore;
  nodes: Map<string, CodebaseMapNode>;
  edges: Map<string, CodebaseMapEdge>;
}

interface FocusMatch {
  kind: "symbol" | "file" | "scope";
  symbol?: SymbolNode;
  file?: string;
  scope?: string;
}

interface ContextCandidate {
  category: "file" | "symbol" | "test";
  priority: number;
  tokenEstimate: number;
  evidenceIds: string[];
  file?: string;
  symbol?: string;
  covers?: string;
  reason: string;
}

const DEFAULT_DEPTH = 1;
const DEFAULT_CONTEXT_BUDGET = 1200;

function hashId(parts: readonly string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 10);
}

function evidenceKey(kind: CodebaseMapEvidenceKind, summary: string, file?: string, symbol?: string): string {
  return hashId([kind, summary, file ?? "", symbol ?? ""]);
}

function addEvidence(
  store: EvidenceStore,
  kind: CodebaseMapEvidenceKind,
  summary: string,
  file?: string,
  symbol?: string,
): string {
  const id = `evidence-${evidenceKey(kind, summary, file, symbol)}`;
  if (!store.byId.has(id)) {
    store.byId.set(id, { id, kind, summary, file, symbol });
  }
  return id;
}

function addEvidenceId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

function fileNodeId(file: string): string {
  return `file:${file}`;
}

function symbolNodeId(symbol: SymbolNode): string {
  return `symbol:${symbol.id}`;
}

function scopeNodeId(scope: string): string {
  return `scope:${scope}`;
}

function edgeId(kind: CodebaseMapEdgeKind, from: string, to: string, label: string): string {
  return `edge-${hashId([kind, from, to, label])}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(src|lib|app)\//, "");
}

function normalizeScope(value: string): string {
  const normalized = normalizePath(value).replace(/\/+$/, "");
  return normalized ? `${normalized}/` : "";
}

function graphFileNode(graph: CodebaseGraph, file: string): CodebaseGraph["nodes"][number] | undefined {
  return graph.nodes.find((node) => node.type === "file" && node.id === file);
}

function fileScore(metrics: FileMetrics | undefined, isFocus: boolean): number {
  const base = metrics
    ? (metrics.pageRank * 1000) + (metrics.fanIn * 20) + (metrics.fanOut * 10) + metrics.blastRadius
    : 0;
  return isFocus ? base + 10_000 : base;
}

function symbolScore(symbol: SymbolNode, graph: CodebaseGraph, isFocus: boolean): number {
  const metrics = graph.symbolMetrics.get(symbol.id);
  const base = metrics
    ? (metrics.pageRank * 1000) + (metrics.fanIn * 20) + (metrics.fanOut * 10) + metrics.betweenness
    : symbol.loc;
  return isFocus ? base + 9_000 : base;
}

function addFileNode(state: MapState, file: string, evidenceId: string, isFocus = false): CodebaseMapNode {
  const id = fileNodeId(file);
  const existing = state.nodes.get(id);
  if (existing) {
    existing.evidenceIds = addEvidenceId(existing.evidenceIds, evidenceId);
    existing.score = Math.max(existing.score, fileScore(state.graph.fileMetrics.get(file), isFocus));
    return existing;
  }

  const metrics = state.graph.fileMetrics.get(file);
  const graphNode = graphFileNode(state.graph, file);
  const node: CodebaseMapNode = {
    id,
    kind: metrics?.isTestFile ? "test" : "file",
    label: file,
    file,
    loc: graphNode?.loc,
    module: graphNode?.module,
    score: fileScore(metrics, isFocus),
    evidenceIds: [evidenceId],
  };
  state.nodes.set(id, node);
  return node;
}

function addSymbolNode(state: MapState, symbol: SymbolNode, evidenceId: string, isFocus = false): CodebaseMapNode {
  const id = symbolNodeId(symbol);
  const existing = state.nodes.get(id);
  if (existing) {
    existing.evidenceIds = addEvidenceId(existing.evidenceIds, evidenceId);
    existing.score = Math.max(existing.score, symbolScore(symbol, state.graph, isFocus));
    return existing;
  }

  const node: CodebaseMapNode = {
    id,
    kind: "symbol",
    label: symbol.name,
    file: symbol.file,
    symbol: symbol.name,
    type: symbol.type,
    loc: symbol.loc,
    score: symbolScore(symbol, state.graph, isFocus),
    evidenceIds: [evidenceId],
  };
  state.nodes.set(id, node);
  return node;
}

function addScopeNode(state: MapState, scope: string): CodebaseMapNode {
  const id = scopeNodeId(scope);
  const evidenceId = addEvidence(state.evidence, "scope", `Scope filter ${scope}`, scope);
  const existing = state.nodes.get(id);
  if (existing) {
    existing.evidenceIds = addEvidenceId(existing.evidenceIds, evidenceId);
    return existing;
  }
  const node: CodebaseMapNode = {
    id,
    kind: "scope",
    label: scope,
    file: scope,
    score: 8_000,
    evidenceIds: [evidenceId],
  };
  state.nodes.set(id, node);
  return node;
}

function addEdge(state: MapState, kind: CodebaseMapEdgeKind, from: string, to: string, label: string, weight: number, evidenceId: string): void {
  const id = edgeId(kind, from, to, label);
  const existing = state.edges.get(id);
  if (existing) {
    existing.evidenceIds = addEvidenceId(existing.evidenceIds, evidenceId);
    existing.weight = Math.max(existing.weight, weight);
    return;
  }
  state.edges.set(id, {
    id,
    kind,
    from,
    to,
    label,
    weight,
    evidenceIds: [evidenceId],
  });
}

function findSymbol(graph: CodebaseGraph, focus: string): SymbolNode | undefined {
  const normalizedFocus = normalizePath(focus);
  const candidates = graph.symbolNodes
    .filter((symbol) =>
      symbol.id === focus
      || symbol.name === focus
      || `${symbol.file}::${symbol.name}` === normalizedFocus
    )
    .sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name));
  return candidates[0];
}

function findFile(graph: CodebaseGraph, focus: string): string | undefined {
  const normalizedFocus = normalizePath(focus);
  if (graph.fileMetrics.has(normalizedFocus)) return normalizedFocus;
  return [...graph.fileMetrics.keys()]
    .filter((file) => file.endsWith(`/${normalizedFocus}`) || file === normalizedFocus)
    .sort()[0];
}

function findFocus(graph: CodebaseGraph, options: Required<Pick<CodebaseMapOptions, "focus" | "scope">>): FocusMatch | undefined {
  if (options.focus) {
    const symbol = findSymbol(graph, options.focus);
    if (symbol) return { kind: "symbol", symbol };
    const file = findFile(graph, options.focus);
    if (file) return { kind: "file", file };
  }
  if (options.scope) return { kind: "scope", scope: normalizeScope(options.scope) };
  return undefined;
}

function symbolsForFile(graph: CodebaseGraph, file: string): SymbolNode[] {
  return graph.symbolNodes
    .filter((symbol) => symbol.file === file)
    .sort((left, right) =>
      Number(right.isExported === true) - Number(left.isExported === true)
      || left.name.localeCompare(right.name)
    );
}

function callEdgesForSymbol(graph: CodebaseGraph, symbolId: string): CallEdge[] {
  return graph.callEdges
    .filter((edge) => edge.source === symbolId || edge.target === symbolId)
    .sort((left, right) =>
      left.source.localeCompare(right.source)
      || left.target.localeCompare(right.target)
      || left.callerSymbol.localeCompare(right.callerSymbol)
      || left.calleeSymbol.localeCompare(right.calleeSymbol)
    );
}

function includeSymbol(state: MapState, symbol: SymbolNode, reason: CodebaseMapEvidenceKind, isFocus = false): CodebaseMapNode {
  const symbolEvidence = addEvidence(state.evidence, reason, `${symbol.name} in ${symbol.file}`, symbol.file, symbol.name);
  const fileEvidence = addEvidence(state.evidence, "metric", `${symbol.file} contains ${symbol.name}`, symbol.file, symbol.name);
  addFileNode(state, symbol.file, fileEvidence, isFocus);
  return addSymbolNode(state, symbol, symbolEvidence, isFocus);
}

function includeFile(state: MapState, file: string, reason: CodebaseMapEvidenceKind, isFocus = false): CodebaseMapNode {
  const evidenceId = addEvidence(state.evidence, reason, `${file} selected for map`, file);
  const node = addFileNode(state, file, evidenceId, isFocus);
  for (const symbol of symbolsForFile(state.graph, file)) {
    includeSymbol(state, symbol, reason);
  }
  return node;
}

function includeRelatedTests(state: MapState): void {
  const files = [...state.nodes.values()]
    .filter((node) => node.kind === "file" && node.file)
    .map((node) => node.file);
  for (const file of files) {
    if (!file) continue;
    const metrics = state.graph.fileMetrics.get(file);
    if (!metrics?.testFile) continue;
    const testFile = metrics.testFile;
    const evidenceId = addEvidence(state.evidence, "test", `${testFile} tests ${file}`, testFile);
    addFileNode(state, testFile, evidenceId);
    addEdge(state, "tests", fileNodeId(testFile), fileNodeId(file), "tests", 1, evidenceId);
  }
}

function includeSymbolNeighborhood(state: MapState, focusSymbol: SymbolNode, depth: number): CodebaseMapNode {
  const focusNode = includeSymbol(state, focusSymbol, "focus", true);
  const symbolsById = new Map(state.graph.symbolNodes.map((symbol) => [symbol.id, symbol]));
  const queue: Array<{ symbolId: string; depth: number }> = [{ symbolId: focusSymbol.id, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.symbolId)) continue;
    visited.add(current.symbolId);
    if (current.depth >= depth) continue;

    for (const edge of callEdgesForSymbol(state.graph, current.symbolId)) {
      const nextId = edge.source === current.symbolId ? edge.target : edge.source;
      const nextSymbol = symbolsById.get(nextId);
      if (!nextSymbol) continue;
      includeSymbol(state, nextSymbol, "call");
      if (!visited.has(nextId)) queue.push({ symbolId: nextId, depth: current.depth + 1 });
    }
  }

  return focusNode;
}

function includeFileNeighborhood(state: MapState, focusFile: string, depth: number): CodebaseMapNode {
  const focusNode = includeFile(state, focusFile, "focus", true);
  const queue: Array<{ file: string; depth: number }> = [{ file: focusFile, depth: 0 }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.file)) continue;
    visited.add(current.file);
    if (current.depth >= depth) continue;
    const neighbors = state.graph.edges
      .filter((edge) => edge.source === current.file || edge.target === current.file)
      .flatMap((edge) => [edge.source, edge.target])
      .filter((file) => file !== current.file && state.graph.fileMetrics.has(file))
      .sort();
    for (const file of neighbors) {
      includeFile(state, file, "import");
      if (!visited.has(file)) queue.push({ file, depth: current.depth + 1 });
    }
  }
  return focusNode;
}

function includeScope(state: MapState, scope: string): CodebaseMapNode {
  const focusNode = addScopeNode(state, scope);
  const files = [...state.graph.fileMetrics.keys()]
    .filter((file) => file.startsWith(scope))
    .sort();
  for (const file of files) {
    includeFile(state, file, "scope");
  }
  return focusNode;
}

function includeOverviewFallback(state: MapState): CodebaseMapNode | undefined {
  const topFiles = [...state.graph.fileMetrics.entries()]
    .filter(([, metrics]) => !metrics.isTestFile)
    .sort(([leftFile, left], [rightFile, right]) =>
      right.pageRank - left.pageRank
      || right.fanIn - left.fanIn
      || leftFile.localeCompare(rightFile)
    )
    .slice(0, 8);
  for (const [file] of topFiles) {
    includeFile(state, file, "metric");
  }
  return [...state.nodes.values()].find((node) => node.kind === "file");
}

function addContainsEdges(state: MapState): void {
  for (const symbol of state.graph.symbolNodes) {
    const from = fileNodeId(symbol.file);
    const to = symbolNodeId(symbol);
    if (!state.nodes.has(from) || !state.nodes.has(to)) continue;
    const evidenceId = addEvidence(state.evidence, "contains", `${symbol.file} contains ${symbol.name}`, symbol.file, symbol.name);
    addEdge(state, "contains", from, to, "contains", 1, evidenceId);
  }
}

function addCallEdges(state: MapState): void {
  for (const edge of state.graph.callEdges) {
    const sourceSymbol = state.graph.symbolNodes.find((symbol) => symbol.id === edge.source);
    const targetSymbol = state.graph.symbolNodes.find((symbol) => symbol.id === edge.target);
    if (!sourceSymbol || !targetSymbol) continue;
    const from = symbolNodeId(sourceSymbol);
    const to = symbolNodeId(targetSymbol);
    if (!state.nodes.has(from) || !state.nodes.has(to)) continue;
    const evidenceId = addEvidence(
      state.evidence,
      "call",
      `${edge.callerSymbol} calls ${edge.calleeSymbol}`,
      sourceSymbol.file,
      edge.callerSymbol,
    );
    addEdge(state, "calls", from, to, edge.confidence, 1, evidenceId);
  }
}

function edgeLabel(edge: GraphEdge): string {
  return edge.symbols.length > 0 ? edge.symbols.join(",") : "imports";
}

function addImportEdges(state: MapState): void {
  for (const edge of state.graph.edges) {
    const from = fileNodeId(edge.source);
    const to = fileNodeId(edge.target);
    if (!state.nodes.has(from) || !state.nodes.has(to)) continue;
    const isTestEdge = edge.symbols.includes("tests");
    const kind: CodebaseMapEdgeKind = isTestEdge ? "tests" : "imports";
    const evidenceKind: CodebaseMapEvidenceKind = isTestEdge ? "test" : "import";
    const summary = isTestEdge
      ? `${edge.source} tests ${edge.target}`
      : `${edge.source} imports ${edge.target}`;
    const evidenceId = addEvidence(state.evidence, evidenceKind, summary, edge.source);
    addEdge(state, kind, from, to, edgeLabel(edge), edge.weight, evidenceId);
  }
}

function addGraphEdges(state: MapState): void {
  addContainsEdges(state);
  addCallEdges(state);
  addImportEdges(state);
}

function fileTokenEstimate(graph: CodebaseGraph, file: string): number {
  const loc = graphFileNode(graph, file)?.loc ?? 20;
  return Math.min(160, 80 + Math.ceil(loc / 2));
}

function symbolTokenEstimate(symbol: SymbolNode): number {
  return Math.min(120, 50 + symbol.loc * 5);
}

function evidenceIdsForNode(node: CodebaseMapNode): string[] {
  return [...node.evidenceIds].sort();
}

function candidatePriority(node: CodebaseMapNode): number {
  if (node.kind === "test") return node.score + 8_500;
  return node.score;
}

function contextCandidates(resultNodes: readonly CodebaseMapNode[], graph: CodebaseGraph): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  for (const node of resultNodes) {
    if (node.kind === "file" && node.file) {
      candidates.push({
        category: "file",
        priority: candidatePriority(node),
        tokenEstimate: fileTokenEstimate(graph, node.file),
        evidenceIds: evidenceIdsForNode(node),
        file: node.file,
        reason: node.score >= 10_000 ? "focus file" : "related file from focused graph",
      });
    }
    if (node.kind === "symbol" && node.file && node.symbol) {
      const symbol = graph.symbolNodes.find((candidate) => candidate.file === node.file && candidate.name === node.symbol);
      candidates.push({
        category: "symbol",
        priority: candidatePriority(node),
        tokenEstimate: symbol ? symbolTokenEstimate(symbol) : 80,
        evidenceIds: evidenceIdsForNode(node),
        file: node.file,
        symbol: node.symbol,
        reason: node.score >= 9_000 ? "focus symbol" : "caller/callee symbol from focused graph",
      });
    }
    if (node.kind === "test" && node.file) {
      const testEdge = graph.edges.find((edge) => edge.source === node.file && edge.symbols.includes("tests"));
      const coveredFile = testEdge?.target ?? [...graph.fileMetrics.entries()]
        .find(([, metrics]) => metrics.testFile === node.file)?.[0] ?? "";
      candidates.push({
        category: "test",
        priority: candidatePriority(node),
        tokenEstimate: fileTokenEstimate(graph, node.file),
        evidenceIds: evidenceIdsForNode(node),
        file: node.file,
        covers: coveredFile,
        reason: coveredFile ? `tests ${coveredFile}` : "test file near focus",
      });
    }
  }
  return candidates.sort((left, right) =>
    right.priority - left.priority
    || left.category.localeCompare(right.category)
    || (left.file ?? "").localeCompare(right.file ?? "")
    || (left.symbol ?? "").localeCompare(right.symbol ?? "")
  );
}

function buildContextPack(
  nodes: readonly CodebaseMapNode[],
  evidence: readonly CodebaseMapEvidence[],
  graph: CodebaseGraph,
  options: Required<Pick<CodebaseMapOptions, "contextBudget">> & Pick<CodebaseMapOptions, "focus">,
): CodebaseContextPack {
  const rankedFiles: ContextPackFile[] = [];
  const rankedSymbols: ContextPackSymbol[] = [];
  const tests: ContextPackTest[] = [];
  const evidenceIds = new Set<string>();
  let tokenEstimate = 0;

  for (const candidate of contextCandidates(nodes, graph)) {
    if (tokenEstimate + candidate.tokenEstimate > options.contextBudget) continue;
    tokenEstimate += candidate.tokenEstimate;
    for (const id of candidate.evidenceIds) evidenceIds.add(id);
    if (candidate.category === "file" && candidate.file) {
      rankedFiles.push({
        path: candidate.file,
        rank: rankedFiles.length + 1,
        reason: candidate.reason,
        tokenEstimate: candidate.tokenEstimate,
        evidenceIds: candidate.evidenceIds,
      });
    }
    if (candidate.category === "symbol" && candidate.file && candidate.symbol) {
      rankedSymbols.push({
        file: candidate.file,
        symbol: candidate.symbol,
        rank: rankedSymbols.length + 1,
        reason: candidate.reason,
        tokenEstimate: candidate.tokenEstimate,
        evidenceIds: candidate.evidenceIds,
      });
    }
    if (candidate.category === "test" && candidate.file) {
      tests.push({
        path: candidate.file,
        covers: candidate.covers ?? "",
        rank: tests.length + 1,
        reason: candidate.reason,
        tokenEstimate: candidate.tokenEstimate,
        evidenceIds: candidate.evidenceIds,
      });
    }
  }

  const focusCommand = options.focus ? `codebase-intelligence map . --focus ${JSON.stringify(options.focus)} --json` : "codebase-intelligence map . --json";
  const symbolCommand = rankedSymbols[0]
    ? `codebase-intelligence symbol . ${JSON.stringify(rankedSymbols[0].symbol)} --json`
    : undefined;
  const fileCommand = rankedFiles[0]
    ? `codebase-intelligence file . ${JSON.stringify(rankedFiles[0].path)} --json`
    : undefined;
  return {
    tokenBudget: options.contextBudget,
    tokenEstimate,
    rankedFiles,
    rankedSymbols,
    tests,
    evidenceIds: [...evidenceIds].filter((id) => evidence.some((item) => item.id === id)).sort(),
    nextCommands: [focusCommand, symbolCommand, fileCommand].filter((command): command is string => Boolean(command)),
  };
}

function sortedNodes(nodes: Iterable<CodebaseMapNode>): CodebaseMapNode[] {
  return [...nodes].sort((left, right) =>
    right.score - left.score
    || left.kind.localeCompare(right.kind)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  );
}

function sortedEdges(edges: Iterable<CodebaseMapEdge>): CodebaseMapEdge[] {
  return [...edges].sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.label.localeCompare(right.label)
  );
}

function sortedEvidence(evidence: EvidenceStore): CodebaseMapEvidence[] {
  return [...evidence.byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeOptions(options: CodebaseMapOptions): Required<Pick<CodebaseMapOptions, "depth" | "contextBudget" | "format">> & Pick<CodebaseMapOptions, "focus" | "scope"> {
  const focus = options.focus?.trim();
  const scope = options.scope?.trim();
  return {
    focus: focus === "" ? undefined : focus,
    scope: scope === "" ? undefined : scope,
    depth: options.depth ?? DEFAULT_DEPTH,
    contextBudget: options.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
    format: options.format ?? "markdown",
  };
}

/**
 * Build a deterministic focused codebase map plus a token-bounded context pack for agents.
 */
export function computeCodebaseMap(graph: CodebaseGraph, options: CodebaseMapOptions = {}): CodebaseMapResult {
  const normalized = normalizeOptions(options);
  const state: MapState = {
    graph,
    evidence: { byId: new Map() },
    nodes: new Map(),
    edges: new Map(),
  };

  const match = findFocus(graph, { focus: normalized.focus ?? "", scope: normalized.scope ?? "" });
  let focusNode: CodebaseMapNode | undefined;
  if (match?.kind === "symbol" && match.symbol) {
    focusNode = includeSymbolNeighborhood(state, match.symbol, normalized.depth);
  } else if (match?.kind === "file" && match.file) {
    focusNode = includeFileNeighborhood(state, match.file, normalized.depth);
  } else if (match?.kind === "scope" && match.scope !== undefined) {
    focusNode = includeScope(state, match.scope);
  } else {
    focusNode = includeOverviewFallback(state);
  }

  includeRelatedTests(state);
  addGraphEdges(state);

  const nodes = sortedNodes(state.nodes.values());
  const edges = sortedEdges(state.edges.values());
  const evidence = sortedEvidence(state.evidence);
  const contextPack = buildContextPack(nodes, evidence, graph, {
    focus: normalized.focus,
    contextBudget: normalized.contextBudget,
  });

  const summaryFocus = focusNode ? `${focusNode.kind} ${focusNode.label}` : "overview";
  return {
    overview: {
      focus: normalized.focus,
      scope: normalized.scope,
      depth: normalized.depth,
      contextBudget: normalized.contextBudget,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalEvidence: evidence.length,
    },
    focus: focusNode,
    nodes,
    edges,
    evidence,
    contextPack,
    summary: `Map for ${summaryFocus}: ${nodes.length} nodes, ${edges.length} edges, ${contextPack.tokenEstimate}/${contextPack.tokenBudget} context tokens.`,
  };
}
