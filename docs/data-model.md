# Data Model

All types defined in `src/types/index.ts`. This is the single source of truth.

## Parser Output

```typescript
ParsedFile {
  path: string            // Absolute filesystem path
  relativePath: string    // Relative to root (used as graph node ID)
  loc: number             // Lines of code
  exports: ParsedExport[] // Named exports
  imports: ParsedImport[] // Relative imports (external skipped)
  churn: number           // Git commit count (0 if non-git)
  isTestFile: boolean     // Matches *.test.ts / *.spec.ts / __tests__/
  testFile?: string       // Path to matching test file (for source files)
}

ParsedExport {
  name: string            // Export name ("default" for default exports)
  type: "function" | "class" | "variable" | "type" | "interface" | "enum"
  loc: number             // Lines of code for this export
  isDefault: boolean
  complexity: number      // Cyclomatic complexity (branch count, min 1)
}

ParsedImport {
  from: string            // Raw import path
  resolvedFrom: string    // Resolved relative path (after .js->.ts mapping)
  symbols: string[]       // Imported names (["default"] for default import)
  isTypeOnly: boolean     // import type { X }
}
```

## Graph Structure

```typescript
GraphNode {
  id: string              // = relativePath for files, parentFile+name for functions
  type: "file" | "function"
  path: string            // Display path
  label: string           // File basename or function name
  loc: number
  module: string          // Top-level directory (e.g., "src/parser/")
  parentFile?: string     // For function nodes: which file owns this
}

GraphEdge {
  source: string          // Importer file ID
  target: string          // Imported file ID
  symbols: string[]       // What's imported
  isTypeOnly: boolean     // Type-only import (no runtime dep)
  weight: number          // Edge weight (default 1)
}
```

## Computed Metrics

```typescript
FileMetrics {
  // Structural (from graph analysis)
  pageRank: number
  betweenness: number
  fanIn: number
  fanOut: number
  coupling: number        // fanOut / (max(fanIn, 1) + fanOut)
  tension: number         // Entropy of multi-module pulls
  isBridge: boolean       // betweenness > 0.1

  // Behavioral (from git + filesystem)
  churn: number           // Git commit count
  hasTests: boolean       // Test file exists
  testFile: string        // Path to test file ("" if none)

  // Quality (from AST + graph analysis)
  cyclomaticComplexity: number  // Avg complexity of exports
  blastRadius: number           // Transitive dependent count
  deadExports: string[]         // Unused export names
  isTestFile: boolean           // Whether this file is a test file
}

ModuleMetrics {
  path: string
  files: number
  loc: number
  exports: number
  internalDeps: number
  externalDeps: number
  cohesion: number        // internalDeps / totalDeps
  escapeVelocity: number  // Extraction readiness
  dependsOn: string[]     // Module paths this imports from
  dependedBy: string[]    // Module paths that import this
}
```

## CodebaseGraph (Top-Level)

```typescript
CodebaseGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  fileMetrics: Map<string, FileMetrics>
  moduleMetrics: Map<string, ModuleMetrics>
  forceAnalysis: ForceAnalysis
  stats: {
    totalFiles: number
    totalFunctions: number
    totalDependencies: number
    circularDeps: string[][]  // Each cycle = array of file paths
  }
}
```
