import type {
  GraphApiNode,
  GraphApiEdge,
  GraphConfig,
  ForceApiResponse,
  RenderNode,
  RenderLink,
  SymbolApiNode,
  CallApiEdge,
} from "./types";

const MODULE_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
  "#0891b2", "#ca8a04", "#e11d48", "#4f46e5", "#059669",
];

const moduleColorMap = new Map<string, string>();
let colorIdx = 0;

export function getModuleColor(mod: string): string {
  if (!moduleColorMap.has(mod)) {
    moduleColorMap.set(mod, MODULE_COLORS[colorIdx % MODULE_COLORS.length]);
    colorIdx++;
  }
  return moduleColorMap.get(mod) ?? MODULE_COLORS[0];
}

function isIsolated(n: GraphApiNode): boolean {
  return n.fanIn === 0 && n.fanOut === 0;
}

function dimColor(hex: string, factor: number): string {
  if (hex.startsWith("#")) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }
  if (hex.startsWith("rgb")) {
    const m = hex.match(/(\d+)/g);
    if (!m) return hex;
    return `rgb(${Math.round(+m[0] * factor)},${Math.round(+m[1] * factor)},${Math.round(+m[2] * factor)})`;
  }
  return hex;
}

function nodeColor(n: GraphApiNode, base: string, cfg: GraphConfig): string {
  return isIsolated(n) ? dimColor(base, cfg.isolatedDim) : base;
}

function nodeSize(n: GraphApiNode, base: number, cfg: GraphConfig): number {
  return (isIsolated(n) ? base * cfg.isolatedDim : base) * cfg.nodeSize;
}

