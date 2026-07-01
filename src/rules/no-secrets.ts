import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "generic-token", regex: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
  { name: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/ },
  { name: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function lineMatches(source: string): Array<{ line: number; column: number; kind: string }> {
  const matches: Array<{ line: number; column: number; kind: string }> = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.regex.exec(lineText);
      if (match) {
        matches.push({ line: index + 1, column: match.index + 1, kind: pattern.name });
      }
    }
  });
  return matches;
}

export const noSecrets: Rule = {
  id: "no-secrets",
  meta: { description: "Opt-in scan for likely hardcoded secrets.", category: "security", fixable: false },
  defaultSeverity: "off",
  run(ctx: RuleContext): ReportedFinding[] {
    const findings: ReportedFinding[] = [];
    for (const file of ctx.fileRelPaths) {
      const source = ctx.sourceOf(file);
      if (!source) continue;
      for (const match of lineMatches(source)) {
        findings.push({
          file,
          line: match.line,
          column: match.column,
          kind: "secret-leak",
          confidence: "medium",
          message: `Likely hardcoded secret (${match.kind})`,
          evidence: [`pattern=${match.kind}`, "sourceText=redacted"],
          actions: [{
            kind: "review-finding",
            auto_fixable: false,
            command: `codebase-intelligence check . --production --fail-on warn`,
            reason: "Confirm the value is not a credential before committing.",
          }],
        });
      }
    }
    return findings;
  },
};
