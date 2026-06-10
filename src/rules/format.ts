import type { CheckResult, OutputFormat } from "../types/index.js";
import { ALL_RULES } from "./registry.js";

const RULE_DESCRIPTIONS = new Map(ALL_RULES.map((r) => [r.id, r.meta.description]));

/** "N error(s), M warning(s) — VERDICT" — shared by text output and the CLI --summary flag. */
export function formatSummaryLine(result: CheckResult): string {
  return `${String(result.summary.error)} error(s), ${String(result.summary.warn)} warning(s) — ${result.verdict.toUpperCase()}`;
}

export function formatJson(result: CheckResult): string {
  return JSON.stringify(
    {
      verdict: result.verdict,
      summary: result.summary,
      configPath: result.configPath,
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
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function formatResult(result: CheckResult, format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatJson(result);
    case "sarif":
      return formatSarif(result);
    default:
      return formatText(result);
  }
}
