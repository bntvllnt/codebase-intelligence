import { createHash } from "node:crypto";
import { detectEntryPoints } from "../process/index.js";
import type { CallConfidence, CodebaseGraph, SymbolNode } from "../types/index.js";

export type HighwayOpportunityKind = "bypass" | "cowpath";

export interface HighwayStep {
  id: string;
  file: string;
  symbol: string;
}

export interface HighwayRoute {
  id: string;
  operation: string;
  shape?: string;
  entryPoint: HighwayStep;
  sink: HighwayStep;
  steps: HighwayStep[];
  includesCanonical: boolean;
  confidence: CallConfidence;
}

export interface HighwayContextPack {
  summary: string;
  affectedRoutes: string[];
  evidence: string[];
  blastRadius: number;
  proposedCanonicalNode: HighwayStep;
  nextSafeCommand: string;
}

export interface HighwayOpportunity {
  id: string;
  kind: HighwayOpportunityKind;
  operation: string;
  shape?: string;
  sink: HighwayStep;
  canonicalNode: HighwayStep;
  routes: HighwayRoute[];
  bypassRoutes: HighwayRoute[];
  duplicatedCallees?: HighwayStep[];
  evidence: string[];
  blastRadius: number;
  recommendation: string;
  contextPack: HighwayContextPack;
}

export interface HighwaysOptions {
  operation?: string;
  shape?: string;
  minRoutes?: number;
  propose?: boolean;
  trace?: string;
}

export interface HighwaysTrace {
  id: string;
  found: boolean;
  opportunity?: HighwayOpportunity;
}

export interface HighwaysResult {
  totalRoutes: number;
  totalSinks: number;
  totalOpportunities: number;
  operation?: string;
  shape?: string;
  minRoutes: number;
  opportunities: HighwayOpportunity[];
  trace?: HighwaysTrace;
  summary: string;
}

interface RouteCandidate {
  operation: string;
  shape?: string;
  entryPoint: HighwayStep;
  sink: HighwayStep;
  steps: HighwayStep[];
  confidence: CallConfidence;
}

interface EdgeTarget {
  target: string;
  confidence: CallConfidence;
}

const KNOWN_OPERATION_VERBS = [
  "create",
  "update",
  "delete",
  "get",
  "list",
  "validate",
  "authenticate",
  "send",
  "publish",
  "save",
  "load",
  "fetch",
  "parse",
  "format",
  "render",
  "handle",
  "process",
  "normalize",
  "calculate",
  "build",
  "run",
  "write",
  "read",
] as const;

const PRIMITIVE_TYPES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Map",
  "Number",
  "Promise",
  "Record",
  "Set",
  "String",
  "boolean",
  "never",
  "null",
  "number",
  "string",
  "undefined",
  "unknown",
  "void",
]);

function hashId(parts: readonly string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 10);
}

