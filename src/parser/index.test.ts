import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { parseCodebase } from "./index.js";

let tempDir: string;

describe("parseCodebase", () => {
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-test-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws for nonexistent directory", () => {
    expect(() => parseCodebase("/nonexistent/path/does/not/exist")).toThrow("Directory not found");
  });

  it("throws for directory with no TypeScript files", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-empty-"));
    try {
      expect(() => parseCodebase(emptyDir)).toThrow("No TypeScript files found");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  describe("with a real TypeScript project", () => {
    let projectDir: string;

    beforeAll(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-project-"));

      // utils.ts — exports a function and a variable
      fs.writeFileSync(
        path.join(projectDir, "utils.ts"),
        `export function add(a: number, b: number): number {
  return a + b;
}

export const VERSION = "1.0.0";
`
      );

      // types.ts — exports an interface and a type alias
      fs.writeFileSync(
        path.join(projectDir, "types.ts"),
        `export interface User {
  id: string;
  name: string;
}

export type UserList = User[];
`
      );

      // main.ts — imports from utils and types
      fs.writeFileSync(
        path.join(projectDir, "main.ts"),
        `import { add, VERSION } from "./utils";
import type { User } from "./types";

export function greet(user: User): string {
  return \`Hello \${user.name}, version \${VERSION}, sum: \${add(1, 2)}\`;
}

export default function run(): void {
  console.log("running");
}
`
      );

      // Sub-module: lib/helper.ts — imports from parent
      fs.mkdirSync(path.join(projectDir, "lib"));
      fs.writeFileSync(
        path.join(projectDir, "lib", "helper.ts"),
        `import { add } from "../utils";

export class Calculator {
  sum(a: number, b: number): number {
    return add(a, b);
  }
}
`
      );
    });

    afterAll(() => {
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it("parses all TypeScript files", { timeout: 30_000 }, () => {
      const files = parseCodebase(projectDir);
      expect(files).toHaveLength(4);
    });

    it("extracts relative paths", () => {
      const files = parseCodebase(projectDir);
      const relPaths = files.map((f) => f.relativePath).sort();
      expect(relPaths).toEqual(["lib/helper.ts", "main.ts", "types.ts", "utils.ts"]);
    });

    it("extracts exported functions", () => {
      const files = parseCodebase(projectDir);
      const utils = files.find((f) => f.relativePath === "utils.ts");

      expect(utils?.exports).toContainEqual(
        expect.objectContaining({ name: "add", type: "function" })
      );
    });

    it("extracts exported variables", () => {
      const files = parseCodebase(projectDir);
      const utils = files.find((f) => f.relativePath === "utils.ts");

      expect(utils?.exports).toContainEqual(
        expect.objectContaining({ name: "VERSION", type: "variable" })
      );
    });

    it("extracts exported interfaces", () => {
      const files = parseCodebase(projectDir);
      const types = files.find((f) => f.relativePath === "types.ts");

      expect(types?.exports).toContainEqual(
        expect.objectContaining({ name: "User", type: "interface" })
      );
    });

    it("extracts exported type aliases", () => {
      const files = parseCodebase(projectDir);
      const types = files.find((f) => f.relativePath === "types.ts");

      expect(types?.exports).toContainEqual(
        expect.objectContaining({ name: "UserList", type: "type" })
      );
    });

    it("extracts exported classes", () => {
      const files = parseCodebase(projectDir);
      const helper = files.find((f) => f.relativePath === "lib/helper.ts");

      expect(helper?.exports).toContainEqual(
        expect.objectContaining({ name: "Calculator", type: "class" })
      );
    });

    it("extracts default exports", () => {
      const files = parseCodebase(projectDir);
      const main = files.find((f) => f.relativePath === "main.ts");

      expect(main?.exports).toContainEqual(
        expect.objectContaining({ name: "default", isDefault: true })
      );
    });

    it("extracts named import symbols", () => {
      const files = parseCodebase(projectDir);
      const main = files.find((f) => f.relativePath === "main.ts");

      const utilsImport = main?.imports.find((i) => i.from === "./utils");
      expect(utilsImport?.symbols).toContain("add");
      expect(utilsImport?.symbols).toContain("VERSION");
    });

    it("marks type-only imports", () => {
      const files = parseCodebase(projectDir);
      const main = files.find((f) => f.relativePath === "main.ts");

      const typeImport = main?.imports.find((i) => i.from === "./types");
      expect(typeImport?.isTypeOnly).toBe(true);
    });

    it("resolves import paths to relative file paths", () => {
      const files = parseCodebase(projectDir);
      const main = files.find((f) => f.relativePath === "main.ts");

      const utilsImport = main?.imports.find((i) => i.from === "./utils");
      expect(utilsImport?.resolvedFrom).toBe("utils.ts");
    });

    it("resolves parent-directory imports", () => {
      const files = parseCodebase(projectDir);
      const helper = files.find((f) => f.relativePath === "lib/helper.ts");

      const utilsImport = helper?.imports.find((i) => i.from === "../utils");
      expect(utilsImport?.resolvedFrom).toBe("utils.ts");
    });

    it("counts lines of code", () => {
      const files = parseCodebase(projectDir);
      const utils = files.find((f) => f.relativePath === "utils.ts");
      expect(utils?.loc).toBeGreaterThan(0);
    });

    it("skips external package imports", () => {
      const projectWithExternal = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-ext-"));
      try {
        fs.writeFileSync(
          path.join(projectWithExternal, "index.ts"),
          `import fs from "fs";
import path from "path";

export function hello(): string {
  return "hello";
}
`
        );
        const files = parseCodebase(projectWithExternal);
        const index = files.find((f) => f.relativePath === "index.ts");
        // External imports (fs, path) should not appear
        expect(index?.imports).toHaveLength(0);
      } finally {
        fs.rmSync(projectWithExternal, { recursive: true, force: true });
      }
    });
  });

  describe("ESM .js extension resolution", () => {
    it("resolves .js imports to .ts files", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-esm-"));
      try {
        fs.writeFileSync(
          path.join(projectDir, "a.ts"),
          `import { foo } from "./b.js";
export const bar = foo;
`
        );
        fs.writeFileSync(
          path.join(projectDir, "b.ts"),
          `export const foo = 42;
`
        );

        const files = parseCodebase(projectDir);
        const a = files.find((f) => f.relativePath === "a.ts");
        const bImport = a?.imports.find((i) => i.from === "./b.js");
        expect(bImport?.resolvedFrom).toBe("b.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("tsconfig path alias resolution", () => {
    it("resolves @/ alias imports using tsconfig paths", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-alias-"));
      try {
        fs.writeFileSync(
          path.join(projectDir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              paths: { "@/*": ["./src/*"] },
            },
          }),
        );
        fs.mkdirSync(path.join(projectDir, "src", "lib"), { recursive: true });
        fs.mkdirSync(path.join(projectDir, "src", "components"), { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, "src", "lib", "utils.ts"),
          `export function cn(): string { return ""; }\n`,
        );
        fs.writeFileSync(
          path.join(projectDir, "src", "components", "button.tsx"),
          `import { cn } from "@/lib/utils";\nexport function Button(): void { cn(); }\n`,
        );

        const files = parseCodebase(projectDir);
        const button = files.find((f) => f.relativePath === "src/components/button.tsx");
        expect(button?.imports).toHaveLength(1);
        expect(button?.imports[0].from).toBe("@/lib/utils");
        expect(button?.imports[0].resolvedFrom).toBe("src/lib/utils.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("skips non-alias external imports even with tsconfig paths", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-alias2-"));
      try {
        fs.writeFileSync(
          path.join(projectDir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              paths: { "@/*": ["./src/*"] },
            },
          }),
        );
        fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, "src", "index.ts"),
          `import React from "react";\nimport { cn } from "@/lib/utils";\nexport const x = 1;\n`,
        );
        fs.mkdirSync(path.join(projectDir, "src", "lib"), { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, "src", "lib", "utils.ts"),
          `export function cn(): string { return ""; }\n`,
        );

        const files = parseCodebase(projectDir);
        const index = files.find((f) => f.relativePath === "src/index.ts");
        expect(index?.imports).toHaveLength(1);
        expect(index?.imports[0].from).toBe("@/lib/utils");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("gitignore filtering", () => {
    it("skips directories listed in .gitignore", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-gitignore-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "build"));
        fs.writeFileSync(path.join(projectDir, "build", "output.ts"), `export const y = 2;\n`);
        fs.writeFileSync(path.join(projectDir, ".gitignore"), "build\n");

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("skips nested directories matching gitignore patterns", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-gitignore-nested-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "src", "dist"), { recursive: true });
        fs.writeFileSync(path.join(projectDir, "src", "dist", "out.ts"), `export const z = 3;\n`);
        fs.writeFileSync(path.join(projectDir, ".gitignore"), "dist\n");

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("handles trailing slash in gitignore patterns", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-gitignore-slash-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "coverage"));
        fs.writeFileSync(path.join(projectDir, "coverage", "report.ts"), `export const r = 1;\n`);
        fs.writeFileSync(path.join(projectDir, ".gitignore"), "coverage/\n");

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("ignores comments and blank lines in .gitignore", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-gitignore-comments-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "tmp"));
        fs.writeFileSync(path.join(projectDir, "tmp", "cache.ts"), `export const c = 1;\n`);
        fs.writeFileSync(
          path.join(projectDir, ".gitignore"),
          "# Build artifacts\n\ntmp\n\n# End\n"
        );

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("skips .git directory even without .gitignore", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-dotgit-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, ".git", "objects"), { recursive: true });
        fs.writeFileSync(path.join(projectDir, ".git", "hook.ts"), `export const h = 1;\n`);

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("multiple gitignore patterns filter multiple directories", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-gitignore-multi-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "dist"));
        fs.writeFileSync(path.join(projectDir, "dist", "a.ts"), `export const a = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "coverage"));
        fs.writeFileSync(path.join(projectDir, "coverage", "b.ts"), `export const b = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "src"));
        fs.writeFileSync(path.join(projectDir, "src", "app.ts"), `export const c = 1;\n`);
        fs.writeFileSync(path.join(projectDir, ".gitignore"), "dist\ncoverage\n");

        const files = parseCodebase(projectDir);
        const relPaths = files.map((f) => f.relativePath).sort();
        expect(relPaths).toEqual(["index.ts", "src/app.ts"]);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("works correctly when no .gitignore exists", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-no-gitignore-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "lib"));
        fs.writeFileSync(path.join(projectDir, "lib", "utils.ts"), `export const y = 2;\n`);

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(2);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("symlink handling", () => {
    it("follows symlinks to files", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-symfile-"));
      try {
        fs.writeFileSync(path.join(projectDir, "real.ts"), `export const x = 1;\n`);
        fs.symlinkSync(
          path.join(projectDir, "real.ts"),
          path.join(projectDir, "linked.ts"),
          "file"
        );

        const files = parseCodebase(projectDir);
        expect(files.length).toBeGreaterThanOrEqual(1);
        const relPaths = files.map((f) => f.relativePath);
        expect(relPaths).toContain("real.ts");
        expect(relPaths).toContain("linked.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("handles broken symlinks without crashing", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-brokensym-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.symlinkSync(
          path.join(projectDir, "nonexistent.ts"),
          path.join(projectDir, "broken.ts"),
          "file"
        );

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("edge cases", () => {
    it("skips .d.ts files", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-dts-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.writeFileSync(path.join(projectDir, "types.d.ts"), `declare const y: number;\n`);

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("handles symlink loops without stack overflow", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-symlink-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "sub"));
        // Create a symlink loop: sub/link → parent dir
        fs.symlinkSync(projectDir, path.join(projectDir, "sub", "link"), "dir");

        const files = parseCodebase(projectDir);
        // Should complete without infinite recursion
        expect(files.length).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("skips node_modules directories", () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-viz-nm-"));
      try {
        fs.writeFileSync(path.join(projectDir, "index.ts"), `export const x = 1;\n`);
        fs.mkdirSync(path.join(projectDir, "node_modules", "fake"), { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, "node_modules", "fake", "index.ts"),
          `export const y = 2;\n`
        );

        const files = parseCodebase(projectDir);
        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("index.ts");
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });
});
