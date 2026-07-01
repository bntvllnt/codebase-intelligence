import type { CheckResult, OutputFormat } from "../types/index.js";
import { ALL_RULES } from "./registry.js";

const RULE_DESCRIPTIONS = new Map(ALL_RULES.map((r) => [r.id, r.meta.description]));
RULE_DESCRIPTIONS.set("no-stale-suppressions", "Report suppressions that no longer hide any finding.");

/** Shared by text output and the CLI --summary flag. */
export function formatSummaryLine(result: CheckResult): string {
  const suppressionText = result.summary.suppressed > 0 || result.summary.staleSuppressions > 0
    ? `, ${String(result.summary.suppressed)} suppressed, ${String(result.summary.staleSuppressions)} stale suppression(s)`
    : "";
  return `${String(result.summary.error)} error(s), ${String(result.summary.warn)} warning(s)${suppressionText} — ${result.verdict.toUpperCase()}`;
}

export function formatJson(result: CheckResult): string {
  return JSON.stringify(
    {
      verdict: result.verdict,
      summary: result.summary,
      configPath: result.configPath,
      suppressions: result.suppressions,
      findings: result.findings,
    },
    null,
    2,
  );
}

export function formatText(result: CheckResult): string {
  const lines: string[] = [];

  if (result.findings.length === 0) {
    lines.push("No findings.");
  } else {
    let currentFile = "";
    for (const f of result.findings) {
      if (f.file !== currentFile) {
        currentFile = f.file;
        lines.push("");
        lines.push(currentFile);
      }
      lines.push(`  ${String(f.line)}:${String(f.column)}  ${f.severity.padEnd(5)}  ${f.message}  (${f.ruleId})`);
    }
    lines.push("");
  }

  lines.push(formatSummaryLine(result));
  return lines.join("\n");
}

export function formatSarif(result: CheckResult): string {
  const ruleIds = [...new Set(result.findings.map((f) => f.ruleId))];
  const propertiesFor = (finding: CheckResult["findings"][number]): Record<string, unknown> | undefined => {
    const properties: Record<string, unknown> = {};
    if (finding.kind) properties.kind = finding.kind;
    if (finding.confidence) properties.confidence = finding.confidence;
    if (finding.evidence) properties.evidence = finding.evidence;
    return Object.keys(properties).length > 0 ? properties : undefined;
  };
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "codebase-intelligence",
            rules: ruleIds.map((id) => ({
              id,
              shortDescription: { text: RULE_DESCRIPTIONS.get(id) ?? id },
            })),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          level: f.severity === "error" ? "error" : "warning",
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: {
                  startLine: f.line,
                  startColumn: f.column,
                  ...(f.endLine !== undefined ? { endLine: f.endLine } : {}),
                  ...(f.endColumn !== undefined ? { endColumn: f.endColumn } : {}),
                },
              },
            },
          ],
          // Position-derived key — may shift when lines change, hence partialFingerprints.
          partialFingerprints: { ciFingerprint: f.fingerprint },
          ...(propertiesFor(f) ? { properties: propertiesFor(f) } : {}),
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

function escapeAnnotation(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A").replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function severityLabel(severity: CheckResult["findings"][number]["severity"]): "error" | "warning" {
  return severity === "error" ? "error" : "warning";
}

export function formatMarkdown(result: CheckResult): string {
  const lines = [
    "## Codebase Intelligence",
    "",
    `**Verdict:** ${result.verdict.toUpperCase()}`,
    `**Summary:** ${formatSummaryLine(result)}`,
    "",
  ];

  if (result.findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }

  lines.push("| Severity | Rule | Location | Finding |");
  lines.push("|---|---|---|---|");
  for (const finding of result.findings.slice(0, 50)) {
    const message = finding.message.replaceAll("|", "\\|");
    lines.push(`| ${finding.severity} | \`${finding.ruleId}\` | \`${finding.file}:${String(finding.line)}\` | ${message} |`);
  }
  if (result.findings.length > 50) lines.push(`| info | truncated | - | ${String(result.findings.length - 50)} more finding(s) omitted from markdown output. |`);
  return lines.join("\n");
}

export function formatAnnotations(result: CheckResult): string {
  return result.findings
    .map((finding) => {
      const level = severityLabel(finding.severity);
      const message = escapeAnnotation(`${finding.message} (${finding.ruleId})`);
      return `::${level} file=${escapeAnnotation(finding.file)},line=${String(finding.line)},col=${String(finding.column)}::${message}`;
    })
    .join("\n");
}

export function formatPrComment(result: CheckResult, platform: "github" | "gitlab"): string {
  const body = formatMarkdown(result);
  const footer = platform === "github"
    ? "<!-- codebase-intelligence:pr-comment-github -->"
    : "<!-- codebase-intelligence:pr-comment-gitlab -->";
  return `${body}\n\n${footer}`;
}

export function formatBadge(result: CheckResult): string {
  const color = result.verdict === "pass" ? "brightgreen" : result.verdict === "warn" ? "yellow" : "red";
  return JSON.stringify(
    {
      schemaVersion: 1,
      label: "codebase",
      message: result.verdict,
      color,
    },
    null,
    2,
  );
}

export function formatCodeClimate(result: CheckResult): string {
  const issues = result.findings.map((finding) => ({
    type: "issue",
    check_name: finding.ruleId,
    description: finding.message,
    categories: ["Complexity"],
    fingerprint: finding.fingerprint,
    severity: finding.severity === "error" ? "major" : "minor",
    location: {
      path: finding.file,
      lines: { begin: finding.line, end: finding.endLine ?? finding.line },
    },
    remediation_points: finding.severity === "error" ? 50000 : 10000,
  }));
  return JSON.stringify(issues, null, 2);
}

export function formatCompact(result: CheckResult): string {
  const lines = [formatSummaryLine(result)];
  for (const finding of result.findings.slice(0, 10)) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.file}:${String(finding.line)} ${finding.ruleId} — ${finding.message}`);
  }
  if (result.findings.length > 10) lines.push(`… ${String(result.findings.length - 10)} more finding(s)`);
  return lines.join("\n");
}

export function formatResult(result: CheckResult, format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatJson(result);
    case "sarif":
      return formatSarif(result);
    case "markdown":
      return formatMarkdown(result);
    case "annotations":
      return formatAnnotations(result);
    case "pr-comment-github":
      return formatPrComment(result, "github");
    case "pr-comment-gitlab":
      return formatPrComment(result, "gitlab");
    case "badge":
      return formatBadge(result);
    case "codeclimate":
      return formatCodeClimate(result);
    case "compact":
      return formatCompact(result);
    default:
      return formatText(result);
  }
}
