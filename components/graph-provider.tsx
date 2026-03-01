"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useGraphData } from "@/hooks/use-graph-data";
import { useGraphConfig } from "@/hooks/use-graph-config";
import type { GraphApiNode, GraphApiResponse, ForceApiResponse, GroupMetrics, GraphConfig, ViewType } from "@/lib/types";

interface StalenessInfo {
  stale: boolean;
  indexedHash: string;
}

interface GraphContextValue {
  graphData: GraphApiResponse | undefined;
  forceData: ForceApiResponse | undefined;
  groupData: GroupMetrics[] | undefined;
  projectName: string;
  staleness: StalenessInfo | undefined;
  isLoading: boolean;
  error: Error | undefined;
  config: GraphConfig;
  setConfig: (key: keyof GraphConfig, value: number | string | boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedNode: GraphApiNode | null;
  setSelectedNode: (node: GraphApiNode | null) => void;
  focusNodeId: string | null;
  setFocusNodeId: (id: string | null) => void;
  handleNodeClick: (node: GraphApiNode) => void;
  handleNavigate: (nodeId: string) => void;
  handleFocus: (nodeId: string) => void;
  handleSearch: (nodeId: string) => void;
}

const GraphContext = createContext<GraphContextValue | null>(null);

export function useGraphContext(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("useGraphContext must be used within GraphProvider");
  return ctx;
}

export function GraphProvider({ children }: { children: React.ReactNode }) {
  const { graphData, forceData, groupData, projectName, staleness, isLoading, error } = useGraphData();
  const { config, setConfig } = useGraphConfig();
  const [currentView, setCurrentView] = useState<ViewType>("galaxy");
  const [selectedNode, setSelectedNode] = useState<GraphApiNode | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (projectName) {
      document.title = `${projectName} — Codebase Visualizer`;
    }
  }, [projectName]);

  const handleNodeClick = useCallback((node: GraphApiNode) => {
    setSelectedNode(node);
  }, []);

  const handleNavigate = useCallback(
    (nodeId: string) => {
      const node = graphData?.nodes.find((n) => n.id === nodeId);
      if (node) setSelectedNode(node);
    },
    [graphData],
  );

  const handleFocus = useCallback((nodeId: string) => {
    setFocusNodeId(nodeId);
    setCurrentView("focus");
  }, []);

  const handleSearch = useCallback(
    (nodeId: string) => {
      window.dispatchEvent(new CustomEvent("search-fly", { detail: nodeId }));
      const node = graphData?.nodes.find((n) => n.id === nodeId);
      if (node) setSelectedNode(node);
    },
    [graphData],
  );

  return (
    <GraphContext.Provider
      value={{
        graphData,
        forceData,
        groupData,
        projectName,
        staleness,
        isLoading,
        error,
        config,
        setConfig,
        currentView,
        setCurrentView,
        selectedNode,
        setSelectedNode,
        focusNodeId,
        setFocusNodeId,
        handleNodeClick,
        handleNavigate,
        handleFocus,
        handleSearch,
      }}
    >
      {children}
    </GraphContext.Provider>
  );
}
