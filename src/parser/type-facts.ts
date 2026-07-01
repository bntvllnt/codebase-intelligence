import ts from "typescript";
import type {
  ParameterTypeFact,
  SymbolTypeFacts,
  TypeParameterFact,
} from "../types/index.js";

type FunctionLikeWithBody =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

const TYPE_REFERENCE_STOP_WORDS = new Set([
  "Array",
  "Date",
  "Error",
  "Map",
  "Promise",
  "Readonly",
  "ReadonlyArray",
  "Record",
  "Set",
  "WeakMap",
  "WeakSet",
]);

export function nodeLocation(sourceFile: ts.SourceFile, node: ts.Node): { loc: number; startLine: number; endLine: number } {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
  return { loc: endLine - startLine + 1, startLine, endLine };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function extractTypeReferences(typeText: string | undefined): string[] {
  if (!typeText) return [];
  const matches = typeText.match(/\b[A-Z][A-Za-z0-9_$]*\b/g) ?? [];
  return uniqueSorted(matches.filter((name) => !TYPE_REFERENCE_STOP_WORDS.has(name)));
}

function parameterName(parameter: ts.ParameterDeclaration): string {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText();
}

function typeParameterFacts(typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): TypeParameterFact[] {
  if (!typeParameters) return [];
  return typeParameters.map((typeParameter) => ({
    name: typeParameter.name.text,
    constraint: typeParameter.constraint?.getText(),
    default: typeParameter.default?.getText(),
  }));
}

function typeParameterNames(typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): string[] {
  if (!typeParameters) return [];
  return typeParameters.map((typeParameter) => typeParameter.name.text);
}

function declarationTypeParameters(declaration: ts.Declaration): ts.NodeArray<ts.TypeParameterDeclaration> | undefined {
  if (
    ts.isClassDeclaration(declaration) ||
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isArrowFunction(declaration) ||
    ts.isFunctionExpression(declaration)
  ) {
    return declaration.typeParameters;
  }
  return undefined;
}

function declarationConsumes(name: string, declaration: ts.Declaration): string[] {
  const excluded = new Set([name, ...typeParameterNames(declarationTypeParameters(declaration))]);
  return extractTypeReferences(declaration.getText()).filter((typeName) => !excluded.has(typeName));
}

function parameterFactsFromSyntax(parameters: ts.NodeArray<ts.ParameterDeclaration>): ParameterTypeFact[] {
  return parameters.map((parameter) => ({
    name: parameterName(parameter),
    type: parameter.type?.getText() ?? "unknown",
    optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
    rest: parameter.dotDotDotToken !== undefined,
  }));
}

function parameterFactsFromChecker(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  signature: ts.Signature,
  checker: ts.TypeChecker,
): ParameterTypeFact[] {
  const signatureParameters = signature.getParameters();
  return parameters.map((parameter, index) => {
    const symbol = signatureParameters.at(index);
    const type = symbol !== undefined
      ? checker.getTypeOfSymbolAtLocation(symbol, parameter)
      : checker.getTypeAtLocation(parameter);
    const parameterType = checker.typeToString(type, parameter, ts.TypeFormatFlags.NoTruncation);
    return {
      name: parameterName(parameter),
      type: parameterType,
      optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
      rest: parameter.dotDotDotToken !== undefined,
    };
  });
}

function functionSignatureText(
  name: string,
  parameters: readonly ParameterTypeFact[],
  returnType: string | undefined,
  typeParameters: readonly TypeParameterFact[],
): string {
  const typeParameterText = typeParameters.length > 0
    ? `<${typeParameters.map((typeParameter) => {
      const constraint = typeParameter.constraint ? ` extends ${typeParameter.constraint}` : "";
      const defaultType = typeParameter.default ? ` = ${typeParameter.default}` : "";
      return `${typeParameter.name}${constraint}${defaultType}`;
    }).join(", ")}>`
    : "";
  const parameterText = parameters.map((parameter) => {
    const rest = parameter.rest ? "..." : "";
    const optional = parameter.optional && !parameter.rest ? "?" : "";
    return `${rest}${parameter.name}${optional}: ${parameter.type}`;
  }).join(", ");
  return `${name}${typeParameterText}(${parameterText}): ${returnType ?? "unknown"}`;
}

function functionTypeFactsFromChecker(
  name: string,
  declaration: FunctionLikeWithBody,
  checker: ts.TypeChecker,
): SymbolTypeFacts | undefined {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) return undefined;
  const parameters = parameterFactsFromChecker(declaration.parameters, signature, checker);
  const returnType = checker.typeToString(checker.getReturnTypeOfSignature(signature), declaration, ts.TypeFormatFlags.NoTruncation);
  const typeParameters = ts.isConstructorDeclaration(declaration)
    ? []
    : typeParameterFacts(declaration.typeParameters);
  return {
    signature: functionSignatureText(name, parameters, returnType, typeParameters),
    parameters,
    returnType,
    typeParameters,
    consumes: uniqueSorted(parameters.flatMap((parameter) => extractTypeReferences(parameter.type))),
    produces: extractTypeReferences(returnType),
    confidence: "resolved",
  };
}

