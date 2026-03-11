import ts from "typescript";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import type { ParsedFile, ParsedExport, ParsedImport, CallSite } from "../types/index.js";

interface PathAlias {
  prefix: string;
  baseDir: string;
}

function loadTsconfigPaths(rootDir: string): PathAlias[] {
  const aliases: PathAlias[] = [];
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return aliases;

  try {
    const result = ts.readConfigFile(tsconfigPath, (p) => fs.readFileSync(p, "utf-8"));
    if (result.error) return aliases;

    const config = result.config as {
      compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
    };
    const paths = config.compilerOptions?.paths;
    const baseUrl = config.compilerOptions?.baseUrl ?? ".";
    if (!paths) return aliases;

    for (const [pattern, targets] of Object.entries(paths)) {
      if (targets.length === 0) continue;
      const prefix = pattern.replace(/\*$/, "");
      const target = targets[0].replace(/\*$/, "");
      const baseDir = path.resolve(rootDir, baseUrl, target);
      aliases.push({ prefix, baseDir });
    }
  } catch {
    /* malformed tsconfig — skip alias resolution */
  }

  return aliases;
}

export function parseCodebase(rootDir: string): ParsedFile[] {
  const absoluteRoot = path.resolve(rootDir);

  if (!fs.existsSync(absoluteRoot)) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  const tsFiles = findTypeScriptFiles(absoluteRoot);

  if (tsFiles.length === 0) {
    throw new Error(`No TypeScript files found in ${rootDir}`);
  }

  const pathAliases = loadTsconfigPaths(absoluteRoot);

  const program = ts.createProgram(tsFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    allowJs: false,
    noEmit: true,
  });

  const checker = program.getTypeChecker();
  const parsed: ParsedFile[] = [];

  for (const filePath of tsFiles) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;

    try {
      const result = parseFile(sourceFile, checker, absoluteRoot, pathAliases);
      parsed.push(result);
    } catch {
      console.warn(`Skipped ${path.relative(absoluteRoot, filePath)}: parse error`);
    }
  }

  const resolved = resolveImportPaths(parsed, absoluteRoot, pathAliases);
  const churnMap = getGitChurn(absoluteRoot);
  return matchTestFiles(resolved).map((f) => ({
    ...f,
    churn: churnMap.get(f.relativePath) ?? 0,
  }));
}

function loadGitignorePatterns(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function isGitignored(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const clean = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    // Match directory name at any level
    const segments = relativePath.split(path.sep);
    for (const seg of segments) {
      if (seg === clean) return true;
    }
    // Match leading path
    if (relativePath.startsWith(clean + path.sep) || relativePath === clean) return true;
  }
  return false;
}

function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const ignorePatterns = loadGitignorePatterns(dir);
  walkDir(dir, dir, files, visited, ignorePatterns);
  return files.filter((f) => !f.endsWith(".d.ts"));
}

function walkDir(dir: string, rootDir: string, results: string[], visited: Set<string>, ignorePatterns: string[]): void {
  const realDir = fs.realpathSync(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    // Always skip these regardless of .gitignore
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    // Check gitignore patterns
    if (isGitignored(relPath, ignorePatterns)) continue;

    if (entry.isSymbolicLink()) {
      try {
        const realTarget = fs.realpathSync(fullPath);
        const stat = fs.statSync(realTarget);
        if (stat.isDirectory()) {
          if (!visited.has(realTarget)) walkDir(fullPath, rootDir, results, visited, ignorePatterns);
        } else if (stat.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          results.push(fullPath);
        }
      } catch {
        continue;
      }
    } else if (entry.isDirectory()) {
      walkDir(fullPath, rootDir, results, visited, ignorePatterns);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(fullPath);
    }
  }
}

function parseFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker, rootDir: string, aliases: PathAlias[]): ParsedFile {
  const filePath = sourceFile.fileName;
  const relativePath = path.relative(rootDir, filePath);
  const loc = sourceFile.getEnd() === 0 ? 0 : sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd() - 1).line + 1;
  const exports = extractExports(sourceFile, checker);
  const imports = extractImports(sourceFile, aliases);
  const callSites = extractCallSites(sourceFile, checker, rootDir);

  return { path: filePath, relativePath, loc, exports, imports, callSites, churn: 0, isTestFile: false };
}

