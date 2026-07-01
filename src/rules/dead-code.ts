import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { FileMetrics } from "../types/index.js";
import type { ReportedFinding, Rule, RuleContext } from "./engine.js";

type DependencySection = "dependencies" | "optionalDependencies" | "peerDependencies" | "devDependencies";

interface TypeDeclarationFact {
  file: string;
  name: string;
  kind: "type" | "interface";
  line: number;
  column: number;
  exported: boolean;
}

interface MemberDeclarationFact {
  file: string;
  name: string;
  owner: string;
  kind: "private-class-member" | "enum-member";
  line: number;
  column: number;
  used: boolean;
}

interface DependencyDeclaration {
  name: string;
  section: DependencySection;
  line: number;
}

interface DependencyUse {
  packageName: string;
  specifier: string;
  file: string;
  line: number;
  isTypeOnly: boolean;
  isTestFile: boolean;
}

interface ParsedSourceFacts {
  types: TypeDeclarationFact[];
  members: MemberDeclarationFact[];
  dependencyUses: DependencyUse[];
}

const BUILTIN_PACKAGES = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const DEPENDENCY_SECTIONS: DependencySection[] = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

const SOURCE_FACTS_CACHE = new WeakMap<RuleContext, ParsedSourceFacts[]>();

export const noDeadFiles: Rule = {
  id: "no-dead-files",
  meta: { description: "Report files that are not imported and are not recognized entrypoints.", category: "cleanup", fixable: false },
  defaultSeverity: "off",
  run(ctx: RuleContext): ReportedFinding[] {
    return collectDeadFileFindings(ctx);
  },
};

export const noUnusedTypes: Rule = {
  id: "no-unused-types",
  meta: { description: "Report local type and interface declarations with no references.", category: "cleanup", fixable: false },
  defaultSeverity: "off",
  run(ctx: RuleContext): ReportedFinding[] {
    return collectUnusedTypeFindings(ctx);
  },
};

export const noUnusedMembers: Rule = {
  id: "no-unused-members",
  meta: { description: "Report unused private class members and non-exported enum members.", category: "cleanup", fixable: false },
  defaultSeverity: "off",
  run(ctx: RuleContext): ReportedFinding[] {
    return collectUnusedMemberFindings(ctx);
  },
};

export const noUnusedDeps: Rule = {
  id: "no-unused-deps",
  meta: { description: "Report unused, unlisted, type-only, and test-only package dependencies.", category: "cleanup", fixable: false },
  defaultSeverity: "off",
  run(ctx: RuleContext): ReportedFinding[] {
    return collectDependencyFindings(ctx);
  },
};

function collectDeadFileFindings(ctx: RuleContext): ReportedFinding[] {
  const findings: ReportedFinding[] = [];
  const files = [...ctx.graph.fileMetrics.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [file, metrics] of files) {
    if (metrics.fanIn > 0) continue;
    if (entrypointReason(ctx, file, metrics)) continue;

    findings.push({
      file,
      line: 1,
      column: 1,
      kind: "unused-file",
      confidence: metrics.fanOut === 0 ? "high" : "medium",
      message: `Unused file: ${file}`,
      evidence: [
        "fanIn=0",
        `fanOut=${String(metrics.fanOut)}`,
        `exports=${String(metrics.totalExports)}`,
        "entrypoint=false",
      ],
    });
  }

  return findings;
}

function collectUnusedTypeFindings(ctx: RuleContext): ReportedFinding[] {
  const findings: ReportedFinding[] = [];

  for (const facts of collectSourceFacts(ctx)) {
    for (const typeFact of facts.types) {
      const metrics = ctx.graph.fileMetrics.get(typeFact.file);
      if (typeFact.exported) {
        if (!metrics?.deadExports.includes(typeFact.name)) continue;
        if (entrypointReason(ctx, typeFact.file, metrics)) continue;
        findings.push({
          file: typeFact.file,
          line: typeFact.line,
          column: typeFact.column,
          kind: "unused-exported-type",
          confidence: "medium",
          message: `Unused exported ${typeFact.kind}: ${typeFact.name}`,
          evidence: ["deadExport=true", "entrypoint=false"],
        });
        continue;
      }

      findings.push({
        file: typeFact.file,
        line: typeFact.line,
        column: typeFact.column,
        kind: `unused-${typeFact.kind}`,
        confidence: metrics?.isPackageEntrypoint === true ? "medium" : "high",
        message: `Unused ${typeFact.kind}: ${typeFact.name}`,
        evidence: ["localDeclaration=true", "references=0"],
      });
    }
  }

  return findings;
}

