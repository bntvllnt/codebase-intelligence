"use client";

import { useState } from "react";
import { GraphProvider, useGraphContext } from "@/components/graph-provider";
import { GraphCanvas } from "@/components/graph-canvas";
import { ProjectBar } from "@/components/project-bar";
import { ViewTabs } from "@/components/view-tabs";
import { SearchInput } from "@/components/search-input";
import { DetailPanel } from "@/components/detail-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { Legend } from "@/components/legend";
import { FileTree } from "@/components/file-tree";
import { StaleBanner } from "@/components/stale-banner";

function App(): React.ReactElement | null {
  const {
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
    handleNodeClick,
    handleNavigate,
    handleFocus,
    handleSearch,
  } = useGraphContext();

  const [fileTreeOpen, setFileTreeOpen] = useState(false);

  if (error) {
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <div className="text-[#ef4444] text-center p-10 text-base">
          Failed to load graph data: {error.message}
        </div>
      </div>
    );
  }

  if (isLoading || !graphData) {
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <div className="text-[#888] text-base">Loading codebase graph...</div>
      </div>
    );
  }

  return (
    <>
      <StaleBanner staleness={staleness} />
      <ProjectBar projectName={projectName} graphData={graphData} forceData={forceData} />
      <ViewTabs current={currentView} onChange={setCurrentView} />
      <SearchInput onSearch={handleSearch} />
      <FileTree
        nodes={graphData.nodes}
        onSelect={handleSearch}
        isOpen={fileTreeOpen}
        onTogglePanel={() => { setFileTreeOpen((prev) => !prev); }}
      />
      <GraphCanvas
        nodes={graphData.nodes}
        edges={graphData.edges}
        config={config}
        currentView={currentView}
        focusNodeId={focusNodeId}
        forceData={forceData}
        circularDeps={graphData.stats.circularDeps}
        onNodeClick={handleNodeClick}
      />
      <DetailPanel
        node={selectedNode}
        edges={graphData.edges}
        onClose={() => { setSelectedNode(null); }}
        onNavigate={handleNavigate}
        onFocus={handleFocus}
      />
      <Legend view={currentView} groups={groupData} showClouds={config.showModuleBoxes} />
      <SettingsPanel config={config} onChange={setConfig} />
    </>
  );
}

export default function Home(): React.ReactElement {
  return (
    <GraphProvider>
      <App />
    </GraphProvider>
  );
}
