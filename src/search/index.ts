import type { CodebaseGraph } from "../types/index.js";

interface SearchDocument {
  file: string;
  symbols: Array<{ name: string; type: string; loc: number }>;
  terms: string[];
}

interface SearchResult {
  file: string;
  score: number;
  symbols: Array<{ name: string; type: string; loc: number; score: number }>;
}

export interface SearchIndex {
  documents: SearchDocument[];
  idf: Map<string, number>;
  avgDl: number;
  terms: Set<string>;
}

/** Split camelCase/PascalCase/snake_case into lowercase tokens */
export function tokenize(text: string): string[] {
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./\\]/g, " ")
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  return parts;
}

/** Build BM25 search index from a CodebaseGraph */
export function createSearchIndex(graph: CodebaseGraph): SearchIndex {
  const documents: SearchDocument[] = [];

  // Group symbols by file
  const fileSymbols = new Map<string, Array<{ name: string; type: string; loc: number }>>();
  for (const node of graph.nodes) {
    if (node.type === "file") continue;
    const file = node.parentFile ?? node.path;
    const existing = fileSymbols.get(file) ?? [];
    existing.push({ name: node.label, type: node.type, loc: node.loc });
    fileSymbols.set(file, existing);
  }

  // Also add from symbolNodes (call graph symbols)
  for (const sym of graph.symbolNodes) {
    const existing = fileSymbols.get(sym.file) ?? [];
    if (!existing.some((s) => s.name === sym.name)) {
      existing.push({ name: sym.name, type: sym.type, loc: sym.loc });
      fileSymbols.set(sym.file, existing);
    }
  }

  // Build documents — one per file
  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    const symbols = fileSymbols.get(node.id) ?? [];
    const terms = [
      ...tokenize(node.id),
      ...tokenize(node.label),
      ...symbols.flatMap((s) => tokenize(s.name)),
    ];
    documents.push({ file: node.id, symbols, terms });
  }

  // Compute IDF: log((N - n + 0.5) / (n + 0.5) + 1)
  const N = documents.length;
  const df = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(doc.terms);
    for (const term of unique) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  const allTerms = new Set<string>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N - count + 0.5) / (count + 0.5) + 1));
    allTerms.add(term);
  }

  const avgDl = documents.reduce((sum, d) => sum + d.terms.length, 0) / Math.max(N, 1);

  return { documents, idf, avgDl, terms: allTerms };
}

/** BM25 search. Returns results sorted by relevance, grouped by file. */
export function search(index: SearchIndex, query: string, limit = 20): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const k1 = 1.5;
  const b = 0.75;

  const results: SearchResult[] = [];

  for (const doc of index.documents) {
    // Term frequency map for this document
    const tf = new Map<string, number>();
    for (const term of doc.terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }

    const dl = doc.terms.length;
    let docScore = 0;

    for (const qt of queryTerms) {
      const termIdf = index.idf.get(qt) ?? 0;
      const termTf = tf.get(qt) ?? 0;
      if (termTf === 0) continue;

      const numerator = termTf * (k1 + 1);
      const denominator = termTf + k1 * (1 - b + b * (dl / index.avgDl));
      docScore += termIdf * (numerator / denominator);
    }

    if (docScore > 0) {
      // Score individual symbols too
      const symbolScores = doc.symbols.map((sym) => {
        const symTerms = tokenize(sym.name);
        let symScore = 0;
        for (const qt of queryTerms) {
          if (symTerms.includes(qt)) symScore += 1;
        }
        return { ...sym, score: symScore };
      }).filter((s) => s.score > 0)
        .sort((a, b_s) => b_s.score - a.score);

      results.push({
        file: doc.file,
        score: Math.round(docScore * 1000) / 1000,
        symbols: symbolScores.length > 0
          ? symbolScores
          : doc.symbols.map((s) => ({ ...s, score: 0 })),
      });
    }
  }

  return results.sort((a, b_r) => b_r.score - a.score).slice(0, limit);
}

/** Get suggestion alternatives when search returns no results */
export function getSuggestions(index: SearchIndex, query: string, maxSuggestions = 5): string[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Find terms in the index that are similar (prefix match or edit distance)
  const scored: Array<{ term: string; score: number }> = [];

  for (const indexTerm of index.terms) {
    let bestScore = 0;
    for (const qt of queryTerms) {
      // Prefix match
      if (indexTerm.startsWith(qt) || qt.startsWith(indexTerm)) {
        const overlap = Math.min(qt.length, indexTerm.length);
        const maxLen = Math.max(qt.length, indexTerm.length);
        bestScore = Math.max(bestScore, overlap / maxLen);
      }
    }
    if (bestScore > 0.3) {
      scored.push({ term: indexTerm, score: bestScore });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
    .map((s) => s.term);
}
