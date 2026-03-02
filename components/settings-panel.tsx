"use client";

import type { GraphConfig } from "@/lib/types";

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="mb-2.5">
      <label className="flex justify-between text-[11px] text-[#888] mb-0.5">
        {label}
        <span className="text-[#e0e0e0] font-medium min-w-[32px] text-right">{format(value)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => { onChange(parseFloat(e.target.value)); }}
        className="w-full h-1 appearance-none bg-[#333] rounded outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2563eb] [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

export function SettingsPanel({
  config,
  onChange,
}: {
  config: GraphConfig;
  onChange: (key: keyof GraphConfig, value: number | string | boolean) => void;
}): React.ReactElement {
  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[240px] bg-[rgba(15,15,25,0.85)] border border-[#222] rounded-[10px] p-5 backdrop-blur-xl">
      <div className="text-xs font-semibold text-white mb-4 uppercase tracking-wider">Settings</div>

      <div className="text-[10px] text-[#2563eb] uppercase mb-1 tracking-wider">Nodes</div>
      <Slider label="Opacity" value={config.nodeOpacity} min={0.1} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => { onChange("nodeOpacity", v); }} />
      <Slider label="Size" value={config.nodeSize} min={0.2} max={3} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => { onChange("nodeSize", v); }} />
      <Slider label="Dim Isolated" value={config.isolatedDim} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => { onChange("isolatedDim", v); }} />

      <div className="text-[10px] text-[#2563eb] uppercase mt-4 mb-2 tracking-wider">Links</div>
      <div className="flex items-center justify-between text-[11px] text-[#888] mb-2.5">
        <span className="text-[#e0e0e0]">Color</span>
        <input
          type="color"
          value={config.linkColor}
          onChange={(e) => { onChange("linkColor", e.target.value); }}
          className="w-8 h-5 border border-[#333] rounded bg-transparent cursor-pointer p-0"
        />
      </div>
      <Slider label="Opacity" value={config.linkOpacity} min={0.05} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => { onChange("linkOpacity", v); }} />
      <Slider label="Width" value={config.linkWidth} min={0.1} max={3} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => { onChange("linkWidth", v); }} />

      <div className="text-[10px] text-[#2563eb] uppercase mt-4 mb-2 tracking-wider">Grouping</div>
      <label className="flex items-center gap-2 text-[11px] text-[#888] mb-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={config.showModuleBoxes}
          onChange={(e) => { onChange("showModuleBoxes", e.target.checked); }}
          className="accent-[#2563eb] cursor-pointer"
        />
        <span className="text-[#e0e0e0]">Module Clouds</span>
      </label>
      <Slider label="Cloud Opacity" value={config.boxOpacity} min={0.05} max={0.8} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => { onChange("boxOpacity", v); }} />
      <Slider label="Cluster Strength" value={config.clusterStrength} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => { onChange("clusterStrength", v); }} />

      <div className="text-[10px] text-[#2563eb] uppercase mt-4 mb-2 tracking-wider">Physics</div>
      <Slider label="Repulsion" value={config.charge} min={-200} max={-5} step={5} format={(v) => String(Math.round(v))} onChange={(v) => { onChange("charge", v); }} />
      <Slider label="Distance" value={config.distance} min={30} max={500} step={10} format={(v) => String(Math.round(v))} onChange={(v) => { onChange("distance", v); }} />
    </div>
  );
}
