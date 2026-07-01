import { createHash } from "crypto";
import type {
  CodebaseGraph,
  CodebaseIntelligenceConfig,
  CheckSuppression,
  Finding,
  FindingAction,
  FindingConfidence,
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
  kind?: string;
  confidence?: FindingConfidence;
  message: string;
  evidence?: string[];
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

interface SuppressionDirectiveState {
  directive: CheckSuppression["directive"];
  file: string;
  line: number;
  targetLine?: number;
  rules: RuleSet;
  suppressed: number;
  suppressedRuleIds: Set<string>;
}

interface FileSuppressions {
  directives: SuppressionDirectiveState[];
  fileDirectives: SuppressionDirectiveState[];
  lineDirectives: Map<number, SuppressionDirectiveState[]>;
}

// Matches both line (`// ci-ignore-...`) and block (`/* ci-ignore-... */`) forms.
const SUPPRESS_RE = /(?:\/\/|\/\*)\s*ci-ignore-(file|next-line)\b([^\n*]*)/;
const EXPECTED_UNUSED_RULES = new Set([
  "no-dead-exports",
  "no-dead-files",
  "no-unused-types",
  "no-unused-members",
]);
const STALE_SUPPRESSION_RULE_ID = "no-stale-suppressions";

export interface EngineResult {
  findings: Finding[];
  suppressions: CheckSuppression[];
}

function parseRuleSet(list: string): RuleSet {
  const trimmed = list.trim();
  return trimmed.length === 0 ? "all" : new Set(trimmed.split(/[\s,]+/).filter(Boolean));
}

function addLineDirective(parsed: FileSuppressions, directive: SuppressionDirectiveState): void {
  const existing = parsed.lineDirectives.get(directive.targetLine ?? directive.line) ?? [];
  existing.push(directive);
  parsed.lineDirectives.set(directive.targetLine ?? directive.line, existing);
  parsed.directives.push(directive);
}

function parseSuppressions(source: string, file: string): FileSuppressions {
  const lines = source.split(/\r?\n/);
  const parsed: FileSuppressions = { directives: [], fileDirectives: [], lineDirectives: new Map() };

  lines.forEach((text, idx) => {
    const match = SUPPRESS_RE.exec(text);
    if (!match) return;
    const set = parseRuleSet(match[2]);
    const line = idx + 1;
    if (match[1] === "file") {
      parsed.fileDirectives.push({
        directive: "ci-ignore-file",
        file,
        line,
        rules: set,
        suppressed: 0,
        suppressedRuleIds: new Set(),
      });
      parsed.directives.push(parsed.fileDirectives[parsed.fileDirectives.length - 1]);
      return;
    }

    addLineDirective(parsed, {
      directive: "ci-ignore-next-line",
      file,
      line,
      targetLine: line + 1,
      rules: set,
      suppressed: 0,
      suppressedRuleIds: new Set(),
    });
  });

  for (const directive of parseExpectedUnusedSuppressions(lines, file)) {
    addLineDirective(parsed, directive);
  }

  return parsed;
}

function parseExpectedUnusedSuppressions(lines: string[], file: string): SuppressionDirectiveState[] {
  const directives: SuppressionDirectiveState[] = [];
  const seenBlocks = new Set<string>();

  lines.forEach((text, idx) => {
    if (!text.includes("@expected-unused")) return;
    const block = jsDocBlockBounds(lines, idx);
    if (!block) return;

    const key = `${String(block.start)}:${String(block.end)}`;
    if (seenBlocks.has(key)) return;
    seenBlocks.add(key);

    const targetLine = nextCodeLine(lines, block.end + 1);
    if (targetLine === null) return;
    directives.push({
      directive: "@expected-unused",
      file,
      line: idx + 1,
      targetLine,
      rules: new Set(EXPECTED_UNUSED_RULES),
      suppressed: 0,
      suppressedRuleIds: new Set(),
    });
  });

  return directives;
}

function jsDocBlockBounds(lines: string[], tagLineIndex: number): { start: number; end: number } | null {
  let start = tagLineIndex;
  while (start >= 0 && !lines[start].includes("/**")) {
    if (lines[start].includes("*/")) return null;
    start -= 1;
  }
  if (start < 0) return null;

  let end = start;
  while (end < lines.length && !lines[end].includes("*/")) end += 1;
  if (end >= lines.length || tagLineIndex > end) return null;
  return { start, end };
}

function nextCodeLine(lines: string[], startIndex: number): number | null {
  for (let idx = startIndex; idx < lines.length; idx += 1) {
    const trimmed = lines[idx].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) continue;
    return idx + 1;
  }
  return null;
}

