import Graph from "graphology";
import path from "path";
import type { ParsedFile, GraphNode, GraphEdge, CallEdge, SymbolNode } from "../types/index.js";

export interface BuiltGraph {
  graph: Graph;
  callGraph: Graph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  callEdges: CallEdge[];
  symbolNodes: SymbolNode[];
}

export function buildGraph(files: ParsedFile[]): BuiltGraph {
  const graph = new Graph({ multi: false, type: "directed" });
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileRelPaths = new Set(files.map((f) => f.relativePath));

  // Add file nodes
  for (const file of files) {
    const module = getModule(file.relativePath);
    const node: GraphNode = {
      id: file.relativePath,
      type: "file",
      path: file.relativePath,
      label: path.basename(file.relativePath),
      loc: file.loc,
      module,
    };

    graph.addNode(file.relativePath, {
      type: "file",
      label: node.label,
      loc: file.loc,
      module,
      exportCount: file.exports.length,
    });
    nodes.push(node);

    // Add function/class nodes to nodes array (NOT to file graph — avoids orphan dilution of PageRank)
    for (const exp of file.exports) {
      if (exp.type === "function" || exp.type === "class") {
        const funcId = `${file.relativePath}::${exp.name}`;
        nodes.push({
          id: funcId,
          type: exp.type,
          path: file.relativePath,
          label: exp.name,
          loc: exp.loc,
          module,
          parentFile: file.relativePath,
        });
      }
    }
  }

  // Add edges from imports
  for (const file of files) {
    for (const imp of file.imports) {
      const target = imp.resolvedFrom;
      if (!target || !fileRelPaths.has(target)) continue;
      if (file.relativePath === target) continue;

      if (!graph.hasEdge(file.relativePath, target)) {
        graph.addEdge(file.relativePath, target, {
          symbols: imp.symbols,
          isTypeOnly: imp.isTypeOnly,
          weight: imp.symbols.length || 1,
        });

        edges.push({
          source: file.relativePath,
          target,
          symbols: imp.symbols,
          isTypeOnly: imp.isTypeOnly,
          weight: imp.symbols.length || 1,
        });
      }
    }
  }

  // Add edges from test file associations (testFile metadata from parser)
  for (const file of files) {
    if (file.testFile && fileRelPaths.has(file.testFile)) {
      const testPath = file.testFile;
      const implPath = file.relativePath;
      // Edge: test -> impl (test depends on implementation)
      if (graph.hasNode(testPath) && !graph.hasEdge(testPath, implPath)) {
        graph.addEdge(testPath, implPath, {
          symbols: ["tests"],
          isTypeOnly: false,
          weight: 1,
        });
        edges.push({
          source: testPath,
          target: implPath,
          symbols: ["tests"],
          isTypeOnly: false,
          weight: 1,
        });
      }
    }
  }

  const callGraph = new Graph({ multi: false, type: "directed" });
  const callEdges: CallEdge[] = [];
  const symbolNodes: SymbolNode[] = [];
  const callGraphNodeIds = new Set<string>();

  // Build symbol nodes from all exported symbols (functions, classes, interfaces, types, enums)
  const symbolTypes = new Set(["function", "class", "interface", "type", "enum"]);
  for (const file of files) {
    for (const exp of file.exports) {
      if (symbolTypes.has(exp.type)) {
        const symbolId = `${file.relativePath}::${exp.name}`;
        symbolNodes.push({
          id: symbolId,
          name: exp.name,
          type: exp.type,
          file: file.relativePath,
          loc: exp.loc,
          isDefault: exp.isDefault,
        });
        if (!callGraphNodeIds.has(symbolId)) {
          callGraph.addNode(symbolId, { name: exp.name, type: exp.type, file: file.relativePath });
          callGraphNodeIds.add(symbolId);
        }
      }
    }
  }

  // Build call edges from callSites
  const symbolNodeIds = new Set(symbolNodes.map((s) => s.id));

  for (const file of files) {
    for (const cs of file.callSites) {
      // Skip edges involving node_modules (external dependencies not in symbolNodes)
      if (cs.calleeFile.includes("node_modules") || cs.callerFile.includes("node_modules")) continue;
      // Skip edges to files outside the project
      if (!fileRelPaths.has(cs.calleeFile)) continue;

      const sourceId = `${cs.callerFile}::${cs.callerSymbol}`;
      const targetId = `${cs.calleeFile}::${cs.calleeSymbol}`;

      // Add caller as symbol node if not already tracked (e.g., <module> scope, non-exported functions)
      if (!symbolNodeIds.has(sourceId) && fileRelPaths.has(cs.callerFile)) {
        symbolNodes.push({
          id: sourceId,
          name: cs.callerSymbol,
          type: "function",
          file: cs.callerFile,
          loc: 0,
          isDefault: false,
        });
        symbolNodeIds.add(sourceId);
      }

      // Add callee as symbol node if not already tracked
      if (!symbolNodeIds.has(targetId)) {
        symbolNodes.push({
          id: targetId,
          name: cs.calleeSymbol,
          type: "function",
          file: cs.calleeFile,
          loc: 0,
          isDefault: false,
        });
        symbolNodeIds.add(targetId);
      }

      if (!callGraphNodeIds.has(sourceId)) {
        callGraph.addNode(sourceId, { name: cs.callerSymbol, type: "function", file: cs.callerFile });
        callGraphNodeIds.add(sourceId);
      }
      if (!callGraphNodeIds.has(targetId)) {
        callGraph.addNode(targetId, { name: cs.calleeSymbol, type: "function", file: cs.calleeFile });
        callGraphNodeIds.add(targetId);
      }

      if (!callGraph.hasEdge(sourceId, targetId)) {
        callGraph.addEdge(sourceId, targetId, { confidence: cs.confidence });
        callEdges.push({
          source: sourceId,
          target: targetId,
          callerSymbol: cs.callerSymbol,
          calleeSymbol: cs.calleeSymbol,
          confidence: cs.confidence,
        });
      }
    }
  }

  return { graph, callGraph, nodes, edges, callEdges, symbolNodes };
}