export function linkRgba(cfg: GraphConfig, alpha?: number): string {
  const h = cfg.linkColor;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha ?? cfg.linkOpacity})`;
}

export function healthColor(score: number): string {
  const r = Math.min(255, Math.floor(score * 2 * 255));
  const g = Math.min(255, Math.floor((1 - score) * 2 * 255));
  return `rgb(${r},${g},60)`;
}

export function complexityLabel(val: number): { text: string; color: string } {
  if (val <= 5) return { text: "Simple", color: "#16a34a" };
  if (val <= 10) return { text: "Moderate", color: "#ca8a04" };
  if (val <= 20) return { text: "Complex", color: "#ea580c" };
  return { text: "Very Complex", color: "#dc2626" };
}

function toRenderNode(n: GraphApiNode, color: string, size: number): RenderNode {
  return { ...n, color, size };
}

function toRenderLink(source: string, target: string, color: string, width: number): RenderLink {
  return { source, target, color, width };
}

export function galaxyView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  return {
    nodes: nodes.map((n) => {
      const base = getModuleColor(n.module);
      return toRenderNode(n, nodeColor(n, base, cfg), nodeSize(n, 2 + Math.sqrt(n.pageRank * 10000), cfg));
    }),
    links: edges.map((e) =>
      toRenderLink(e.source, e.target, e.isTypeOnly ? linkRgba(cfg, 0.4) : linkRgba(cfg, 0.6), cfg.linkWidth),
    ),
  };
}

export function depFlowView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
  circularDeps: string[][],
): { nodes: RenderNode[]; links: RenderLink[] } {
  const circularPairs = new Set<string>();
  circularDeps.forEach((cycle) => {
    for (let i = 0; i < cycle.length - 1; i++) {
      circularPairs.add(`${cycle[i]}->${cycle[i + 1]}`);
    }
  });

  return {
    nodes: nodes.map((n) => {
      const base = getModuleColor(n.module);
      return toRenderNode(n, nodeColor(n, base, cfg), nodeSize(n, 2 + Math.sqrt(n.pageRank * 10000), cfg));
    }),
    links: edges.map((e) => {
      const isCircular =
        circularPairs.has(`${e.source}->${e.target}`) || circularPairs.has(`${e.target}->${e.source}`);
      return toRenderLink(
        e.source,
        e.target,
        isCircular ? "rgba(220,38,38,0.8)" : linkRgba(cfg, 0.6),
        isCircular ? 2 : cfg.linkWidth,
      );
    }),
  };
}

export function hotspotView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  return {
    nodes: nodes.map((n) => {
      const base = healthColor(n.coupling);
      return toRenderNode(n, nodeColor(n, base, cfg), nodeSize(n, 1 + n.loc / 20, cfg));
    }),
    links: edges.map((e) => toRenderLink(e.source, e.target, linkRgba(cfg, 0.5), cfg.linkWidth)),
  };
}

export function focusView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
  targetId: string,
): { nodes: RenderNode[]; links: RenderLink[] } {
  const neighbors = new Set<string>([targetId]);
  edges.forEach((e) => {
    if (e.source === targetId) neighbors.add(e.target);
    if (e.target === targetId) neighbors.add(e.source);
  });
  const hop2 = new Set(neighbors);
  edges.forEach((e) => {
    if (neighbors.has(e.source)) hop2.add(e.target);
    if (neighbors.has(e.target)) hop2.add(e.source);
  });

  return {
    nodes: nodes.map((n) => {
      const inFocus = hop2.has(n.id);
      const color =
        n.id === targetId
          ? "#fbbf24"
          : neighbors.has(n.id)
            ? getModuleColor(n.module)
            : inFocus
              ? getModuleColor(n.module)
              : "#1a1a24";
      const size =
        (n.id === targetId ? 8 : neighbors.has(n.id) ? 4 : inFocus ? 2 : 0.5) * cfg.nodeSize;
      return toRenderNode(n, color, size);
    }),
    links: edges.map((e) =>
      toRenderLink(
        e.source,
        e.target,
        hop2.has(e.source) && hop2.has(e.target) ? linkRgba(cfg, 0.7) : linkRgba(cfg, 0.1),
        cfg.linkWidth,
      ),
    ),
  };
}

export function moduleView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
  nodeById: Map<string, GraphApiNode>,
): { nodes: RenderNode[]; links: RenderLink[] } {
  return {
    nodes: nodes.map((n) => {
      const base = getModuleColor(n.module);
      return toRenderNode(n, nodeColor(n, base, cfg), nodeSize(n, 2 + Math.sqrt(n.pageRank * 10000), cfg));
    }),
    links: edges.map((e) => {
      const sn = nodeById.get(e.source);
      const tn = nodeById.get(e.target);
      const crossModule = sn !== undefined && tn !== undefined && sn.module !== tn.module;
      return toRenderLink(
        e.source,
        e.target,
        crossModule ? "rgba(255,200,50,0.5)" : linkRgba(cfg, 0.4),
        crossModule ? 1.5 : cfg.linkWidth,
      );
    }),
  };
}

export function forcesView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
  forceData: ForceApiResponse,
  nodeById: Map<string, GraphApiNode>,
): { nodes: RenderNode[]; links: RenderLink[] } {
  const tensionSet = new Set(forceData.tensionFiles.map((t) => t.file));
  const bridgeSet = new Set(forceData.bridgeFiles.map((b) => b.file));
  const junkModules = new Set(forceData.moduleCohesion.filter((m) => m.verdict === "JUNK_DRAWER").map((m) => m.path));
  const extractModules = new Set(forceData.extractionCandidates.map((e) => e.target));

  return {
    nodes: nodes.map((n) => {
      let color = getModuleColor(n.module);
      let size = 2 + Math.sqrt(n.pageRank * 10000);
      if (tensionSet.has(n.id)) { color = "#fbbf24"; size *= 1.5; }
      else if (bridgeSet.has(n.id)) { color = "#06b6d4"; size *= 1.3; }
      else if (junkModules.has(n.module)) { color = "#ef4444"; }
      else if (extractModules.has(n.module)) { color = "#22c55e"; }
      return toRenderNode(n, nodeColor(n, color, cfg), nodeSize(n, size, cfg));
    }),
    links: edges.map((e) => {
      const sn = nodeById.get(e.source);
      const tn = nodeById.get(e.target);
      const crossModule = sn !== undefined && tn !== undefined && sn.module !== tn.module;
      return toRenderLink(
        e.source,
        e.target,
        crossModule ? "rgba(239,68,68,0.4)" : linkRgba(cfg, 0.4),
        crossModule ? 1 : cfg.linkWidth,
      );
    }),
  };
}

export function churnView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  const maxChurn = Math.max(1, ...nodes.map((n) => n.churn));

  return {
    nodes: nodes.map((n) => {
      const score = n.churn / maxChurn;
      return toRenderNode(n, nodeColor(n, healthColor(score), cfg), nodeSize(n, 2 + (n.churn / maxChurn) * 6, cfg));
    }),
    links: edges.map((e) => toRenderLink(e.source, e.target, linkRgba(cfg, 0.4), cfg.linkWidth)),
  };
}

export function coverageView(
  nodes: GraphApiNode[],
  edges: GraphApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  return {
    nodes: nodes.map((n) => {
      const base = n.hasTests ? "#16a34a" : "#dc2626";
      return toRenderNode(n, nodeColor(n, base, cfg), nodeSize(n, 2 + Math.sqrt(n.pageRank * 10000), cfg));
    }),
    links: edges.map((e) => toRenderLink(e.source, e.target, linkRgba(cfg, 0.4), cfg.linkWidth)),
  };
}

const SYMBOL_TYPE_COLORS: Record<string, string> = {
  function: "#2563eb",
  class: "#16a34a",
  interface: "#9333ea",
  type: "#ea580c",
  enum: "#ca8a04",
  variable: "#6b7280",
};

function symbolTypeColor(type: string): string {
  return SYMBOL_TYPE_COLORS[type] ?? "#6b7280";
}

function symbolModule(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/") + "/";
}

function toSymbolRenderNode(
  s: SymbolApiNode,
  color: string,
  size: number,
): RenderNode {
  return {
    id: s.id,
    path: s.file,
    label: s.name,
    module: symbolModule(s.file),
    loc: s.loc,
    pageRank: s.pageRank,
    betweenness: s.betweenness,
    coupling: 0,
    fanIn: s.fanIn,
    fanOut: s.fanOut,
    tension: 0,
    isBridge: false,
    churn: 0,
    cyclomaticComplexity: 0,
    blastRadius: 0,
    deadExports: [],
    hasTests: false,
    testFile: "",
    functions: [],
    color,
    size,
  };
}

export function symbolView(
  symbolNodes: SymbolApiNode[],
  callEdges: CallApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  const nodeIds = new Set(symbolNodes.map((s) => s.id));
  const validEdges = callEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return {
    nodes: symbolNodes.map((s) => {
      const color = symbolTypeColor(s.type);
      const size = (2 + Math.sqrt(s.pageRank * 10000)) * cfg.nodeSize;
      return toSymbolRenderNode(s, color, size);
    }),
    links: validEdges.map((e) =>
      toRenderLink(
        e.source,
        e.target,
        e.confidence === "type-resolved" ? linkRgba(cfg, 0.6) : linkRgba(cfg, 0.3),
        cfg.linkWidth,
      ),
    ),
  };
}

export function typesView(
  symbolNodes: SymbolApiNode[],
  callEdges: CallApiEdge[],
  cfg: GraphConfig,
): { nodes: RenderNode[]; links: RenderLink[] } {
  const typeKinds = new Set(["interface", "type", "enum"]);
  const typeNodes = symbolNodes.filter((s) => typeKinds.has(s.type));
  const typeIds = new Set(typeNodes.map((s) => s.id));
  const typeEdges = callEdges.filter((e) => typeIds.has(e.source) && typeIds.has(e.target));

  return {
    nodes: typeNodes.map((s) => {
      const color = symbolTypeColor(s.type);
      const size = (2 + Math.sqrt(s.pageRank * 10000)) * cfg.nodeSize;
      return toSymbolRenderNode(s, color, size);
    }),
    links: typeEdges.map((e) =>
      toRenderLink(e.source, e.target, linkRgba(cfg, 0.5), cfg.linkWidth),
    ),
  };
}

export const LEGENDS: Record<string, Array<{ color: string; label: string }>> = {
  galaxy: [{ color: "", label: "Node color = module | Size = importance (PageRank)" }],
  depflow: [
    { color: "", label: "Top = entry points | Bottom = leaf deps" },
    { color: "#dc2626", label: "Red edges = circular deps" },
  ],
  hotspot: [
    { color: "#16a34a", label: "Green = healthy" },
    { color: "#ea580c", label: "Orange = moderate" },
    { color: "#dc2626", label: "Red = high coupling" },
  ],
  focus: [
    { color: "#fbbf24", label: "Yellow = selected" },
    { color: "", label: "Bright = neighbors | Faded = distant" },
  ],
  module: [
    { color: "", label: "Color = module" },
    { color: "#fbbf24", label: "Yellow edges = cross-module deps" },
  ],
  forces: [
    { color: "#fbbf24", label: "Tension" },
    { color: "#06b6d4", label: "Bridge" },
    { color: "#ef4444", label: "Junk drawer" },
    { color: "#22c55e", label: "Extraction candidate" },
  ],
  churn: [
    { color: "#16a34a", label: "Green = stable" },
    { color: "#ea580c", label: "Orange = moderate" },
    { color: "#dc2626", label: "Red = high churn" },
  ],
  coverage: [
    { color: "#16a34a", label: "Green = has tests" },
    { color: "#dc2626", label: "Red = untested" },
  ],
  symbols: [
    { color: "#2563eb", label: "Blue = function" },
    { color: "#16a34a", label: "Green = class" },
    { color: "#9333ea", label: "Purple = interface" },
    { color: "#ea580c", label: "Orange = type" },
    { color: "#ca8a04", label: "Yellow = enum" },
  ],
  types: [
    { color: "#9333ea", label: "Purple = interface" },
    { color: "#ea580c", label: "Orange = type" },
    { color: "#ca8a04", label: "Yellow = enum" },
  ],
};
