"use client";

import type { GraphApiNode, GraphApiEdge } from "@/lib/types";
import { complexityLabel } from "@/lib/views";

function Metric({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <div className="flex justify-between py-1.5 text-xs border-b border-[#1a1a24]">
      <span className="text-[#888]">{label}</span>
      <span className="text-[#e0e0e0] font-medium" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function DetailPanel({
  node,
  edges,
  onClose,
  onNavigate,
  onFocus,
}: {
  node: GraphApiNode | null;
  edges: GraphApiEdge[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  onFocus: (nodeId: string) => void;
}): React.ReactElement | null {
  if (!node) return null;

  const imports = edges.filter((e) => e.source === node.id);
  const dependents = edges.filter((e) => e.target === node.id);
  const cxLabel = complexityLabel(node.cyclomaticComplexity);

  return (
    <div className="fixed top-[84px] right-3 w-[320px] max-h-[calc(100vh-96px)] rounded-[10px] bg-[rgba(15,15,25,0.95)] border border-[#222] p-5 overflow-y-auto z-50">
      <button
        onClick={onClose}
        className="absolute top-2 right-2 bg-transparent border-none text-[#666] cursor-pointer text-base"
      >
        &times;
      </button>
      <h2 className="text-sm text-white mb-3 break-all pr-4">{node.path}</h2>
      <Metric label="LOC" value={String(node.loc)} />
      <Metric label="Module" value={node.module} />
      <Metric label="PageRank" value={node.pageRank.toFixed(4)} />
      <Metric label="Betweenness" value={node.betweenness.toFixed(3)} />
      <Metric label="Coupling" value={node.coupling.toFixed(2)} />
      <Metric label="Fan In" value={String(node.fanIn)} />
      <Metric label="Fan Out" value={String(node.fanOut)} />
      <Metric label="Tension" value={node.tension.toFixed(2)} />
      <Metric label="Bridge" value={node.isBridge ? "Yes" : "No"} />
      <Metric label="Churn" value={`${node.churn} commits`} />
      <Metric
        label="Complexity"
        value={`${node.cyclomaticComplexity.toFixed(1)} — ${cxLabel.text}`}
        color={cxLabel.color}
      />
      <Metric label="Blast Radius" value={String(node.blastRadius)} />
      <Metric label="Tests" value={node.hasTests ? (node.testFile || "Yes") : "None"} />

      {node.deadExports.length > 0 && (
        <>
          <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
            Dead Exports ({node.deadExports.length})
          </div>
          <div className="text-[11px] text-[#aaa]">
            {node.deadExports.map((name) => (
              <div key={name} className="py-0.5 text-[#ef4444]">
                {name}
              </div>
            ))}
          </div>
        </>
      )}

      {node.functions.length > 0 && (
        <>
          <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
            Exports ({node.functions.length})
          </div>
          <div className="text-[11px] text-[#aaa]">
            {node.functions.map((f) => (
              <div key={f.name} className="py-0.5">
                {f.name} ({f.loc} LOC)
                {f.fanIn !== undefined && (
                  <span className="text-[#666] ml-1">
                    in:{f.fanIn} out:{f.fanOut ?? 0} PR:{(f.pageRank ?? 0).toFixed(3)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
        Dependencies ({imports.length})
      </div>
      <div className="text-[11px] text-[#aaa]">
        {imports.length === 0 ? (
          <div className="py-0.5">None</div>
        ) : (
          imports.map((e) => (
            <div
              key={e.target}
              className="py-0.5 cursor-pointer hover:text-[#2563eb]"
              onClick={() => { onNavigate(e.target); }}
            >
              {e.target} [{e.symbols.join(", ")}]
            </div>
          ))
        )}
      </div>

      <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
        Dependents ({dependents.length})
      </div>
      <div className="text-[11px] text-[#aaa]">
        {dependents.length === 0 ? (
          <div className="py-0.5">None</div>
        ) : (
          dependents.map((e) => (
            <div
              key={e.source}
              className="py-0.5 cursor-pointer hover:text-[#2563eb]"
              onClick={() => { onNavigate(e.source); }}
            >
              {e.source} [{e.symbols.join(", ")}]
            </div>
          ))
        )}
      </div>

      <div className="mt-2">
        <button
          onClick={() => { onFocus(node.id); }}
          className="px-2.5 py-1 text-[11px] bg-[#2563eb] text-white border-none rounded cursor-pointer"
        >
          Focus View
        </button>
      </div>
    </div>
  );
}