function getModule(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join(path.sep) + path.sep;
}

export function detectCircularDeps(graph: Graph): string[][] {
  const MAX_CYCLES = 100;
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const fileNodes = graph.filterNodes((_node: string, attrs: Record<string, unknown>) => attrs.type === "file");

  for (const startNode of fileNodes) {
    if (cycles.length >= MAX_CYCLES) break;
    if (visited.has(startNode)) continue;

    const stack: Array<{ node: string; pathIndex: number; neighborIdx: number }> = [];
    const currentPath: string[] = [];
    const onStack = new Set<string>();

    stack.push({ node: startNode, pathIndex: 0, neighborIdx: 0 });
    currentPath.push(startNode);
    onStack.add(startNode);
    visited.add(startNode);

    while (stack.length > 0 && cycles.length < MAX_CYCLES) {
      const frame = stack[stack.length - 1];
      const neighbors = graph.outNeighbors(frame.node).filter(
        (n: string) => graph.getNodeAttribute(n, "type") === "file"
      );

      if (frame.neighborIdx >= neighbors.length) {
        stack.pop();
        currentPath.pop();
        onStack.delete(frame.node);
        continue;
      }

      const neighbor = neighbors[frame.neighborIdx];
      frame.neighborIdx++;

      if (onStack.has(neighbor)) {
        const cycleStart = currentPath.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...currentPath.slice(cycleStart), neighbor]);
        }
      } else if (!visited.has(neighbor)) {
        visited.add(neighbor);
        onStack.add(neighbor);
        currentPath.push(neighbor);
        stack.push({ node: neighbor, pathIndex: currentPath.length - 1, neighborIdx: 0 });
      }
    }
  }

  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const normalized = normalizeCycle(cycle);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeCycle(cycle: string[]): string {
  const withoutLast = cycle.slice(0, -1);
  const minIdx = withoutLast.indexOf(
    withoutLast.reduce((min, val) => (val < min ? val : min))
  );
  const rotated = [...withoutLast.slice(minIdx), ...withoutLast.slice(0, minIdx)];
  return rotated.join(" -> ");
}