function ruleSetMatches(set: RuleSet | null | undefined, ruleId: string): boolean {
  if (!set) return false;
  return set === "all" || set.has(ruleId);
}

function matchingDirective(supp: FileSuppressions, line: number, ruleId: string): SuppressionDirectiveState | null {
  const lineDirectives = supp.lineDirectives.get(line) ?? [];
  const lineDirective = lineDirectives.find((directive) => ruleSetMatches(directive.rules, ruleId));
  if (lineDirective) return lineDirective;
  return supp.fileDirectives.find((directive) => ruleSetMatches(directive.rules, ruleId)) ?? null;
}

function ruleSetToIds(set: RuleSet): string[] {
  if (set === "all") return [];
  return [...set].sort((left, right) => left.localeCompare(right));
}

function suppressionMessage(directive: SuppressionDirectiveState, status: CheckSuppression["status"]): string {
  if (status === "stale") {
    return `Stale suppression: ${directive.directive} does not suppress any finding`;
  }
  return `${directive.directive} suppressed ${String(directive.suppressed)} finding(s)`;
}

function toCheckSuppression(
  directive: SuppressionDirectiveState,
  status: CheckSuppression["status"],
): CheckSuppression {
  return {
    directive: directive.directive,
    status,
    file: directive.file,
    line: directive.line,
    targetLine: directive.targetLine,
    ruleIds: status === "active" ? ruleSetToIds(directive.suppressedRuleIds) : ruleSetToIds(directive.rules),
    matchesAllRules: directive.rules === "all",
    suppressed: directive.suppressed,
    message: suppressionMessage(directive, status),
  };
}

function staleSuppressionSeverity(config: CodebaseIntelligenceConfig): Severity {
  return resolveSetting(config.rules?.[STALE_SUPPRESSION_RULE_ID], "warn").severity;
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
  return runEngineWithSuppressions(ctx, rules, config).findings;
}

/**
 * Run enabled rules and return findings plus active/stale suppression metadata.
 */
export function runEngineWithSuppressions(
  ctx: RuleContext,
  rules: Rule[],
  config: CodebaseIntelligenceConfig,
): EngineResult {
  const suppressionCache = new Map<string, FileSuppressions>();
  const suppressionsFor = (file: string): FileSuppressions => {
    const cached = suppressionCache.get(file);
    if (cached) return cached;
    const source = ctx.sourceOf(file);
    const parsed = source ? parseSuppressions(source, file) : { directives: [], fileDirectives: [], lineDirectives: new Map() };
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
      const directive = matchingDirective(supp, r.line, rule.id);
      if (directive) {
        directive.suppressed += 1;
        directive.suppressedRuleIds.add(rule.id);
        continue;
      }

      out.push({
        ruleId: rule.id,
        severity,
        kind: r.kind,
        confidence: r.confidence,
        file: r.file,
        line: r.line,
        column: r.column,
        endLine: r.endLine,
        endColumn: r.endColumn,
        message: r.message,
        evidence: r.evidence,
        actions: r.actions,
        fingerprint: fingerprint(rule.id, r.file, r.line, r.message),
      });
    }
  }

  out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );

  for (const file of ctx.fileRelPaths) suppressionsFor(file);

  const staleSeverity = staleSuppressionSeverity(config);
  const suppressions = [...suppressionCache.values()]
    .flatMap((supp) => supp.directives)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.directive.localeCompare(b.directive))
    .map((directive) => {
      const status: CheckSuppression["status"] = directive.suppressed > 0 ? "active" : "stale";
      if (status === "stale" && staleSeverity !== "off") {
        const message = suppressionMessage(directive, status);
        out.push({
          ruleId: STALE_SUPPRESSION_RULE_ID,
          severity: staleSeverity === "error" ? "error" : "warn",
          kind: "stale-suppression",
          confidence: "high",
          file: directive.file,
          line: directive.line,
          column: 1,
          message,
          evidence: [
            `directive=${directive.directive}`,
            directive.targetLine ? `targetLine=${String(directive.targetLine)}` : "scope=file",
            directive.rules === "all" ? "rules=all" : `rules=${ruleSetToIds(directive.rules).join(",")}`,
          ],
          fingerprint: fingerprint(STALE_SUPPRESSION_RULE_ID, directive.file, directive.line, message),
        });
      }
      return toCheckSuppression(directive, status);
    });

  out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
  return { findings: out, suppressions };
}