function splitWords(value: string): string[] {
  return value
    .replace(/^[^.]+\./, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function normalizedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function symbolHasOperation(symbol: string, operation: string): boolean {
  return splitWords(symbol).includes(operation.toLowerCase());
}

function inferOperation(steps: readonly HighwayStep[], requested?: string): string {
  if (requested) return requested;
  for (const step of steps) {
    const words = splitWords(step.symbol);
    const verb = KNOWN_OPERATION_VERBS.find((candidate) => words.includes(candidate));
    if (verb) return verb;
  }
  return "unknown";
}

function symbolStep(symbol: SymbolNode): HighwayStep {
  return { id: symbol.id, file: symbol.file, symbol: symbol.name };
}

function collectTypeNames(symbols: readonly SymbolNode[]): string[] {
  const names = new Set<string>();
  for (const symbol of symbols) {
    const facts = symbol.typeFacts;
    if (!facts) continue;
    for (const name of [...facts.consumes, ...facts.produces]) {
      if (!PRIMITIVE_TYPES.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

function inferShape(symbols: readonly SymbolNode[], requested?: string): string | undefined {
  if (requested) return requested;
  return collectTypeNames(symbols)[0];
}

function routeMatchesShape(symbols: readonly SymbolNode[], requestedShape: string | undefined): boolean {
  if (!requestedShape) return true;
  return collectTypeNames(symbols).includes(requestedShape);
}

function maxConfidence(left: CallConfidence, right: CallConfidence): CallConfidence {
  return left === "type-resolved" || right === "type-resolved" ? "type-resolved" : "text-inferred";
}

function buildSymbolMap(graph: CodebaseGraph): Map<string, SymbolNode> {
  return new Map(graph.symbolNodes.map((symbol) => [symbol.id, symbol]));
}

function buildOutEdges(graph: CodebaseGraph): Map<string, EdgeTarget[]> {
  const outEdges = new Map<string, EdgeTarget[]>();
  for (const edge of graph.callEdges) {
    const targets = outEdges.get(edge.source) ?? [];
    targets.push({ target: edge.target, confidence: edge.confidence });
    outEdges.set(edge.source, targets);
  }
  for (const targets of outEdges.values()) {
    targets.sort((left, right) => left.target.localeCompare(right.target));
  }
  return outEdges;
}

function routeId(steps: readonly HighwayStep[]): string {
  return `route-${hashId(steps.map((step) => `${step.file}::${step.symbol}`))}`;
}

function toHighwayRoute(candidate: RouteCandidate, canonicalNode: HighwayStep): HighwayRoute {
  return {
    id: routeId(candidate.steps),
    operation: candidate.operation,
    shape: candidate.shape,
    entryPoint: candidate.entryPoint,
    sink: candidate.sink,
    steps: candidate.steps,
    includesCanonical: candidate.steps.some((step) => step.id === canonicalNode.id),
    confidence: candidate.confidence,
  };
}

function enumerateRoutes(graph: CodebaseGraph, options: HighwaysOptions): RouteCandidate[] {
  const requestedOperation = normalizedOptional(options.operation);
  const requestedShape = options.shape?.trim();
  const symbolsById = buildSymbolMap(graph);
  const outEdges = buildOutEdges(graph);
  const routes: RouteCandidate[] = [];
  const maxDepth = 8;

  for (const entryPoint of detectEntryPoints(graph)) {
    const entrySymbol = symbolsById.get(entryPoint.symbolId);
    if (!entrySymbol) continue;

    const visit = (
      currentId: string,
      currentSteps: SymbolNode[],
      visited: ReadonlySet<string>,
      confidence: CallConfidence,
    ): void => {
      const targets = outEdges.get(currentId) ?? [];
      const nextTargets = targets.filter((target) => !visited.has(target.target) && symbolsById.has(target.target));
      if (nextTargets.length === 0 || currentSteps.length >= maxDepth) {
        const steps = currentSteps.map(symbolStep);
        const operation = inferOperation(steps, requestedOperation);
        if (requestedOperation && !steps.some((step) => symbolHasOperation(step.symbol, requestedOperation))) return;
        if (!routeMatchesShape(currentSteps, requestedShape)) return;
        const sink = steps[steps.length - 1];
        routes.push({
          operation,
          shape: inferShape(currentSteps, requestedShape),
          entryPoint: steps[0],
          sink,
          steps,
          confidence,
        });
        return;
      }

      for (const target of nextTargets) {
        const targetSymbol = symbolsById.get(target.target);
        if (!targetSymbol) continue;
        const nextVisited = new Set(visited);
        nextVisited.add(target.target);
        visit(
          target.target,
          [...currentSteps, targetSymbol],
          nextVisited,
          maxConfidence(confidence, target.confidence),
        );
      }
    };

    visit(entryPoint.symbolId, [entrySymbol], new Set([entryPoint.symbolId]), "text-inferred");
  }

  return routes.sort((left, right) =>
    left.sink.file.localeCompare(right.sink.file)
    || left.sink.symbol.localeCompare(right.sink.symbol)
    || left.entryPoint.symbol.localeCompare(right.entryPoint.symbol)
    || routeId(left.steps).localeCompare(routeId(right.steps))
  );
}

function selectCanonicalNode(routes: readonly RouteCandidate[], operation: string): HighwayStep | undefined {
  const candidates = new Map<string, { step: HighwayStep; routeCount: number; operationMatch: boolean }>();
  for (const route of routes) {
    const seenInRoute = new Set<string>();
    for (const step of route.steps.slice(1, -1)) {
      if (seenInRoute.has(step.id)) continue;
      seenInRoute.add(step.id);
      const existing = candidates.get(step.id);
      const operationMatch = symbolHasOperation(step.symbol, operation);
      if (existing) {
        candidates.set(step.id, {
          step,
          routeCount: existing.routeCount + 1,
          operationMatch: existing.operationMatch || operationMatch,
        });
      } else {
        candidates.set(step.id, { step, routeCount: 1, operationMatch });
      }
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.routeCount < routes.length)
    .sort((left, right) =>
      Number(right.operationMatch) - Number(left.operationMatch)
      || right.routeCount - left.routeCount
      || left.step.file.localeCompare(right.step.file)
      || left.step.symbol.localeCompare(right.step.symbol)
    )[0]?.step;
}

function directCallees(outEdges: Map<string, EdgeTarget[]>, symbolsById: Map<string, SymbolNode>, symbolId: string): HighwayStep[] {
  return (outEdges.get(symbolId) ?? [])
    .map((edge) => symbolsById.get(edge.target))
    .filter((symbol): symbol is SymbolNode => Boolean(symbol))
    .map(symbolStep)
    .sort((left, right) => left.file.localeCompare(right.file) || left.symbol.localeCompare(right.symbol));
}

function uniqueSteps(steps: readonly HighwayStep[]): HighwayStep[] {
  const byId = new Map<string, HighwayStep>();
  for (const step of steps) byId.set(step.id, step);
  return [...byId.values()].sort((left, right) => left.file.localeCompare(right.file) || left.symbol.localeCompare(right.symbol));
}

function createContextPack(
  kind: HighwayOpportunityKind,
  operation: string,
  sink: HighwayStep,
  canonicalNode: HighwayStep,
  bypassRoutes: readonly HighwayRoute[],
  evidence: readonly string[],
  blastRadius: number,
): HighwayContextPack {
  const affectedRoutes = [...new Set(bypassRoutes.map((route) => route.entryPoint.symbol))].sort();
  return {
    summary: `${kind} routes for ${operation} reach ${sink.symbol} without ${canonicalNode.symbol}.`,
    affectedRoutes,
    evidence: [...evidence],
    blastRadius,
    proposedCanonicalNode: canonicalNode,
    nextSafeCommand: `codebase-intelligence impact . ${canonicalNode.symbol}`,
  };
}

function createOpportunity(
  kind: HighwayOpportunityKind,
  operation: string,
  shape: string | undefined,
  sink: HighwayStep,
  canonicalNode: HighwayStep,
  routes: HighwayRoute[],
  bypassRoutes: HighwayRoute[],
  duplicatedCallees?: HighwayStep[],
): HighwayOpportunity {
  const routeFiles = new Set(routes.flatMap((route) => route.steps.map((step) => step.file)));
  const blastRadius = routeFiles.size;
  const evidence = [
    `operation=${operation}`,
    shape ? `shape=${shape}` : "",
    `sink=${sink.file}::${sink.symbol}`,
    `canonical=${canonicalNode.file}::${canonicalNode.symbol}`,
    `routes=${routes.length}`,
    `bypasses=${bypassRoutes.length}`,
    duplicatedCallees && duplicatedCallees.length > 0
      ? `duplicatedCallees=${duplicatedCallees.map((step) => step.symbol).join(",")}`
      : "",
  ].filter(Boolean);
  const id = `hwy-${kind}-${hashId([kind, operation, shape ?? "", sink.id, canonicalNode.id])}`;
  const routeNames = [...new Set(bypassRoutes.map((route) => route.entryPoint.symbol))].sort();
  const recommendation = `Route ${routeNames.join(", ")} through ${canonicalNode.symbol} before ${sink.symbol}.`;
  return {
    id,
    kind,
    operation,
    shape,
    sink,
    canonicalNode,
    routes,
    bypassRoutes,
    duplicatedCallees,
    evidence,
    blastRadius,
    recommendation,
    contextPack: createContextPack(kind, operation, sink, canonicalNode, bypassRoutes, evidence, blastRadius),
  };
}

function routeGroupKey(route: RouteCandidate): string {
  return [route.sink.id, route.operation, route.shape ?? ""].join("\0");
}

function createOpportunities(graph: CodebaseGraph, routes: readonly RouteCandidate[], minRoutes: number): HighwayOpportunity[] {
  const routesByGroup = new Map<string, RouteCandidate[]>();
  for (const route of routes) {
    const sinkRoutes = routesByGroup.get(routeGroupKey(route)) ?? [];
    sinkRoutes.push(route);
    routesByGroup.set(routeGroupKey(route), sinkRoutes);
  }

  const symbolsById = buildSymbolMap(graph);
  const outEdges = buildOutEdges(graph);
  const opportunities: HighwayOpportunity[] = [];

  for (const sinkRoutes of routesByGroup.values()) {
    if (sinkRoutes.length < minRoutes) continue;
    const operation = sinkRoutes[0]?.operation ?? "unknown";
    const canonicalNode = selectCanonicalNode(sinkRoutes, operation);
    if (!canonicalNode) continue;
    const routesForSink = sinkRoutes.map((route) => toHighwayRoute(route, canonicalNode));
    const bypassRoutes = routesForSink.filter((route) => !route.includesCanonical);
    if (bypassRoutes.length === 0) continue;
    const sink = routesForSink[0]?.sink;
    const shape = sinkRoutes.find((route) => route.shape)?.shape;

    opportunities.push(createOpportunity("bypass", operation, shape, sink, canonicalNode, routesForSink, bypassRoutes));

    const canonicalCallees = directCallees(outEdges, symbolsById, canonicalNode.id);
    const canonicalCalleeIds = new Set(canonicalCallees.map((step) => step.id));
    const duplicated = uniqueSteps(
      bypassRoutes.flatMap((route) => directCallees(outEdges, symbolsById, route.entryPoint.id))
        .filter((step) => canonicalCalleeIds.has(step.id)),
    );
    if (duplicated.length >= 2) {
      opportunities.push(createOpportunity("cowpath", operation, shape, sink, canonicalNode, routesForSink, bypassRoutes, duplicated));
    }
  }

  return opportunities.sort((left, right) =>
    right.bypassRoutes.length - left.bypassRoutes.length
    || right.blastRadius - left.blastRadius
    || left.sink.file.localeCompare(right.sink.file)
    || left.sink.symbol.localeCompare(right.sink.symbol)
    || left.kind.localeCompare(right.kind)
  );
}

/**
 * Analyze repeated call routes that should converge on one canonical operation path.
 */
export function computeHighways(graph: CodebaseGraph, options: HighwaysOptions = {}): HighwaysResult {
  const minRoutes = options.minRoutes ?? 2;
  const normalizedOptions = {
    ...options,
    operation: normalizedOptional(options.operation),
    shape: options.shape?.trim(),
    minRoutes,
  };
  const routes = enumerateRoutes(graph, normalizedOptions);
  const opportunities = createOpportunities(graph, routes, minRoutes);
  const sinks = new Set(routes.map((route) => route.sink.id));
  const trace = normalizedOptions.trace
    ? {
      id: normalizedOptions.trace,
      found: opportunities.some((opportunity) => opportunity.id === normalizedOptions.trace),
      opportunity: opportunities.find((opportunity) => opportunity.id === normalizedOptions.trace),
    }
    : undefined;

  const visibleOpportunities = trace?.found && trace.opportunity ? [trace.opportunity] : opportunities;

  return {
    totalRoutes: routes.length,
    totalSinks: sinks.size,
    totalOpportunities: opportunities.length,
    operation: normalizedOptions.operation,
    shape: normalizedOptions.shape,
    minRoutes,
    opportunities: visibleOpportunities,
    trace,
    summary: opportunities.length > 0
      ? `${opportunities.length} highway opportunities across ${sinks.size} sinks.`
      : "No highway opportunities found.",
  };
}
