"use client";

import { useState, useMemo, useCallback, type ChangeEvent } from "react";
import type { GraphApiNode } from "@/lib/types";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  fileNode?: GraphApiNode;
}

function buildTree(nodes: GraphApiNode[]): TreeNode {
  const root: TreeNode = { name: "root", path: "", children: [] };

  for (const node of nodes) {
    if (node.type !== "file") continue;
    const parts = node.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          fileNode: isFile ? node : undefined,
        };
        current.children.push(child);
      } else if (isFile) {
        child.fileNode = node;
      }

      current = child;
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aIsDir = a.children.length > 0 && !a.fileNode;
    const bIsDir = b.children.length > 0 && !b.fileNode;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    sortTree(child);
  }
}

function filterTree(node: TreeNode, query: string): TreeNode | null {
  if (!query) return node;
  const q = query.toLowerCase();

  if (node.fileNode && node.path.toLowerCase().includes(q)) {
    return { ...node, children: [] };
  }

  const filteredChildren = node.children
    .map((c) => filterTree(c, query))
    .filter((c): c is TreeNode => c !== null);

  if (filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }

  return null;
}

function TreeItem({
  node,
  depth,
  onSelect,
  expandedPaths,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (nodeId: string) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}): React.ReactElement | null {
  const isDir = node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => { onToggle(node.path); }}
          className="w-full flex items-center gap-1 py-0.5 px-1 text-[11px] text-[#aaa] hover:bg-[rgba(255,255,255,0.05)] rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <span className="text-[9px] w-3">{isExpanded ? "v" : ">"}</span>
          <span className="truncate">{node.name}</span>
          <span className="text-[#555] ml-auto text-[9px]">{countFiles(node)}</span>
        </button>
        {isExpanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => { if (node.fileNode) onSelect(node.fileNode.id); }}
      className="w-full flex items-center gap-1 py-0.5 px-1 text-[11px] text-[#ccc] hover:bg-[rgba(37,99,235,0.15)] rounded transition-colors"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <span className="text-[9px] w-3 text-[#555]">-</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function countFiles(node: TreeNode): number {
  if (node.fileNode && node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

export function FileTree({
  nodes,
  onSelect,
  isOpen,
  onTogglePanel,
}: {
  nodes: GraphApiNode[];
  onSelect: (nodeId: string) => void;
  isOpen: boolean;
  onTogglePanel: () => void;
}): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const filteredTree = useMemo(
    () => (filter ? filterTree(tree, filter) : tree),
    [tree, filter],
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allPaths = new Set<string>();
    function collect(node: TreeNode): void {
      if (node.children.length > 0) {
        allPaths.add(node.path);
        for (const child of node.children) collect(child);
      }
    }
    collect(tree);
    setExpandedPaths(allPaths);
  }, [tree]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={onTogglePanel}
        className="fixed left-3 top-16 z-[90] px-2 py-1.5 text-[10px] bg-[rgba(10,10,15,0.85)] text-[#888] border border-[#222] rounded-[8px] backdrop-blur-xl hover:text-[#ccc] hover:border-[#444] transition-colors"
      >
        Files
      </button>
    );
  }

  return (
    <div className="fixed left-3 top-16 z-[90] w-[220px] max-h-[calc(100vh-100px)] bg-[rgba(10,10,15,0.92)] border border-[#222] rounded-[10px] backdrop-blur-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#222]">
        <span className="text-[10px] text-[#888] font-medium uppercase tracking-wider">Files</span>
        <div className="flex gap-1">
          <button
            onClick={handleExpandAll}
            className="text-[9px] text-[#666] hover:text-[#aaa] transition-colors px-1"
            title="Expand all"
          >
            ++
          </button>
          <button
            onClick={handleCollapseAll}
            className="text-[9px] text-[#666] hover:text-[#aaa] transition-colors px-1"
            title="Collapse all"
          >
            --
          </button>
          <button
            onClick={onTogglePanel}
            className="text-[9px] text-[#666] hover:text-[#aaa] transition-colors px-1"
          >
            x
          </button>
        </div>
      </div>
      <div className="px-2 py-1 border-b border-[#222]">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setFilter(e.target.value); }}
          className="w-full px-2 py-1 text-[10px] bg-transparent text-[#ccc] border border-[#333] rounded outline-none focus:border-[#2563eb]"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {filteredTree?.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={0}
            onSelect={onSelect}
            expandedPaths={expandedPaths}
            onToggle={handleToggle}
          />
        ))}
        {(!filteredTree || filteredTree.children.length === 0) && (
          <div className="text-[10px] text-[#555] text-center py-4">No matches</div>
        )}
      </div>
    </div>
  );
}
