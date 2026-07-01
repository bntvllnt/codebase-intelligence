# Data Model

Core graph types are defined in `src/types/index.ts`. Feature result envelopes live beside their analyzer modules.

## Parser Output

```typescript
ParsedFile {
  path: string            // Absolute filesystem path
  relativePath: string    // Relative to root (used as graph node ID)
  loc: number             // Lines of code
  exports: ParsedExport[] // Named exports
  symbols?: ParsedSymbol[] // Exported and local symbols with type facts
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
  typeFacts?: SymbolTypeFacts
  duplication?: SymbolDuplicationFacts
}

ParsedSymbol extends ParsedExport {
  isExported: boolean     // false for local class methods / helper symbols
}

SymbolTypeFacts {
  signature: string       // Compact display signature
  parameters: Array<{ name: string, type: string, optional: boolean, rest: boolean }>
  returnType?: string
  typeParameters: Array<{ name: string, constraint?: string, default?: string }>
  consumes: string[]      // Shape/type names read by parameters
  produces: string[]      // Shape/type names returned or declared
  confidence: "resolved" | "syntax"
}

SymbolDuplicationFacts {
  tokenCount: number
  tokens: Record<"strict" | "mild" | "weak", string[]> // Function-body token streams
  hashes: Record<"strict" | "mild" | "weak", string>  // Deterministic family grouping keys
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
  type: "file" | "function" | "class"
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

SymbolNode {
  id: string              // file::symbol
  name: string
  type: ParsedExport["type"]
  file: string
  loc: number
  isDefault: boolean
  complexity: number
  isExported?: boolean
  typeFacts?: SymbolTypeFacts
  duplication?: SymbolDuplicationFacts
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
  totalExports: number          // Named export count used as dead-export denominator
  isPackageEntrypoint: boolean  // package.json exports/main/types/bin point here
  packageEntrypointReason: string // package.json field/path evidence
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
  callEdges: CallEdge[]
  symbolNodes: SymbolNode[]
  symbolMetrics: Map<string, SymbolMetrics>
  fileMetrics: Map<string, FileMetrics>
  moduleMetrics: Map<string, ModuleMetrics>
  forceAnalysis: ForceAnalysis
  stats: {
    totalFiles: number
    totalFunctions: number
    totalDependencies: number
    circularDeps: string[][]  // Each cycle = array of file paths
    analysisMode: "full-program" | "ast-only"
    callGraphPrecision: "type-resolved" | "syntax-only"
    fullProgramFileLimit: number
  }
}
```

## CLI Cache Facts

Analysis commands with `--json` and `init --json` include this top-level `cache`
object. Paths are absolute.

```typescript
CacheFacts {
  cacheDir: string          // Canonical .codebase-intelligence/ directory
  legacyCacheDir: string    // Legacy .code-visualizer/ directory
  migrated: boolean         // true when legacy-only cache moved this run
  gitignoreUpdated: boolean // true when init --gitignore wrote/updated .gitignore
  warnings: string[]        // Non-fatal legacy/cache state warnings
}
```

## Codebase Map Result

`map --json`, MCP `get_codebase_map`, `get_scope_graph`, and `get_context_pack`
return deterministic graph/context data with stable evidence IDs.

```typescript
CodebaseMapResult {
  overview: {
    focus?: string
    scope?: string
    depth: number
    contextBudget: number
    totalNodes: number
    totalEdges: number
    totalEvidence: number
  }
  focus?: CodebaseMapNode
  nodes: CodebaseMapNode[]
  edges: CodebaseMapEdge[]
  evidence: CodebaseMapEvidence[]
  contextPack: CodebaseContextPack
  summary: string
}

CodebaseMapNode {
  id: string
  kind: "file" | "symbol" | "test" | "scope"
  label: string
  file?: string
  symbol?: string
  type?: string
  loc?: number
  module?: string
  score: number
  evidenceIds: string[]
}

CodebaseMapEdge {
  id: string                 // edge-<stable hash>
  kind: "calls" | "contains" | "imports" | "tests"
  from: string
  to: string
  label: string
  weight: number
  evidenceIds: string[]
}

CodebaseMapEvidence {
  id: string                 // evidence-<stable hash>
  kind: "focus" | "metric" | "call" | "contains" | "import" | "test" | "scope"
  summary: string
  file?: string
  symbol?: string
}

CodebaseContextPack {
  tokenBudget: number
  tokenEstimate: number
  rankedFiles: Array<{ path: string; rank: number; reason: string; tokenEstimate: number; evidenceIds: string[] }>
  rankedSymbols: Array<{ file: string; symbol: string; rank: number; reason: string; tokenEstimate: number; evidenceIds: string[] }>
  tests: Array<{ path: string; covers: string; rank: number; reason: string; tokenEstimate: number; evidenceIds: string[] }>
  evidenceIds: string[]
  nextCommands: string[]
}
```

## Content Drift Result

`drift --json` and MCP `detect_content_drift` return deterministic, report-only drift findings. The command never fails CI by itself; a baseline/gate must be configured before drift can become enforcement.

