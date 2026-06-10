import ts from "typescript";
import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

interface NoCommentsOptions {
  style: "line" | "block" | "all";
  allowJSDoc: boolean;
  allowDirectives: boolean;
  allowLicenseHeader: boolean;
  allow: string[];
}

// Directive comments worth keeping even when comments are forbidden.
const DIRECTIVE_RE = /^\/\/\/?\s*(@ts-|eslint-|ci-ignore|prettier-|biome-|<reference|c8 |v8 |istanbul )/;

function normalize(raw: Record<string, unknown> | undefined): NoCommentsOptions {
  const o = raw ?? {};
  const style = o.style === "block" || o.style === "all" ? o.style : "line";
  const allow = Array.isArray(o.allow) ? o.allow.filter((x): x is string => typeof x === "string") : [];
  return {
    style,
    allowJSDoc: o.allowJSDoc !== false,
    allowDirectives: o.allowDirectives !== false,
    allowLicenseHeader: o.allowLicenseHeader !== false,
    allow,
  };
}

function shouldReport(
  text: string,
  isLine: boolean,
  start: number,
  firstNonWs: number,
  o: NoCommentsOptions,
): boolean {
  if (o.style === "line" && !isLine) return false;
  if (o.style === "block" && isLine) return false;

  const isJsDoc = !isLine && text.startsWith("/**");
  if (o.allowJSDoc && isJsDoc) return false;
  if (o.allowDirectives && DIRECTIVE_RE.test(text)) return false;
  if (o.allowLicenseHeader && start === firstNonWs) return false;
  const body = commentBody(text);
  if (o.allow.some((p) => body.startsWith(p))) return false;
  return true;
}

/** Comment text with delimiters stripped, e.g. "// TODO x" -> "TODO x". */
function commentBody(text: string): string {
  return text.replace(/^\/\*+|^\/\/+/, "").replace(/\*\/$/, "").trim();
}

/**
 * Forbid comments. Defaults forbid `//` line comments while keeping JSDoc,
 * tool/compiler directives, and a file-leading license header. `style: "all"`
 * forbids every comment.
 */
export const noComments: Rule = {
  id: "no-comments",
  meta: { description: "Forbid comments (configurable: keeps JSDoc/directives/header by default).", category: "style", fixable: true },
  defaultSeverity: "off",
  run(ctx: RuleContext, rawOptions): ReportedFinding[] {
    const options = normalize(rawOptions);
    const findings: ReportedFinding[] = [];

    for (const rel of ctx.fileRelPaths) {
      const source = ctx.sourceOf(rel);
      if (!source) continue;

      const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, false);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
      const firstNonWs = source.search(/\S/);

      let token = scanner.scan();
      while (token !== ts.SyntaxKind.EndOfFileToken) {
        const isLine = token === ts.SyntaxKind.SingleLineCommentTrivia;
        const isBlock = token === ts.SyntaxKind.MultiLineCommentTrivia;
        if (isLine || isBlock) {
          const start = scanner.getTokenStart();
          const text = scanner.getTokenText();
          if (shouldReport(text, isLine, start, firstNonWs, options)) {
            const lc = sf.getLineAndCharacterOfPosition(start);
            findings.push({
              file: rel,
              line: lc.line + 1,
              column: lc.character + 1,
              message: "Comments are not allowed (no-comments)",
              actions: [{ kind: "remove-comment", auto_fixable: true, range: { start, end: start + text.length } }],
            });
          }
        }
        token = scanner.scan();
      }
    }

    return findings;
  },
};
