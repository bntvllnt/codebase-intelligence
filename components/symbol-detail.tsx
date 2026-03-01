"use client";

import type { SymbolApiNode, CallApiEdge } from "@/lib/types";

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between py-1.5 text-xs border-b border-[#1a1a24]">
      <span className="text-[#888]">{label}</span>
      <span className="text-[#e0e0e0] font-medium">{value}</span>
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  function: "#2563eb",
  class: "#16a34a",
  interface: "#9333ea",
  type: "#ea580c",
  enum: "#ca8a04",
  variable: "#6b7280",
};

export function SymbolDetailPanel({
  symbol,
  callEdges,
  onClose,
}: {
  symbol: SymbolApiNode | null;
  callEdges: CallApiEdge[];
  onClose: () => void;
}): React.ReactElement | null {
  if (!symbol) return null;

  const callers = callEdges
    .filter((e) => e.target === symbol.id)
    .map((e) => ({ symbol: e.callerSymbol, file: e.source.split("::")[0] }));

  const callees = callEdges
    .filter((e) => e.source === symbol.id)
    .map((e) => ({ symbol: e.calleeSymbol, file: e.target.split("::")[0] }));

  const typeColor = TYPE_COLORS[symbol.type] ?? "#6b7280";

  return (
    <div className="fixed top-[84px] right-3 w-[320px] max-h-[calc(100vh-96px)] rounded-[10px] bg-[rgba(15,15,25,0.95)] border border-[#222] p-5 overflow-y-auto z-50">
      <button
        onClick={onClose}
        className="absolute top-2 right-2 bg-transparent border-none text-[#666] cursor-pointer text-base"
      >
        &times;
      </button>
      <h2 className="text-sm text-white mb-1 break-all pr-4">{symbol.name}</h2>
      <div className="text-[11px] mb-3" style={{ color: typeColor }}>
        {symbol.type}
      </div>
      <Metric label="File" value={symbol.file} />
      <Metric label="LOC" value={String(symbol.loc)} />
      <Metric label="Fan In" value={String(symbol.fanIn)} />
      <Metric label="Fan Out" value={String(symbol.fanOut)} />
      <Metric label="PageRank" value={symbol.pageRank.toFixed(4)} />
      <Metric label="Betweenness" value={symbol.betweenness.toFixed(3)} />

      <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
        Callers ({callers.length})
      </div>
      <div className="text-[11px] text-[#aaa]">
        {callers.length === 0 ? (
          <div className="py-0.5">None</div>
        ) : (
          callers.map((c, i) => (
            <div key={`${c.file}::${c.symbol}-${i}`} className="py-0.5">
              {c.symbol} <span className="text-[#666]">({c.file})</span>
            </div>
          ))
        )}
      </div>

      <div className="text-[11px] text-[#2563eb] uppercase mt-4 mb-1.5">
        Callees ({callees.length})
      </div>
      <div className="text-[11px] text-[#aaa]">
        {callees.length === 0 ? (
          <div className="py-0.5">None</div>
        ) : (
          callees.map((c, i) => (
            <div key={`${c.file}::${c.symbol}-${i}`} className="py-0.5">
              {c.symbol} <span className="text-[#666]">({c.file})</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