function functionTypeFactsFromSyntax(name: string, declaration: FunctionLikeWithBody): SymbolTypeFacts {
  const parameters = parameterFactsFromSyntax(declaration.parameters);
  const returnType = ts.isConstructorDeclaration(declaration) ? undefined : declaration.type?.getText();
  const typeParameters = ts.isConstructorDeclaration(declaration)
    ? []
    : typeParameterFacts(declaration.typeParameters);
  return {
    signature: functionSignatureText(name, parameters, returnType, typeParameters),
    parameters,
    returnType,
    typeParameters,
    consumes: uniqueSorted(parameters.flatMap((parameter) => extractTypeReferences(parameter.type))),
    produces: extractTypeReferences(returnType),
    confidence: "syntax",
  };
}

export function declarationTypeFactsFromChecker(
  name: string,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): SymbolTypeFacts | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isConstructorDeclaration(declaration) ||
    ts.isArrowFunction(declaration) ||
    ts.isFunctionExpression(declaration)
  ) {
    return functionTypeFactsFromChecker(name, declaration, checker);
  }

  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
      return functionTypeFactsFromChecker(name, declaration.initializer, checker);
    }
  }

  const typeText = checker.typeToString(checker.getTypeAtLocation(declaration), declaration, ts.TypeFormatFlags.NoTruncation);
  const shapeDeclaration = ts.isInterfaceDeclaration(declaration)
    || ts.isTypeAliasDeclaration(declaration)
    || ts.isClassDeclaration(declaration)
    || ts.isEnumDeclaration(declaration);
  return {
    signature: `${name}: ${typeText}`,
    parameters: [],
    returnType: typeText,
    typeParameters: ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
      ? typeParameterFacts(declaration.typeParameters)
      : [],
    consumes: declarationConsumes(name, declaration),
    produces: shapeDeclaration ? [name] : extractTypeReferences(typeText),
    confidence: "resolved",
  };
}

export function declarationTypeFactsFromSyntax(name: string, declaration: ts.Declaration): SymbolTypeFacts | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isConstructorDeclaration(declaration) ||
    ts.isArrowFunction(declaration) ||
    ts.isFunctionExpression(declaration)
  ) {
    return functionTypeFactsFromSyntax(name, declaration);
  }

  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
      return functionTypeFactsFromSyntax(name, declaration.initializer);
    }
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    const typeText = declaration.type.getText();
    return {
      signature: `type ${name} = ${typeText}`,
      parameters: [],
      returnType: typeText,
      typeParameters: typeParameterFacts(declaration.typeParameters),
      consumes: declarationConsumes(name, declaration),
      produces: [name],
      confidence: "syntax",
    };
  }

  if (ts.isInterfaceDeclaration(declaration)) {
    return {
      signature: `interface ${name}`,
      parameters: [],
      typeParameters: typeParameterFacts(declaration.typeParameters),
      consumes: declarationConsumes(name, declaration),
      produces: [name],
      confidence: "syntax",
    };
  }

  if (ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
    const kind = ts.isClassDeclaration(declaration) ? "class" : "enum";
    return {
      signature: `${kind} ${name}`,
      parameters: [],
      typeParameters: ts.isClassDeclaration(declaration) ? typeParameterFacts(declaration.typeParameters) : [],
      consumes: declarationConsumes(name, declaration),
      produces: [name],
      confidence: "syntax",
    };
  }

  return undefined;
}

export function canHaveDeclarationTypeFacts(node: ts.Node): node is ts.Declaration {
  return ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isVariableDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node);
}
