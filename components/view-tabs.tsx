"use client";

import type { ViewType } from "@/lib/types";

const VIEWS: Array<{ key: ViewType; label: string }> = [
  { key: "galaxy", label: "Galaxy" },
  { key: "depflow", label: "Dep Flow" },
  { key: "hotspot", label: "Hotspot" },
  { key: "focus", label: "Focus" },
  { key: "module", label: "Module" },
  { key: "forces", label: "Forces" },
  { key: "churn", label: "Churn" },
  { key: "coverage", label: "Coverage" },
  { key: "symbols", label: "Symbols" },
  { key: "types", label: "Types" },
];

export function ViewTabs({
  current,
  onChange,
}: {
  current: ViewType;
  onChange: (view: ViewType) => void;
}): React.ReactElement {
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1 bg-[rgba(10,10,15,0.85)] border border-[#222] rounded-[10px] p-1.5 backdrop-blur-xl">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => { onChange(v.key); }}
          className={`px-3 py-1.5 text-[11px] rounded-md border-0 cursor-pointer transition-all ${
            current === v.key
              ? "bg-[#2563eb] text-white"
              : "bg-transparent text-[#888] hover:bg-[#252530] hover:text-[#ccc]"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