function extractExports(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ParsedExport[] {
  const exports: ParsedExport[] = [];
  const symbol = checker.getSymbolAtLocation(sourceFile);

  if (!symbol) return exports;

  const resolvedExports = checker.getExportsOfModule(symbol);
  const seen = new Set<string>();

  for (const exportSymbol of resolvedExports) {
    const exportName = exportSymbol.getName();
    if (seen.has(exportName)) continue;
    seen.add(exportName);

    const resolved = exportSymbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exportSymbol)
      : exportSymbol;

    const declarations = resolved.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const decl = declarations[0];

    const declSourceFile = decl.getSourceFile();
    const isLocal = declSourceFile.fileName === sourceFile.fileName;

    const exportType = getExportType(decl);
    const startLine = declSourceFile.getLineAndCharacterOfPosition(decl.getStart()).line;
    const endLine = declSourceFile.getLineAndCharacterOfPosition(decl.getEnd()).line;

    exports.push({
      name: exportName,
      type: exportType,
      loc: isLocal ? endLine - startLine + 1 : 1,
      isDefault: exportName === "default",
      complexity: isLocal ? computeComplexity(decl) : 0,
    });
  }

  return exports;
}

function getExportType(node: ts.Declaration): ParsedExport["type"] {
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

function extractImports(sourceFile: ts.SourceFile, aliases: PathAlias[]): ParsedImport[] {
  const imports: ParsedImport[] = [];

  ts.forEachChild(sourceFile, (node) => {
    // Handle import declarations
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) return;

      const from = node.moduleSpecifier.text;
      const isRelative = from.startsWith(".") || from.startsWith("/");
      const isAliased = aliases.some((a) => from.startsWith(a.prefix));
      if (!isRelative && !isAliased) return;

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const isTypeOnly = node.importClause?.isTypeOnly ?? false;
      const symbols: string[] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          symbols.push("default");
        }
        const bindings = node.importClause.namedBindings;
        if (bindings) {
          if (ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              symbols.push(element.name.text);
            }
          } else if (ts.isNamespaceImport(bindings)) {
            symbols.push(`* as ${bindings.name.text}`);
          }
        }
      }

      imports.push({ from, resolvedFrom: "", symbols, isTypeOnly });
      return;
    }

    // Handle re-export declarations: export { X } from './y' and export * from './y'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const isRelative = from.startsWith(".") || from.startsWith("/");
      const isAliased = aliases.some((a) => from.startsWith(a.prefix));
      if (!isRelative && !isAliased) return;

      const isTypeOnly = node.isTypeOnly;
      const symbols: string[] = [];

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          symbols.push(element.name.text);
        }
      } else if (!node.exportClause) {
        symbols.push("*");
      }

      imports.push({ from, resolvedFrom: "", symbols, isTypeOnly });
    }
  });

  return imports;
}

