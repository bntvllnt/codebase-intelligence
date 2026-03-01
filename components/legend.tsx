"use client";

import type { ViewType, GroupMetrics } from "@/lib/types";
import { LEGENDS } from "@/lib/views";

export function Legend({
  view,
  groups,
  showClouds,
  selectedGroups,
  onToggleGroup,
}: {
  view: ViewType;
  groups: GroupMetrics[] | undefined;
  showClouds: boolean;
  selectedGroups: Set<string>;
  onToggleGroup: (name: string) => void;
}): React.ReactElement {
  const items = LEGENDS[view] ?? [];
  const showGroups = showClouds && groups && groups.length > 0;
  const hasSelection = selectedGroups.size > 0;

  return (
    <div
      className="fixed bottom-4 left-4 z-50 bg-[rgba(15,15,25,0.85)] border border-[#222] rounded-[10px] p-4 text-[11px] backdrop-blur-xl max-w-[260px] max-h-[70vh] overflow-y-auto pointer-events-auto"
      onPointerDown={(e) => { e.stopPropagation(); }}
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          {item.color && (
            <span
              className="w-2 h-2 rounded-full inline-block shrink-0"
              style={{ backgroundColor: item.color }}
            />
          )}
          <span>{item.label}</span>
        </div>
      ))}
      {showGroups && (
        <>
          <div className="border-t border-[#333] my-2" />
          <div className="text-[10px] text-[#666] mb-1 uppercase tracking-wider">
            Groups {hasSelection && <span className="text-[#888]">({selectedGroups.size} selected)</span>}
          </div>
          {groups.map((g) => {
            const isSelected = selectedGroups.has(g.name);
            const dimmed = hasSelection && !isSelected;
            return (
              <button
                type="button"
                key={g.name}
                data-group={g.name}
                className={`flex items-center gap-2 py-0.5 cursor-pointer rounded px-1 -mx-1 transition-colors w-full text-left text-[11px] bg-transparent border-0 text-inherit ${
                  isSelected ? "bg-[rgba(255,255,255,0.08)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                } ${dimmed ? "opacity-40" : ""}`}
                onClick={(e) => { e.stopPropagation(); onToggleGroup(g.name); }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm inline-block shrink-0 border"
                  style={{
                    backgroundColor: isSelected || !hasSelection ? g.color : "transparent",
                    borderColor: g.color,
                  }}
                />
                <span className="truncate">{g.name}</span>
                <span className="text-[#555] ml-auto shrink-0">
                  {g.files}f {(g.importance * 100).toFixed(0)}%
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
