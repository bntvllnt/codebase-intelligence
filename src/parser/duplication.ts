import { createHash } from "node:crypto";
import ts from "typescript";
import type { DuplicationMode, SymbolDuplicationFacts } from "../types/index.js";

const modes: DuplicationMode[] = ["strict", "mild", "weak"];

type RawCloneTokenKind = "identifier" | "literal" | "operator" | "syntax";

interface RawCloneToken {
  kind: RawCloneTokenKind;
  text: string;
}

function hashTokens(tokens: string[]): string {
  return createHash("sha256").update(tokens.join("\0")).digest("hex").slice(0, 16);
}

function cloneScope(node: ts.Declaration): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    return node.body;
  }
  if (!ts.isVariableDeclaration(node)) return undefined;

  const initializer = node.initializer;
  if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) return undefined;
  return initializer.body;
}

function normalizeToken(mode: DuplicationMode, token: RawCloneToken): string {
  if (mode === "strict") return token.text;
  if (token.kind === "identifier") return mode === "mild" ? "$id" : "$atom";
  if (token.kind === "literal") return mode === "mild" ? "$literal" : "$atom";
  if (mode === "weak" && token.kind === "operator") return "$operator";
  return token.text;
}

function syntaxName(kind: ts.SyntaxKind): string {
  return ts.SyntaxKind[kind];
}

function nodeToken(node: ts.Node, sourceFile: ts.SourceFile): RawCloneToken {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return { kind: "identifier", text: node.text };
  }
  if (
    ts.isStringLiteralLike(node)
    || ts.isNumericLiteral(node)
    || ts.isRegularExpressionLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
  ) {
    return { kind: "literal", text: node.getText(sourceFile) };
  }
  return { kind: "syntax", text: syntaxName(node.kind) };
}

function pushOperatorToken(tokens: RawCloneToken[], kind: ts.SyntaxKind): void {
  tokens.push({ kind: "operator", text: syntaxName(kind) });
}

function collectTokens(node: ts.Node, sourceFile: ts.SourceFile, tokens: RawCloneToken[]): void {
  tokens.push(nodeToken(node, sourceFile));

  if (ts.isBinaryExpression(node)) {
    pushOperatorToken(tokens, node.operatorToken.kind);
  } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    pushOperatorToken(tokens, node.operator);
  } else if (ts.isVariableDeclarationList(node)) {
    tokens.push({ kind: "syntax", text: node.flags & ts.NodeFlags.Const ? "const" : "let" });
  }

  ts.forEachChild(node, (child) => {
    collectTokens(child, sourceFile, tokens);
  });
}

export function extractDuplicationFacts(
  node: ts.Declaration,
  sourceFile: ts.SourceFile,
): SymbolDuplicationFacts | undefined {
  const scope = cloneScope(node);
  if (!scope) return undefined;

  const rawTokens: RawCloneToken[] = [];
  collectTokens(scope, sourceFile, rawTokens);
  if (rawTokens.length === 0) return undefined;

  const tokens: Record<DuplicationMode, string[]> = { strict: [], mild: [], weak: [] };
  const hashes: Record<DuplicationMode, string> = { strict: "", mild: "", weak: "" };
  for (const mode of modes) {
    tokens[mode] = rawTokens.map((token) => normalizeToken(mode, token));
    hashes[mode] = hashTokens(tokens[mode]);
  }

  return {
    tokenCount: tokens.strict.length,
    tokens,
    hashes,
  };
}