function extractCallSites(sourceFile: ts.SourceFile, checker: ts.TypeChecker, rootDir: string): CallSite[] {
  const callSites: CallSite[] = [];
  const callerFile = path.relative(rootDir, sourceFile.fileName);
  const seen = new Set<string>();

  function getEnclosingSymbolName(node: ts.Node): string {
    let current = node.parent;
    while (!ts.isSourceFile(current)) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text;
      }
      if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
        const classDecl = current.parent;
        if (ts.isClassDeclaration(classDecl) && classDecl.name) {
          return `${classDecl.name.text}.${current.name.text}`;
        }
        return current.name.text;
      }
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        const varDecl = current.parent;
        if (ts.isVariableDeclaration(varDecl) && ts.isIdentifier(varDecl.name)) {
          return varDecl.name.text;
        }
      }
      if (ts.isConstructorDeclaration(current)) {
        const classDecl = current.parent;
        if (ts.isClassDeclaration(classDecl) && classDecl.name) {
          return `${classDecl.name.text}.constructor`;
        }
      }
      current = current.parent;
    }
    return "<module>";
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callerSymbol = getEnclosingSymbolName(node);
      let calleeSymbol = "";
      let calleeFile = "";
      let confidence: CallSite["confidence"] = "text-inferred";

      const expr = node.expression;
      const symbol = checker.getSymbolAtLocation(expr);

      if (symbol) {
        const resolved = symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
        const decls = resolved.getDeclarations();

        if (decls && decls.length > 0) {
          const decl = decls[0];
          const declFile = decl.getSourceFile().fileName;
          const declRelPath = path.relative(rootDir, declFile);

          if (!declRelPath.startsWith("..") && !path.isAbsolute(declRelPath)) {
            calleeFile = declRelPath;
            calleeSymbol = resolved.getName();

            if (ts.isMethodDeclaration(decl) && ts.isIdentifier(decl.name)) {
              const classDecl = decl.parent;
              if (ts.isClassDeclaration(classDecl) && classDecl.name) {
                calleeSymbol = `${classDecl.name.text}.${decl.name.text}`;
              }
            }

            confidence = "type-resolved";
          }
        }
      }

      if (calleeFile && calleeSymbol) {
        const key = `${callerSymbol}->${calleeFile}::${calleeSymbol}`;
        if (!seen.has(key)) {
          seen.add(key);
          callSites.push({
            callerFile,
            callerSymbol,
            calleeFile,
            calleeSymbol,
            confidence,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return callSites;
}

function resolveImportPaths(files: ParsedFile[], rootDir: string, aliases: PathAlias[]): ParsedFile[] {
  const filePathSet = new Set(files.map((f) => f.path));

  for (const file of files) {
    for (const imp of file.imports) {
      const expandedPath = expandAlias(imp.from, aliases, rootDir);
      const dir = expandedPath ? rootDir : path.dirname(file.path);
      const target = expandedPath ?? imp.from;
      const resolved = resolveModulePath(dir, target, filePathSet);
      imp.resolvedFrom = resolved ? path.relative(rootDir, resolved) : imp.from;
    }
  }

  return files;
}

function expandAlias(importPath: string, aliases: PathAlias[], rootDir: string): string | null {
  for (const alias of aliases) {
    if (importPath.startsWith(alias.prefix)) {
      const rest = importPath.slice(alias.prefix.length);
      const absolute = path.join(alias.baseDir, rest);
      return "./" + path.relative(rootDir, absolute);
    }
  }
  return null;
}

function computeComplexity(node: ts.Node): number {
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

function getGitChurn(rootDir: string): Map<string, number> {
  const churnMap = new Map<string, number>();
  try {
    const output = execFileSync(
      "git",
      ["log", "--all", "--name-only", "--format="],
      { cwd: rootDir, encoding: "utf-8", timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && (trimmed.endsWith(".ts") || trimmed.endsWith(".tsx"))) {
        churnMap.set(trimmed, (churnMap.get(trimmed) ?? 0) + 1);
      }
    }
  } catch {
    /* not a git repo or git unavailable — churn stays 0 */
  }
  return churnMap;
}

function matchTestFiles(files: ParsedFile[]): ParsedFile[] {
  const byRelative = new Map<string, ParsedFile>();
  for (const f of files) {
    byRelative.set(f.relativePath, f);
  }

  // Build map: directory -> test files in its tests/ or __tests__/ subdirectory
  const dirTestFiles = new Map<string, string[]>();
  for (const f of files) {
    const base = f.relativePath;
    if (!base.includes(".test.") && !base.includes(".spec.")) continue;
    const dir = path.dirname(base);
    const dirName = path.basename(dir);
    if (dirName === "tests" || dirName === "__tests__") {
      const parentDir = path.dirname(dir);
      const list = dirTestFiles.get(parentDir) ?? [];
      list.push(base);
      dirTestFiles.set(parentDir, list);
    }
  }

  for (const f of files) {
    const base = f.relativePath;
    const isTest =
      base.includes(".test.") ||
      base.includes(".spec.") ||
      base.includes("__tests__/");
    f.isTestFile = isTest;

    if (!isTest) {
      const ext = path.extname(base);
      const stem = base.slice(0, -ext.length);
      const dir = path.dirname(base);
      const name = path.basename(stem);

      // Direct name-match candidates (same dir, __tests__/, tests/)
      const testCandidates = [
        `${stem}.test${ext}`,
        `${stem}.spec${ext}`,
        `${stem}.test.ts`,
        `${stem}.spec.ts`,
        path.join(dir, "__tests__", `${name}${ext}`),
        path.join(dir, "__tests__", `${name}.test${ext}`),
        path.join(dir, "tests", `${name}.test${ext}`),
        path.join(dir, "tests", `${name}.spec${ext}`),
        path.join(dir, "tests", `${name}.test.ts`),
        path.join(dir, "tests", `${name}.spec.ts`),
      ];

      for (const candidate of testCandidates) {
        if (byRelative.has(candidate)) {
          f.testFile = candidate;
          break;
        }
      }

      // Fallback: module-level test directory (tests/ or __tests__/ has any test files)
      if (!f.testFile) {
        const testFiles = dirTestFiles.get(dir);
        if (testFiles && testFiles.length > 0) {
          f.testFile = testFiles[0];
        }
      }
    }
  }

  return files;
}

function resolveModulePath(fromDir: string, importPath: string, knownFiles: Set<string>): string | null {
  const base = path.resolve(fromDir, importPath);

  // Handle .js → .ts mapping (TypeScript uses .js in imports for ESM)
  const strippedBase = base.endsWith(".js") ? base.slice(0, -3) : base;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    `${strippedBase}.ts`,
    `${strippedBase}.tsx`,
    path.join(strippedBase, "index.ts"),
    path.join(strippedBase, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}