function collectUnusedMemberFindings(ctx: RuleContext): ReportedFinding[] {
  const findings: ReportedFinding[] = [];

  for (const facts of collectSourceFacts(ctx)) {
    for (const member of facts.members) {
      if (member.used) continue;
      findings.push({
        file: member.file,
        line: member.line,
        column: member.column,
        kind: member.kind,
        confidence: "high",
        message: `Unused ${member.kind === "enum-member" ? "enum member" : "private class member"}: ${member.owner}.${member.name}`,
        evidence: ["localMember=true", "references=0"],
      });
    }
  }

  return findings;
}

function collectDependencyFindings(ctx: RuleContext): ReportedFinding[] {
  const packageJson = readPackageJson(ctx.rootDir);
  const declarations = packageJson ? collectDependencyDeclarations(packageJson) : new Map<string, DependencyDeclaration>();
  const uses = collectSourceFacts(ctx).flatMap((facts) => facts.dependencyUses);
  const usesByPackage = groupUsesByPackage(uses);
  const ignored = new Set(ctx.config.ignore?.dependencies ?? []);
  const findings: ReportedFinding[] = [];

  for (const [packageName, declaration] of [...declarations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (ignored.has(packageName)) continue;
    if (declaration.section !== "dependencies" && declaration.section !== "optionalDependencies") continue;

    const packageUses = usesByPackage.get(packageName) ?? [];
    if (packageUses.length === 0) {
      findings.push({
        file: "package.json",
        line: declaration.line,
        column: 1,
        kind: "unused-dependency",
        confidence: "medium",
        message: `Unused dependency: ${packageName}`,
        evidence: [`declaredIn=${declaration.section}`, "imports=0"],
      });
      continue;
    }

    if (packageUses.every((use) => use.isTestFile)) {
      findings.push({
        file: "package.json",
        line: declaration.line,
        column: 1,
        kind: "test-only-dependency",
        confidence: "medium",
        message: `Dependency is only used from tests: ${packageName}`,
        evidence: [`declaredIn=${declaration.section}`, ...sampleUseEvidence(packageUses)],
      });
      continue;
    }

    if (packageUses.every((use) => use.isTypeOnly)) {
      findings.push({
        file: "package.json",
        line: declaration.line,
        column: 1,
        kind: "type-only-dependency",
        confidence: "medium",
        message: `Dependency is only used as types: ${packageName}`,
        evidence: [`declaredIn=${declaration.section}`, ...sampleUseEvidence(packageUses)],
      });
    }
  }

  for (const [packageName, packageUses] of [...usesByPackage.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (ignored.has(packageName)) continue;
    if (declarations.has(packageName)) continue;
    if (BUILTIN_PACKAGES.has(packageName)) continue;
    const firstUse = packageUses[0];

    findings.push({
      file: firstUse.file,
      line: firstUse.line,
      column: 1,
      kind: "unlisted-dependency",
      confidence: "high",
      message: `Unlisted dependency import: ${packageName}`,
      evidence: [`specifier=${firstUse.specifier}`, "declared=false"],
    });
  }

  return findings;
}

function collectSourceFacts(ctx: RuleContext): ParsedSourceFacts[] {
  const cached = SOURCE_FACTS_CACHE.get(ctx);
  if (cached) return cached;

  const facts = ctx.fileRelPaths
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((file) => parseSourceFacts(ctx, file))
    .filter((facts): facts is ParsedSourceFacts => facts !== null);
  SOURCE_FACTS_CACHE.set(ctx, facts);
  return facts;
}

function parseSourceFacts(ctx: RuleContext, file: string): ParsedSourceFacts | null {
  const source = ctx.sourceOf(file);
  if (source === null) return null;

  const sourceFile = ts.createSourceFile(
    path.join(ctx.rootDir, file),
    source,
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const typeDeclarations = new Map<string, TypeDeclarationFact>();
  const typeDeclarationPositions = new Set<number>();
  const identifierReferences = new Map<string, number>();
  const enumMembers: Array<MemberDeclarationFact & { enumName: string }> = [];
  const classMembers: Array<MemberDeclarationFact & { className: string }> = [];
  const propertyReferences = new Set<string>();
  const dependencyUses: DependencyUse[] = [];
  const metrics = ctx.graph.fileMetrics.get(file);

  function collectDeclarations(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const dependencyUse = dependencyUseFromModuleSpecifier(node, sourceFile, file, metrics);
      if (dependencyUse) dependencyUses.push(dependencyUse);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const dependencyUse = dependencyUseFromImportEquals(node, sourceFile, file, metrics);
      if (dependencyUse) dependencyUses.push(dependencyUse);
    } else if (ts.isCallExpression(node)) {
      const dependencyUse = dependencyUseFromCall(node, sourceFile, file, metrics);
      if (dependencyUse) dependencyUses.push(dependencyUse);
    } else if (ts.isImportTypeNode(node)) {
      const dependencyUse = dependencyUseFromImportType(node, sourceFile, file, metrics);
      if (dependencyUse) dependencyUses.push(dependencyUse);
    }

    if (ts.isTypeAliasDeclaration(node)) {
      typeDeclarationPositions.add(node.name.getStart(sourceFile));
      typeDeclarations.set(node.name.text, {
        file,
        name: node.name.text,
        kind: "type",
        ...locationOf(sourceFile, node.name),
        exported: isExported(node),
      });
    } else if (ts.isInterfaceDeclaration(node)) {
      typeDeclarationPositions.add(node.name.getStart(sourceFile));
      typeDeclarations.set(node.name.text, {
        file,
        name: node.name.text,
        kind: "interface",
        ...locationOf(sourceFile, node.name),
        exported: isExported(node),
      });
    } else if (ts.isEnumDeclaration(node) && !isExported(node)) {
      typeDeclarationPositions.add(node.name.getStart(sourceFile));
      for (const member of node.members) {
        const name = propertyNameText(member.name, sourceFile);
        if (!name) continue;
        typeDeclarationPositions.add(member.name.getStart(sourceFile));
        enumMembers.push({
          file,
          name,
          owner: node.name.text,
          enumName: node.name.text,
          kind: "enum-member",
          ...locationOf(sourceFile, member.name),
          used: false,
        });
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      for (const member of node.members) {
        const name = classMemberName(member, sourceFile);
        if (!name || !isPrivateClassMember(member)) continue;
        typeDeclarationPositions.add(member.name.getStart(sourceFile));
        classMembers.push({
          file,
          name,
          owner: className,
          className,
          kind: "private-class-member",
          ...locationOf(sourceFile, member.name),
          used: false,
        });
      }
    }

    ts.forEachChild(node, collectDeclarations);
  }

  function collectReferences(node: ts.Node): void {
    if (ts.isIdentifier(node) && !typeDeclarationPositions.has(node.getStart(sourceFile))) {
      identifierReferences.set(node.text, (identifierReferences.get(node.text) ?? 0) + 1);
    }

    if (ts.isPropertyAccessExpression(node)) {
      const name = propertyNameText(node.name, sourceFile);
      const owner = propertyAccessOwner(node.expression, sourceFile);
      if (name && owner) propertyReferences.add(`${owner}.${name}`);
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const owner = propertyAccessOwner(node.expression, sourceFile);
      if (owner) propertyReferences.add(`${owner}.${node.argumentExpression.text}`);
    }

    ts.forEachChild(node, collectReferences);
  }

  collectDeclarations(sourceFile);
  collectReferences(sourceFile);

  const unusedTypes = [...typeDeclarations.values()].filter((typeFact) => {
    if (typeFact.exported) return true;
    return (identifierReferences.get(typeFact.name) ?? 0) === 0;
  });

  const members = [
    ...enumMembers.map((member) => ({
      ...member,
      used: propertyReferences.has(`${member.enumName}.${member.name}`),
    })),
    ...classMembers.map((member) => ({
      ...member,
      used: propertyReferences.has(`this.${member.name}`) || propertyReferences.has(`${member.className}.${member.name}`),
    })),
  ];

  return { types: unusedTypes, members, dependencyUses };
}

function dependencyUseFromModuleSpecifier(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
  sourceFile: ts.SourceFile,
  file: string,
  metrics: FileMetrics | undefined,
): DependencyUse | null {
  if (!node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) return null;
  const packageName = packageNameFromSpecifier(node.moduleSpecifier.text);
  if (!packageName) return null;
  const { line } = locationOf(sourceFile, node.moduleSpecifier);

  return {
    packageName,
    specifier: node.moduleSpecifier.text,
    file,
    line,
    isTypeOnly: isTypeOnlyModuleReference(node),
    isTestFile: metrics?.isTestFile ?? isTestPath(file),
  };
}

function dependencyUseFromCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  file: string,
  metrics: FileMetrics | undefined,
): DependencyUse | null {
  const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!isRequireCall && !isDynamicImport) return null;
  if (node.arguments.length === 0) return null;
  const firstArg = node.arguments[0];
  if (!ts.isStringLiteralLike(firstArg)) return null;
  const packageName = packageNameFromSpecifier(firstArg.text);
  if (!packageName) return null;
  const { line } = locationOf(sourceFile, firstArg);

  return {
    packageName,
    specifier: firstArg.text,
    file,
    line,
    isTypeOnly: false,
    isTestFile: metrics?.isTestFile ?? isTestPath(file),
  };
}

function dependencyUseFromImportEquals(
  node: ts.ImportEqualsDeclaration,
  sourceFile: ts.SourceFile,
  file: string,
  metrics: FileMetrics | undefined,
): DependencyUse | null {
  if (!ts.isExternalModuleReference(node.moduleReference)) return null;
  const expression = node.moduleReference.expression;
  if (!ts.isStringLiteralLike(expression)) return null;
  const packageName = packageNameFromSpecifier(expression.text);
  if (!packageName) return null;
  const { line } = locationOf(sourceFile, expression);

  return {
    packageName,
    specifier: expression.text,
    file,
    line,
    isTypeOnly: node.isTypeOnly,
    isTestFile: metrics?.isTestFile ?? isTestPath(file),
  };
}

function dependencyUseFromImportType(
  node: ts.ImportTypeNode,
  sourceFile: ts.SourceFile,
  file: string,
  metrics: FileMetrics | undefined,
): DependencyUse | null {
  const argument = node.argument;
  if (!ts.isLiteralTypeNode(argument) || !ts.isStringLiteralLike(argument.literal)) return null;
  const packageName = packageNameFromSpecifier(argument.literal.text);
  if (!packageName) return null;
  const { line } = locationOf(sourceFile, argument.literal);

  return {
    packageName,
    specifier: argument.literal.text,
    file,
    line,
    isTypeOnly: true,
    isTestFile: metrics?.isTestFile ?? isTestPath(file),
  };
}

function isTypeOnlyModuleReference(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
    return node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
  }
  if (!node.importClause) return false;
  if (node.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  if (node.importClause.name) return false;
  const bindings = node.importClause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return null;
  if (specifier.startsWith("node:")) return specifier;
  const [first, second] = specifier.split("/");
  if (!first) return null;
  if (first.startsWith("@")) return second ? `${first}/${second}` : first;
  return first;
}

function collectDependencyDeclarations(packageJson: { source: string; data: Record<string, unknown> }): Map<string, DependencyDeclaration> {
  const declarations = new Map<string, DependencyDeclaration>();

  for (const section of DEPENDENCY_SECTIONS) {
    const sectionValue = packageJson.data[section];
    if (!isRecord(sectionValue)) continue;
    for (const [name, value] of Object.entries(sectionValue)) {
      if (typeof value !== "string") continue;
      declarations.set(name, { name, section, line: lineOfNeedle(packageJson.source, `"${name}"`) });
    }
  }

  return declarations;
}

function groupUsesByPackage(uses: DependencyUse[]): Map<string, DependencyUse[]> {
  const grouped = new Map<string, DependencyUse[]>();
  for (const use of uses) {
    if (BUILTIN_PACKAGES.has(use.packageName)) continue;
    const existing = grouped.get(use.packageName) ?? [];
    existing.push(use);
    grouped.set(use.packageName, existing);
  }
  return grouped;
}

function sampleUseEvidence(uses: DependencyUse[]): string[] {
  return uses
    .slice(0, 3)
    .map((use) => `usedIn=${use.file}:${String(use.line)}:${use.isTypeOnly ? "type" : "runtime"}`);
}

function readPackageJson(rootDir: string): { source: string; data: Record<string, unknown> } | null {
  const packageJsonPath = path.join(rootDir, "package.json");
  try {
    const source = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed: unknown = JSON.parse(source);
    if (!isRecord(parsed)) return null;
    return { source, data: parsed };
  } catch {
    return null;
  }
}

function entrypointReason(ctx: RuleContext, file: string, metrics: FileMetrics): string | null {
  if (metrics.isPackageEntrypoint) return metrics.packageEntrypointReason || "package entrypoint";
  if (metrics.isTestFile || isTestPath(file)) return "test file";

  const configuredEntry = ctx.config.entry?.find((pattern) => globMatches(file, pattern));
  if (configuredEntry) return `config.entry:${configuredEntry}`;

  const frameworkReason = frameworkEntrypointReason(file);
  if (frameworkReason) return frameworkReason;

  const basename = path.posix.basename(file);
  if (basename === "index.ts" || basename === "index.tsx") return `conventional entrypoint:${basename}`;
  if ((basename === "main.ts" || basename === "main.tsx" || basename === "cli.ts" || basename === "cli.tsx") && file.startsWith("src/")) {
    return `conventional entrypoint:${basename}`;
  }

  return null;
}

function frameworkEntrypointReason(file: string): string | null {
  if (/^(?:src\/)?app\/.*(?:page|layout|route|loading|error|not-found)\.tsx?$/.test(file)) return "next-app-router";
  if (/^(?:src\/)?pages\/.*\.(?:ts|tsx)$/.test(file)) return "next-pages-router";
  if (/^convex\/.*\.ts$/.test(file)) return "convex-functions";
  return null;
}

function globMatches(file: string, pattern: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern).replace(/^\.\//, "");
  if (normalizedFile === normalizedPattern) return true;

  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");

  return new RegExp(`^${escaped}$`).test(normalizedFile);
}

function isTestPath(file: string): boolean {
  return file.includes("__tests__/") || file.includes(".test.") || file.includes(".spec.");
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function isPrivateClassMember(member: ts.ClassElement): member is ts.PropertyDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration {
  if (!("name" in member) || !member.name) return false;
  if (ts.isPrivateIdentifier(member.name)) return true;
  return ts.canHaveModifiers(member) && (ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) ?? false);
}

function classMemberName(member: ts.ClassElement, sourceFile: ts.SourceFile): string | null {
  if (!("name" in member) || !member.name) return null;
  return propertyNameText(member.name, sourceFile);
}

function propertyNameText(name: ts.PropertyName | ts.MemberName, sourceFile: ts.SourceFile): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isPrivateIdentifier(name)) return name.getText(sourceFile).replace(/^#/, "");
  return null;
}

function propertyAccessOwner(expression: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return propertyNameText(expression.name, sourceFile);
  return null;
}

function locationOf(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function lineOfNeedle(source: string, needle: string): number {
  const index = source.indexOf(needle);
  if (index < 0) return 1;
  return source.slice(0, index).split(/\r?\n/).length;
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
