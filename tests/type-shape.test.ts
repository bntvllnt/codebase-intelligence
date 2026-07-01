import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeGraph } from "../src/analyzer/index.js";
import { computeFileContext, computeSearch, computeSymbolContext } from "../src/core/index.js";
import { buildGraph } from "../src/graph/index.js";
import { parseCodebase } from "../src/parser/index.js";
import type { CodebaseGraph } from "../src/types/index.js";

let projectDir: string;
let graph: CodebaseGraph;

function writeProjectFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(projectDir, filePath)), { recursive: true });
  fs.writeFileSync(path.join(projectDir, filePath), content);
}

describe("type/shape facts", () => {
  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-type-shape-"));
    writeProjectFile(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "Node16",
          moduleResolution: "Node16",
          baseUrl: ".",
          paths: {
            "@models": ["models.ts"],
          },
        },
      }),
    );
    writeProjectFile(
      "models.ts",
      `export type UserRole = "admin" | "member";

export interface User {
  id: string;
  email: string;
  role: UserRole;
}

export interface CreateUserInput {
  email: string;
  role: UserRole;
}

export type Result<T> = {
  value: T;
  error?: string;
};
`,
    );
    writeProjectFile(
      "index.ts",
      `import type { CreateUserInput, Result, User } from "@models";

export function createUser(input: CreateUserInput): User {
  return { id: "1", email: input.email, role: input.role };
}

export const wrapUser = <T extends User>(value: T): Result<T> => ({ value });

export default function unwrap(result: Result<User>): User {
  return result.value;
}

export class UserController {
  save(input: CreateUserInput): Result<User> {
    return wrapUser(createUser(input));
  }
}

export function unresolved(input: MissingShape): MissingShape {
  return input;
}
`,
    );

    const parsedFiles = parseCodebase(projectDir);
    graph = analyzeGraph(buildGraph(parsedFiles), parsedFiles);
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("CH-P1-03: parses resolved, generic, default, and unresolved type facts", () => {
    const parsed = parseCodebase(projectDir);
    const index = parsed.find((file) => file.relativePath === "index.ts");
    const createUser = index?.exports.find((fileExport) => fileExport.name === "createUser");
    const wrapUser = index?.exports.find((fileExport) => fileExport.name === "wrapUser");
    const defaultExport = index?.exports.find((fileExport) => fileExport.name === "default");
    const unresolved = index?.exports.find((fileExport) => fileExport.name === "unresolved");
    const models = parsed.find((file) => file.relativePath === "models.ts");
    const user = models?.exports.find((fileExport) => fileExport.name === "User");
    const createUserInput = models?.exports.find((fileExport) => fileExport.name === "CreateUserInput");

    expect(createUser?.typeFacts).toMatchObject({
      parameters: [{ name: "input", type: "CreateUserInput", optional: false, rest: false }],
      returnType: "User",
      consumes: ["CreateUserInput"],
      produces: ["User"],
      confidence: "resolved",
    });
    expect(wrapUser?.typeFacts?.typeParameters).toEqual([{ name: "T", constraint: "User", default: undefined }]);
    expect(wrapUser?.typeFacts?.returnType).toContain("Result");
    expect(defaultExport?.typeFacts?.signature).toContain("default(result: Result<User>): User");
    expect(unresolved?.typeFacts?.consumes).toContain("MissingShape");
    expect(unresolved?.typeFacts?.produces).toContain("MissingShape");
    expect(user?.typeFacts).toMatchObject({ consumes: ["UserRole"], produces: ["User"] });
    expect(createUserInput?.typeFacts).toMatchObject({ consumes: ["UserRole"], produces: ["CreateUserInput"] });
  });

  it("CH-P1-03: exposes type facts through file, symbol, and search result objects", () => {
    const fileContext = computeFileContext(graph, "index.ts");
    expect(fileContext).not.toHaveProperty("error");
    if ("error" in fileContext) throw new Error(fileContext.error);

    const exportedFunction = fileContext.exports.find((fileExport) => fileExport.name === "createUser");
    expect(exportedFunction?.typeFacts?.signature).toContain("createUser(input: CreateUserInput): User");

    const symbolContext = computeSymbolContext(graph, "UserController.save");
    expect(symbolContext).not.toHaveProperty("error");
    if ("error" in symbolContext) throw new Error(symbolContext.error);
    expect(symbolContext.typeFacts).toMatchObject({
      returnType: "Result<User>",
      consumes: ["CreateUserInput"],
      produces: ["Result", "User"],
    });

    const search = computeSearch(graph, "CreateUserInput", 5);
    const matchedSymbols = search.results.flatMap((result) => result.symbols);
    expect(matchedSymbols.some((symbol) => symbol.name === "createUser" && symbol.typeFacts?.consumes.includes("CreateUserInput"))).toBe(true);
    expect(matchedSymbols.some((symbol) => symbol.name === "UserController.save" && symbol.typeFacts?.consumes.includes("CreateUserInput"))).toBe(true);
  });
});
