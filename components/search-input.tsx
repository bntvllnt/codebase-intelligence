"use client";

import { useState, useCallback, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from "react";

interface SearchResult {
  file: string;
  score: number;
  symbols: Array<{ name: string; type: string; loc: number; relevance: number }>;
}

export function SearchInput({
  onSearch,
}: {
  onSearch: (nodeId: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchResults = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
      if (!res.ok) return;
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(data.results);
      setIsOpen(data.results.length > 0);
      setSelectedIndex(-1);
    } catch {
      /* network error — ignore */
    }
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void fetchResults(value);
      }, 200);
    },
    [fetchResults],
  );

  const handleSelect = useCallback(
    (file: string) => {
      onSearch(file);
      setIsOpen(false);
      setQuery("");
      setResults([]);
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelect(results[selectedIndex].file);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    },
    [isOpen, results, selectedIndex, handleSelect],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => { document.removeEventListener("mousedown", handleClickOutside); };
  }, []);

  return (
    <div ref={containerRef} className="fixed top-3 right-4 z-[100] w-[280px]">
      <input
        type="text"
        placeholder="Search files & symbols..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        className="w-full px-4 py-2 text-xs bg-[rgba(10,10,15,0.85)] text-[#e0e0e0] border border-[#222] rounded-[10px] outline-none backdrop-blur-xl focus:border-[#2563eb]"
      />
      {isOpen && results.length > 0 && (
        <div className="mt-1 max-h-[300px] overflow-y-auto bg-[rgba(10,10,15,0.95)] border border-[#333] rounded-[8px] backdrop-blur-xl">
          {results.map((r, i) => (
            <button
              key={r.file}
              onClick={() => { handleSelect(r.file); }}
              className={`w-full text-left px-3 py-2 text-xs border-b border-[#222] last:border-b-0 hover:bg-[rgba(37,99,235,0.15)] transition-colors ${
                i === selectedIndex ? "bg-[rgba(37,99,235,0.2)]" : ""
              }`}
            >
              <div className="text-[#e0e0e0] truncate">{r.file}</div>
              {r.symbols.length > 0 && (
                <div className="text-[#666] text-[10px] mt-0.5 truncate">
                  {r.symbols.slice(0, 3).map((s) => s.name).join(", ")}
                  {r.symbols.length > 3 && ` +${r.symbols.length - 3}`}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
