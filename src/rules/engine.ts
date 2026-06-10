import { createHash } from "crypto";
import type {
  CodebaseGraph,
  CodebaseIntelligenceConfig,
  Finding,
  FindingAction,
  RuleSetting,
  Severity,
} from "../types/index.js";

/** Read-only context handed to every rule. */
export interface RuleContext {
  graph: CodebaseGraph;
  rootDir: string;
  config: CodebaseIntelligenceConfig;
  /** Relative paths of every parsed file (file nodes). */
  fileRelPaths: string[];
  /** Lazily read + cached source for a file, or null if unreadable. */
  sourceOf: (relPath: string) => string | null;
}

/** What a rule emits. The engine adds severity + fingerprint. */
export interface ReportedFinding {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  actions?: FindingAction[];
}

export interface Rule {
  id: string;
  meta: { description: string; category: string; fixable: boolean };
  defaultSeverity: Severity;
  /** Each rule normalizes its own raw options (validated loosely by the config schema). */
  run: (ctx: RuleContext, options: Record<string, unknown> | undefined) => ReportedFinding[];
}

export function normalizeSeverity(value: Severity | 0 | 1 | 2): Severity {
  if (value === 0) return "off";
  if (value === 1) return "warn";
  if (value === 2) return "error";
  return value;
}

function resolveSetting(
  setting: RuleSetting | undefined,
  fallback: Severity,
): { severity: Severity; options: Record<string, unknown> | undefined } {
  if (setting === undefined) return { severity: fallback, options: undefined };
  if (Array.isArray(setting)) return { severity: normalizeSeverity(setting[0]), options: setting[1] };
  return { severity: normalizeSeverity(setting), options: undefined };
}

/**
 * Per-finding identifier. Position-derived (includes line) so it is unique within a file;
 * it shifts when earlier lines are added/removed, so it is emitted as a SARIF
 * partialFingerprint, not a stable cross-revision baseline key.
 */
function fingerprint(ruleId: string, file: string, line: number, message: string): string {
  return createHash("sha1").update(`${ruleId}|${file}|${String(line)}|${message}`).digest("hex").slice(0, 12);
}

type RuleSet = "all" | Set<string>;

interface FileSuppressions {
  fileRules: RuleSet | null;
  lineRules: Map<number, RuleSet>;
}

// Matches both line (`// ci-ignore-...`) and block (`/* ci-ignore-... */`) forms.
const SUPPRESS_RE = /(?:\/\/|\/\*)\s*ci-ignore-(file|next-line)\b([^\n*]*)/;

function mergeRuleSet(existing: RuleSet | null, incoming: RuleSet): RuleSet {
  if (existing === null) return incoming;
  if (existing === "all" || incoming === "all") return "all";
  return new Set([...existing, ...incoming]);
}

function parseSuppressions(source: string): FileSuppressions {
  const lines = source.split(/\r?\n/);
  let fileRules: RuleSet | null = null;
  const lineRules = new Map<number, RuleSet>();

  lines.forEach((text, idx) => {
    const match = SUPPRESS_RE.exec(text);
    if (!match) return;
    const list = match[2].trim();
    const set: RuleSet = list.length === 0 ? "all" : new Set(list.split(/[\s,]+/).filter(Boolean));
    if (match[1] === "file") {
      fileRules = mergeRuleSet(fileRules, set);
    } else {
      // ci-ignore-next-line suppresses the finding on the following source line (1-based).
      lineRules.set(idx + 2, mergeRuleSet(lineRules.get(idx + 2) ?? null, set));
    }
  });

  return { fileRules, lineRules };
}

function ruleSetMatches(set: RuleSet | null | undefined, ruleId: string): boolean {
  if (!set) return false;
  return set === "all" || set.has(ruleId);
}

/**
 * Run every enabled rule and return findings with severity + fingerprint applied,
 * after dropping anything covered by ci-ignore suppressions. Deterministically sorted.
 */
export function runEngine(
  ctx: RuleContext,
  rules: Rule[],
  config: CodebaseIntelligenceConfig,
): Finding[] {
  const suppressionCache = new Map<string, FileSuppressions>();
  const suppressionsFor = (file: string): FileSuppressions => {
    const cached = suppressionCache.get(file);
    if (cached) return cached;
    const source = ctx.sourceOf(file);
    const parsed = source ? parseSuppressions(source) : { fileRules: null, lineRules: new Map<number, RuleSet>() };
    suppressionCache.set(file, parsed);
    return parsed;
  };

  const out: Finding[] = [];

  for (const rule of rules) {
    const { severity, options } = resolveSetting(config.rules?.[rule.id], rule.defaultSeverity);
    if (severity === "off") continue;

    let reported: ReportedFinding[];
    try {
      reported = rule.run(ctx, options);
    } catch (err) {
      // A failing rule drops to zero findings rather than crashing the whole run, but we
      // surface it so a broken rule is never a silent false-negative in CI.
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: rule '${rule.id}' threw during analysis (${reason}); its findings are omitted.\n`);
      continue;
    }

    for (const r of reported) {
      const supp = suppressionsFor(r.file);
      if (ruleSetMatches(supp.fileRules, rule.id)) continue;
      if (ruleSetMatches(supp.lineRules.get(r.line), rule.id)) continue;

      out.push({
        ruleId: rule.id,
        severity,
        file: r.file,
        line: r.line,
        column: r.column,
        endLine: r.endLine,
        endColumn: r.endColumn,
        message: r.message,
        actions: r.actions,
        fingerprint: fingerprint(rule.id, r.file, r.line, r.message),
      });
    }
  }

  out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
  return out;
}
