import useSWR from "swr";
import type { SymbolGraphResponse } from "@/lib/types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function useSymbolData(enabled: boolean): {
  symbolData: SymbolGraphResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, error, isLoading } = useSWR<SymbolGraphResponse>(
    enabled ? "/api/symbol-graph" : null,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  return { symbolData: data, isLoading, error };
}
