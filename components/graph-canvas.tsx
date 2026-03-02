"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type {
  GraphApiNode,
  GraphApiEdge,
  GraphConfig,
  ForceApiResponse,
  ViewType,
  SymbolGraphResponse,
  SymbolApiNode,
} from "@/lib/types";
import {
  galaxyView,
  depFlowView,
  hotspotView,
  focusView,
  moduleView,
  forcesView,
  churnView,
  coverageView,
  symbolView,
  typesView,
  getModuleColor,
} from "@/lib/views";
import { cloudGroup } from "@/src/cloud-group";
import { createClusterForce } from "@/lib/cluster-force";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D = dynamic(() => import("react-force-graph-3d") as any, {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-[#888]">
      Loading 3D graph...
    </div>
  ),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

interface CloudEntry {
  mesh: THREE.Mesh;
  wire: THREE.LineSegments;
  label: THREE.Sprite;
}

export function GraphCanvas({
  nodes,
  edges,
  config,
  currentView,
  focusNodeId,
  forceData,
  circularDeps,
  symbolData,
  selectedGroups,
  onNodeClick,
  onSymbolClick,
}: {
  nodes: GraphApiNode[];
  edges: GraphApiEdge[];
  config: GraphConfig;
  currentView: ViewType;
  focusNodeId: string | null;
  forceData: ForceApiResponse | undefined;
  circularDeps: string[][];
  symbolData: SymbolGraphResponse | undefined;
  selectedGroups: Set<string>;
  onNodeClick: (node: GraphApiNode) => void;
  onSymbolClick: (symbol: SymbolApiNode) => void;
}): React.ReactElement {
  const fgRef = useRef<ForceGraph3DInstance | undefined>(undefined);
  const cloudsRef = useRef(new Map<string, CloudEntry>());
  const configRef = useRef(config);
  configRef.current = config;
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref to the node objects passed to ForceGraph3D — the library mutates these in-place with x/y/z
  const fgNodesRef = useRef<Array<Record<string, unknown>>>([]);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const graphData = useMemo(() => {
    switch (currentView) {
      case "galaxy":
        return galaxyView(nodes, edges, config);
      case "depflow":
        return depFlowView(nodes, edges, config, circularDeps);
      case "hotspot":
        return hotspotView(nodes, edges, config);
      case "focus":
        return focusView(nodes, edges, config, focusNodeId ?? (nodes[0]?.id || ""));
      case "module":
        return moduleView(nodes, edges, config, nodeById);
      case "forces":
        return forcesView(
          nodes, edges, config,
          forceData ?? { moduleCohesion: [], tensionFiles: [], bridgeFiles: [], extractionCandidates: [], summary: "" },
          nodeById,
        );
      case "churn":
        return churnView(nodes, edges, config);
      case "coverage":
        return coverageView(nodes, edges, config);
      case "symbols":
        return symbolData
          ? symbolView(symbolData.symbolNodes, symbolData.callEdges, config)
          : { nodes: [], links: [] };
      case "types":
        return symbolData
          ? typesView(symbolData.symbolNodes, symbolData.callEdges, config)
          : { nodes: [], links: [] };
      default:
        return galaxyView(nodes, edges, config);
    }
  }, [nodes, edges, config, currentView, focusNodeId, forceData, circularDeps, nodeById, symbolData]);

  // Build stable node/link objects for ForceGraph3D — store refs for tick handler access
  const fgGraphData = useMemo(() => {
    const fgNodes = graphData.nodes.map((n) => ({ ...n } as Record<string, unknown>));
    const fgLinks = graphData.links.map((l) => ({ ...l }));
    fgNodesRef.current = fgNodes;
    return { nodes: fgNodes, links: fgLinks };
  }, [graphData]);

  // Window dimensions
  useEffect(() => {
    function handleResize(): void {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); };
  }, []);

  // Apply physics forces when config changes
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge && typeof charge.strength === "function") {
      charge.strength(config.charge);
    }
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") {
      link.distance(config.distance);
    }
    fg.d3ReheatSimulation();
  }, [config.charge, config.distance]);

  // Cluster force — update strength when slider changes (registration happens in handleEngineTick)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cluster = fg.d3Force("cluster");
    if (cluster && typeof cluster.strength === "function") {
      cluster.strength(config.clusterStrength);
      fg.d3ReheatSimulation();
    }
  }, [config.clusterStrength]);

  // Module clouds — stable tick handler using refs
  const clearClouds = useCallback((fg: ForceGraph3DInstance) => {
    if (cloudsRef.current.size === 0) return;
    try {
      const scene = fg.scene();
      cloudsRef.current.forEach((obj) => {
        obj.mesh.geometry.dispose();
        (obj.mesh.material as THREE.Material).dispose();
        scene.remove(obj.mesh);
        obj.wire.geometry.dispose();
        (obj.wire.material as THREE.Material).dispose();
        scene.remove(obj.wire);
        const spriteMat = obj.label.material;
        spriteMat.map?.dispose();
        spriteMat.dispose();
        scene.remove(obj.label);
      });
    } catch { /* scene destroyed */ }
    cloudsRef.current.clear();
  }, []);

  const handleEngineTick = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cfg = configRef.current;

    // Register cluster force on first tick (fgRef is guaranteed live here)
    if (!fg.d3Force("cluster")) {
      const cluster = createClusterForce(
        (node) => {
          const mod = (node.module as string | undefined)?.startsWith(".worktrees/")
            ? undefined
            : (node.module as string) || undefined;
          return mod ? cloudGroup(mod) : undefined;
        },
        cfg.clusterStrength,
      );
      fg.d3Force("cluster", cluster);
    }

    if (!cfg.showModuleBoxes) {
      if (cloudsRef.current.size > 0) clearClouds(fg);
      if (containerRef.current) containerRef.current.dataset.cloudCount = "0";
      return;
    }

    try {
      const scene = fg.scene();
      const camera = fg.camera();

      // Zoom-based opacity: fade clouds when camera is close
      const camDist = camera.position.length();
      const fadeNear = 150;
      const fadeFar = 500;
      const zoomFade = Math.min(1, Math.max(0, (camDist - fadeNear) / (fadeFar - fadeNear)));

      // Read node positions from fgNodesRef — the library mutates these in-place
      const fgNodes = fgNodesRef.current;
      const groups = new Map<string, Array<Record<string, unknown>>>();

      fgNodes.forEach((n) => {
        if (n.x === undefined) return;
        const rawMod = (n.module as string | undefined)?.startsWith(".worktrees/")
          ? undefined
          : (n.module as string) || "unknown";
        if (!rawMod) return;
        const group = cloudGroup(rawMod);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)?.push(n);
      });

      // Dynamic minimum: small projects need fewer files per cloud
      const totalNodes = fgNodes.length;
      const minFiles = totalNodes > 100 ? 3 : totalNodes > 20 ? 2 : 2;

      const active = new Set<string>();
      groups.forEach((moduleNodes, mod) => {
        if (moduleNodes.length < minFiles) return;
        active.add(mod);

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        moduleNodes.forEach((n) => {
          const x = n.x as number, y = n.y as number, z = n.z as number;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        });

        const pad = 20;
        const rx = Math.max((maxX - minX) / 2 + pad, 12);
        const ry = Math.max((maxY - minY) / 2 + pad, 12);
        const rz = Math.max((maxZ - minZ) / 2 + pad, 12);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;

        const baseOpacity = cfg.boxOpacity * zoomFade;
        const existing = cloudsRef.current.get(mod);
        if (existing) {
          existing.mesh.position.set(cx, cy, cz);
          existing.mesh.scale.set(rx, ry, rz);
          (existing.mesh.material as THREE.MeshPhongMaterial).opacity = baseOpacity * 0.3;
          existing.wire.position.set(cx, cy, cz);
          existing.wire.scale.set(rx, ry, rz);
          (existing.wire.material as THREE.LineBasicMaterial).opacity = baseOpacity * 0.5;
          existing.label.position.set(cx, maxY + pad + 8, cz);
          existing.label.material.opacity = zoomFade;
          const labelScale = Math.max(rx, ry, rz) * 1.2;
          existing.label.scale.set(labelScale, labelScale * 0.1875, 1);
        } else {
          const color = getModuleColor(mod);

          // Solid cloud with Phong shading — responds to scene lights
          const geo = new THREE.BoxGeometry(2, 2, 2);
          const mat = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity: baseOpacity * 0.3,
            depthWrite: false,
            side: THREE.DoubleSide,
            shininess: 20,
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.15,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(cx, cy, cz);
          mesh.scale.set(rx, ry, rz);
          mesh.renderOrder = -1;
          scene.add(mesh);

          // Wireframe overlay for 3D depth cues — EdgesGeometry for clean 12-edge box outline
          const wireMat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: baseOpacity * 0.5,
            depthWrite: false,
          });
          const wireframe = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            wireMat,
          );
          wireframe.position.set(cx, cy, cz);
          wireframe.scale.set(rx, ry, rz);
          wireframe.renderOrder = -1;
          scene.add(wireframe);

          // Label: short folder name (last segment)
          const shortName = mod.replace(/\/$/, "").split("/").pop() ?? mod;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (ctx) {
            canvas.width = 512; canvas.height = 96;
            ctx.font = "bold 48px Inter, -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 8;
            ctx.strokeText(shortName, 256, 48);
            ctx.fillStyle = "#fff";
            ctx.fillText(shortName, 256, 48);
          }
          const texture = new THREE.CanvasTexture(canvas);
          const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: zoomFade });
          const label = new THREE.Sprite(spriteMat);
          const labelScale = Math.max(rx, ry, rz) * 1.2;
          label.scale.set(labelScale, labelScale * 0.1875, 1);
          label.position.set(cx, maxY + pad + 8, cz);
          scene.add(label);

          cloudsRef.current.set(mod, { mesh, wire: wireframe, label });
        }
      });

      cloudsRef.current.forEach((obj, mod) => {
        if (!active.has(mod)) {
          obj.mesh.geometry.dispose();
          (obj.mesh.material as THREE.Material).dispose();
          scene.remove(obj.mesh);
          obj.wire.geometry.dispose();
          (obj.wire.material as THREE.Material).dispose();
          scene.remove(obj.wire);
          const spriteMat = obj.label.material;
          spriteMat.map?.dispose();
          spriteMat.dispose();
          scene.remove(obj.label);
          cloudsRef.current.delete(mod);
        }
      });

      if (containerRef.current) {
        containerRef.current.dataset.cloudCount = String(cloudsRef.current.size);
      }
    } catch { /* scene not ready */ }
  }, [clearClouds]);

  // Cleanup clouds on unmount
  useEffect(() => {
    return () => {
      const fg = fgRef.current;
      if (fg) clearClouds(fg);
    };
  }, [clearClouds]);

  // Search fly: listen for custom event
  useEffect(() => {
    function handleSearchFly(e: Event): void {
      const nodeId = (e as CustomEvent<string>).detail;
      const fg = fgRef.current;
      if (!fg || !nodeId) return;
      const target = fgNodesRef.current.find((n) => n.id === nodeId);
      if (target?.x !== undefined) {
        fg.cameraPosition(
          { x: (target.x as number) + 100, y: (target.y as number) + 100, z: (target.z as number) + 100 },
          { x: target.x as number, y: target.y as number, z: target.z as number },
          1000,
        );
      }
    }
    window.addEventListener("search-fly", handleSearchFly);
    return () => { window.removeEventListener("search-fly", handleSearchFly); };
  }, []);

  const symbolById = useMemo(
    () => new Map(symbolData?.symbolNodes.map((s) => [s.id, s]) ?? []),
    [symbolData],
  );

  const isSymbolView = currentView === "symbols" || currentView === "types";

  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => {
      const id = node.id as string;
      if (isSymbolView) {
        const sym = symbolById.get(id);
        if (sym) onSymbolClick(sym);
      } else {
        const apiNode = nodeById.get(id);
        if (apiNode) onNodeClick(apiNode);
      }
    },
    [nodeById, symbolById, onNodeClick, onSymbolClick, isSymbolView],
  );

  const showEmptyPlaceholder =
    isSymbolView && symbolData?.symbolNodes.length === 0;

  if (showEmptyPlaceholder) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-[#888] text-lg">No symbols found</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-screen h-screen" data-cloud-count="0">
      <ForceGraph3D
        ref={fgRef}
        graphData={fgGraphData}
        nodeLabel={(n: Record<string, unknown>) =>
          isSymbolView
            ? `${n.label as string} (${n.path as string})`
            : `${n.path as string} (${n.loc as number} LOC)`
        }
        nodeColor={(n: Record<string, unknown>) => {
          if (selectedGroups.size === 0) return n.color as string;
          const mod = (n.module as string) || "";
          return selectedGroups.has(cloudGroup(mod)) ? (n.color as string) : "#1a1a24";
        }}
        nodeVal={(n: Record<string, unknown>) => {
          if (selectedGroups.size === 0) return n.size as number;
          const mod = (n.module as string) || "";
          return selectedGroups.has(cloudGroup(mod)) ? (n.size as number) : 0.3;
        }}
        nodeOpacity={config.nodeOpacity}
        linkColor={(l: Record<string, unknown>) => {
          if (selectedGroups.size === 0) return l.color as string;
          const src = l.source as Record<string, unknown> | string;
          const tgt = l.target as Record<string, unknown> | string;
          const srcMod = typeof src === "object" ? (src.module as string) || "" : "";
          const tgtMod = typeof tgt === "object" ? (tgt.module as string) || "" : "";
          const srcIn = selectedGroups.has(cloudGroup(srcMod));
          const tgtIn = selectedGroups.has(cloudGroup(tgtMod));
          return srcIn && tgtIn ? (l.color as string) : "rgba(30,30,40,0.1)";
        }}
        linkWidth={(l: Record<string, unknown>) => l.width as number}
        linkOpacity={config.linkOpacity}
        backgroundColor="#0a0a0f"
        onNodeClick={handleNodeClick}
        onEngineTick={handleEngineTick}
        dagMode={currentView === "depflow" ? "td" : undefined}
        dagLevelDistance={currentView === "depflow" ? 50 : undefined}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
}