```typescript
ContentDriftResult {
  mode: "report-only"
  baseline: {
    status: "not-configured"
    requiredForGate: true
    reason: string
  }
  focus?: string
  scope?: string
  minScore: number
  totalFindings: number
  findings: ContentDriftFinding[]
  evidence: ContentDriftEvidence[]
  summary: string
}

ContentDriftFinding {
  id: string
  kind: "name-drift" | "scope-drift" | "mixed-responsibility" | "hidden-side-effect" | "shape-drift" | "orphan-scope" | "misplaced-test"
  severity: "low" | "medium" | "high"
  score: number
  file: string
  scope: string
  title: string
  recommendation: string
  declaredIntent: {
    path: string
    fileName: string
    scope: string
    tokens: string[]
    exports: string[]
  }
  actualBehavior: {
    tokens: string[]
    imports: string[]
    calls: string[]
    types: string[]
    sideEffects: string[]
    tests: string[]
  }
  evidenceIds: string[]
  evidence: string[]
  actions: Array<{ kind: string; command: string; description: string }>
}

ContentDriftEvidence {
  id: string
  kind: "name" | "scope" | "imports" | "calls" | "types" | "tests" | "metric"
  summary: string
  file?: string
  symbol?: string
}
```

## Health Result

`health --json` and MCP `get_health_score` return a deterministic health envelope. CLI `health --min-score <n>` exits `1` when `score < minScore`.

```typescript
HealthResult {
  score: number
  minScore: number
  verdict: "pass" | "fail"
  summary: string
  components: {
    maintainability: number
    complexity: number
    churn: number
    coupling: number
    coverage: number
    blastRadius: number
  }
  coverage: {
    source: "istanbul" | "static-tests"
    coveredFiles: number
    totalFiles: number
    warning?: string
  }
  files: HealthFileResult[]
  hotspots: HealthFileResult[]
  actions: Array<{ command: string; reason: string }>
}

HealthFileResult {
  file: string
  loc: number
  maintainabilityIndex: number
  crapScore: number
  riskScore: number
  coverage: number
  coverageSource: "istanbul" | "static-tests"
  metrics: {
    complexity: number
    churn: number
    coupling: number
    blastRadius: number
    fanIn: number
    fanOut: number
    hasTests: boolean
  }
  evidence: string[]
}
```

## Boundaries Result

`boundaries --json` and MCP `check_boundaries` return deterministic architecture-boundary findings. CLI `boundaries` exits `1` when violations exist.

```typescript
BoundariesResult {
  preset: "custom" | "none" | "bulletproof" | "layered" | "hexagonal" | "feature-sliced"
  zones: Array<{
    name: string
    patterns: string[]
    matchedFiles: string[]
  }>
  rules: Array<{
    from: string
    allow?: string[]
    forbid?: string[]
  }>
  violations: BoundaryViolation[]
  summary: {
    checkedEdges: number
    violations: number
    unassignedFiles: number
  }
  verdict: "pass" | "fail"
}

BoundaryViolation {
  id: string
  kind: "forbidden-edge" | "disallowed-edge" | "risky-re-export-chain"
  ruleId: string
  source: string
  target: string
  fromZone: string
  toZone: string
  symbols: string[]
  isTypeOnly: boolean
  message: string
  evidence: string[]
  actions: Array<{ command: string; reason: string }>
}
```

## Highways Result

`highways --json` and MCP `analyze_highways` return deterministic route-convergence opportunities.

```typescript
HighwaysResult {
  totalRoutes: number
  totalSinks: number
  totalOpportunities: number
  operation?: string
  shape?: string
  minRoutes: number
  opportunities: HighwayOpportunity[]
  trace?: {
    id: string
    found: boolean
    opportunity?: HighwayOpportunity
  }
  summary: string
}

HighwayOpportunity {
  id: string                         // hwy-<kind>-<stable hash>
  kind: "bypass" | "cowpath" | "synthesis"
  operation: string
  shape?: string
  sink: HighwayStep
  canonicalNode: HighwayStep         // proposed=true for synthesis findings
  routes: HighwayRoute[]             // all routes reaching the sink
  bypassRoutes: HighwayRoute[]       // routes missing canonicalNode
  duplicatedCallees?: HighwayStep[]  // cowpath overlap with canonical node callees
  proposal?: {
    name: string
    file: string
    signature: string
    skeleton: string
    reroutePlan: Array<{
      entryPoint: string
      replaceSteps: string[]
      call: string
    }>
    cycleSafety: {
      safe: boolean
      checkedEdges: string[]
      reason: string
    }
  }
  evidence: string[]
  blastRadius: number
  recommendation: string
  contextPack: {
    summary: string
    affectedRoutes: string[]
    evidence: string[]
    blastRadius: number
    proposedCanonicalNode: HighwayStep
    nextSafeCommand: string
  }
}

HighwayRoute {
  id: string
  operation: string
  shape?: string
  entryPoint: HighwayStep
  sink: HighwayStep
  steps: HighwayStep[]
  includesCanonical: boolean
  confidence: "type-resolved" | "text-inferred"
}

HighwayStep {
  id: string
  file: string
  symbol: string
  proposed?: boolean
}
```

## Check Findings

`check --json` and MCP `check` return deterministic findings plus a suppression
ledger. `kind`, `confidence`, and `evidence` are additive fields for rules that
can explain cleanup confidence.

```typescript
Finding {
  ruleId: string
  severity: "warn" | "error"
  kind?: string
  confidence?: "high" | "medium" | "low"
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  message: string
  evidence?: string[]
  actions?: FindingAction[]
  fingerprint: string
}

CheckSuppression {
  directive: "ci-ignore-file" | "ci-ignore-next-line" | "@expected-unused"
  status: "active" | "stale"
  file: string
  line: number
  targetLine?: number
  ruleIds: string[]
  matchesAllRules: boolean
  suppressed: number
  message: string
}

CheckSummary {
  error: number
  warn: number
  suppressed: number
  staleSuppressions: number
  rules: Record<string, number>
}

CheckResult {
  findings: Finding[]
  suppressions: CheckSuppression[]
  summary: CheckSummary
  verdict: "pass" | "warn" | "fail"
  configPath: string | null
}
```
