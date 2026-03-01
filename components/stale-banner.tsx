"use client";

interface StalenessInfo {
  stale: boolean;
  indexedHash: string;
}

export function StaleBanner({
  staleness,
}: {
  staleness: StalenessInfo | undefined;
}): React.ReactElement | null {
  if (!staleness?.stale) return null;

  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[110] px-4 py-1.5 text-[11px] bg-[rgba(234,179,8,0.15)] text-[#eab308] border border-[rgba(234,179,8,0.3)] rounded-full backdrop-blur-xl">
      Index may be stale — indexed at {staleness.indexedHash.slice(0, 7)}
    </div>
  );
}
