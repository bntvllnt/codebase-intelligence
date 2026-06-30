import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../src/analyzer/index.js";
import { computeDeadExports, computeFileContext, computeOpportunities } from "../src/core/index.js";
import { buildGraph } from "../src/graph/index.js";
import { parseCodebase } from "../src/parser/index.js";
import type { CodebaseGraph } from "../src/types/index.js";

function analyzeTempCodebase(root: string): CodebaseGraph {
  const parsed = parseCodebase(root);
  return analyzeGraph(buildGraph(parsed), parsed);
}

describe("package public entrypoints", () => {
  it("marks package exports, types, and bin source files as low-confidence dead exports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-package-entrypoints-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "fixture-package",
          exports: {
            ".": {
              import: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
            "./feature": "./src/feature.ts",
          },
          types: "./dist/index.d.ts",
          bin: {
            fixture: "./dist/cli.js",
          },
        }),
      );
      fs.writeFileSync(path.join(root, "src", "index.ts"), "export const publicApi = 1;\n");
      fs.writeFileSync(path.join(root, "src", "feature.ts"), "export const featureApi = 1;\n");
      fs.writeFileSync(path.join(root, "src", "cli.ts"), "export function runCli() { return 1; }\n");
      fs.writeFileSync(path.join(root, "src", "internal.ts"), "export const internalOnly = 1;\n");

      const graph = analyzeTempCodebase(root);
      const deadExports = computeDeadExports(graph, undefined, 10);

      const byPath = new Map(deadExports.files.map((file) => [file.path, file]));
      expect(byPath.get("src/index.ts")?.confidence).toBe("low");
      expect(byPath.get("src/index.ts")?.isPackageEntrypoint).toBe(true);
      expect(byPath.get("src/index.ts")?.packageEntrypointReason).toContain("package.json");
      expect(byPath.get("src/feature.ts")?.confidence).toBe("low");
      expect(byPath.get("src/cli.ts")?.confidence).toBe("low");
      expect(byPath.get("src/internal.ts")?.confidence).toBe("high");

      const context = computeFileContext(graph, "src/index.ts");
      expect("error" in context).toBe(false);
      if (!("error" in context)) {
        expect(context.metrics.totalExports).toBe(1);
        expect(context.metrics.isPackageEntrypoint).toBe(true);
        expect(context.metrics.packageEntrypointReason).toContain("package.json");
      }

      const opportunities = computeOpportunities(graph, 10);
      const publicApiOpportunity = opportunities.opportunities.find(
        (opportunity) => opportunity.kind === "reduce-api-surface" && opportunity.target === "src/index.ts",
      );
      expect(publicApiOpportunity?.confidence).toBe("low");
      expect(publicApiOpportunity?.title).toBe("Audit public API surface");
      expect(publicApiOpportunity?.evidence).toContain("packageEntrypoint=true");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
