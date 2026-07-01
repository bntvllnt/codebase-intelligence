import ts from "typescript";
import type { ParsedExport, ParsedSymbol } from "../types/index.js";
import {
  declarationTypeFactsFromChecker,
  declarationTypeFactsFromSyntax,
  nodeLocation,
} from "./type-facts.js";
import { extractDuplicationFacts } from "./duplication.js";

function parsedSymbol(
  name: string,
  type: ParsedExport["type"],
  node: ts.Declaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker | undefined,
  isDefault: boolean,
  isExported: boolean,
): ParsedSymbol {
  const { loc } = nodeLocation(sourceFile, node);
  const typeFacts = checker
    ? declarationTypeFactsFromChecker(name, node, checker)
    : declarationTypeFactsFromSyntax(name, node);
  return {
    name,
    type,
    loc,
    isDefault,
    complexity: computeComplexity(node),
    isExported,
    typeFacts,
    duplication: extractDuplicationFacts(node, sourceFile),
  };
}

export function extractSymbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ParsedSymbol[] {
  return collectSymbols(sourceFile, checker);
}

export function extractSymbolsSyntax(sourceFile: ts.SourceFile): ParsedSymbol[] {
  return collectSymbols(sourceFile, undefined);
}

function collectSymbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker | undefined): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const seen = new Set<string>();

  function addSymbol(name: string, type: ParsedExport["type"], node: ts.Declaration, isDefault = false, isExported = false): void {
    const key = `${name}\0${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(parsedSymbol(name, type, node, sourceFile, checker, isDefault, isExported));
  }

  function visit(node: ts.Node): void {
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(isDefault ? "default" : node.name.text, "function", node, isDefault, isExported);
    } else if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(isDefault ? "default" : node.name.text, "class", node, isDefault, isExported);
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          addSymbol(`${node.name.text}.${member.name.text}`, "function", member, false, false);
        } else if (ts.isConstructorDeclaration(member)) {
          addSymbol(`${node.name.text}.constructor`, "function", member, false, false);
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      addSymbol(node.name.text, "interface", node, false, isExported);
    } else if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node.name.text, "type", node, false, isExported);
    } else if (ts.isEnumDeclaration(node)) {
      addSymbol(node.name.text, "enum", node, false, isExported);
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const type = getExportType(declaration);
        if (type === "function" || isExported) {
          addSymbol(declaration.name.text, type, declaration, false, isExported);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

export function getExportType(node: ts.Declaration): ParsedExport["type"] {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
    return "function";
  }
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) {
    const init = node.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      return "function";
    }
  }
  return "variable";
}

export function computeComplexity(node: ts.Node): number {
  let branches = 1;
  function visit(n: ts.Node): void {
    if (
      ts.isIfStatement(n) ||
      ts.isConditionalExpression(n) ||
      ts.isCaseClause(n) ||
      ts.isCatchClause(n) ||
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n)
    ) {
      branches++;
    }
    if (ts.isBinaryExpression(n)) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        branches++;
      }
    }
    ts.forEachChild(n, visit);
  }
  ts.forEachChild(node, visit);
  return branches;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}
