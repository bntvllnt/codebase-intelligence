import { describe, it, expect } from "vitest";
import { buildGraph, detectCircularDeps } from "./index.js";
import type { ParsedFile } from "../types/index.js";

function makeFile(relativePath: string, overrides?: Partial<ParsedFile>): ParsedFile {
  return {
    path: `/root/${relativePath}`,
    relativePath,
    loc: 10,
    exports: [],
    imports: [],
    callSites: [],
    churn: 0,
    isTestFile: false,
    ...overrides,
  };
}

describe("buildGraph", () => {
  it("creates file nodes for each parsed file", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const { nodes } = buildGraph(files);

    const fileNodes = nodes.filter((n) => n.type === "file");
    expect(fileNodes).toHaveLength(2);
    expect(fileNodes.map((n) => n.id)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("creates function and class nodes for exported functions and classes", () => {
    const files = [
      makeFile("src/a.ts", {
        exports: [
          { name: "foo", type: "function", loc: 3, isDefault: false, complexity: 1 },
          { name: "Bar", type: "class", loc: 10, isDefault: false, complexity: 1 },
          { name: "x", type: "variable", loc: 1, isDefault: false, complexity: 1 },
        ],
      }),
    ];
    const { nodes } = buildGraph(files);

    const funcNodes = nodes.filter((n) => n.type === "function");
    expect(funcNodes).toHaveLength(1);
    expect(funcNodes[0].label).toBe("foo");
    expect(funcNodes[0].parentFile).toBe("src/a.ts");

    const classNodes = nodes.filter((n) => n.type === "class");
    expect(classNodes).toHaveLength(1);
    expect(classNodes[0].label).toBe("Bar");
  });

  it("creates edges from imports between known files", () => {
    const files = [
      makeFile("src/a.ts", {
        imports: [{ from: "./b.js", resolvedFrom: "src/b.ts", symbols: ["foo"], isTypeOnly: false }],
      }),
      makeFile("src/b.ts"),
    ];
    const { edges } = buildGraph(files);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "src/a.ts",
      target: "src/b.ts",
      symbols: ["foo"],
      weight: 1,
    });
  });

  it("skips edges to unknown files", () => {
    const files = [
      makeFile("src/a.ts", {
        imports: [{ from: "./unknown.js", resolvedFrom: "src/unknown.ts", symbols: ["x"], isTypeOnly: false }],
      }),
    ];
    const { edges } = buildGraph(files);
    expect(edges).toHaveLength(0);
  });

  it("skips self-import edges", () => {
    const files = [
      makeFile("src/a.ts", {
        imports: [{ from: "./a.js", resolvedFrom: "src/a.ts", symbols: ["x"], isTypeOnly: false }],
      }),
    ];
    const { edges } = buildGraph(files);
    expect(edges).toHaveLength(0);
  });

  it("deduplicates edges between the same files", () => {
    const files = [
      makeFile("src/a.ts", {
        imports: [
          { from: "./b.js", resolvedFrom: "src/b.ts", symbols: ["x"], isTypeOnly: false },
          { from: "./b.js", resolvedFrom: "src/b.ts", symbols: ["y"], isTypeOnly: true },
        ],
      }),
      makeFile("src/b.ts"),
    ];
    const { edges } = buildGraph(files);
    expect(edges).toHaveLength(1);
  });

  it("sets weight to symbol count or 1 if no symbols", () => {
    const files = [
      makeFile("src/a.ts", {
        imports: [
          { from: "./b.js", resolvedFrom: "src/b.ts", symbols: ["x", "y", "z"], isTypeOnly: false },
        ],
      }),
      makeFile("src/b.ts"),
      makeFile("src/c.ts", {
        imports: [
          { from: "./b.js", resolvedFrom: "src/b.ts", symbols: [], isTypeOnly: false },
        ],
      }),
    ];
    const { edges } = buildGraph(files);
    expect(edges.find((e) => e.source === "src/a.ts")?.weight).toBe(3);
    expect(edges.find((e) => e.source === "src/c.ts")?.weight).toBe(1);
  });

  it("assigns module from directory path", () => {
    const files = [
      makeFile("src/parser/index.ts"),
      makeFile("src/graph/builder.ts"),
      makeFile("root.ts"),
    ];
    const { nodes } = buildGraph(files);

    expect(nodes.find((n) => n.id === "src/parser/index.ts")?.module).toBe("src/parser/");
    expect(nodes.find((n) => n.id === "src/graph/builder.ts")?.module).toBe("src/graph/");
    expect(nodes.find((n) => n.id === "root.ts")?.module).toBe(".");
  });

  it("sets exportCount attribute on graph nodes", () => {
    const files = [
      makeFile("src/a.ts", {
        exports: [
          { name: "x", type: "function", loc: 3, isDefault: false, complexity: 1 },
          { name: "y", type: "variable", loc: 1, isDefault: false, complexity: 1 },
        ],
      }),
    ];
    const { graph } = buildGraph(files);
    expect(graph.getNodeAttribute("src/a.ts", "exportCount")).toBe(2);
  });

  it("returns empty graph for empty input", () => {
    const { nodes, edges } = buildGraph([]);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

describe("detectCircularDeps", () => {
  it("returns empty for acyclic graph", () => {
    const files = [
      makeFile("a.ts", { imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("b.ts", { imports: [{ from: "./c", resolvedFrom: "c.ts", symbols: ["y"], isTypeOnly: false }] }),
      makeFile("c.ts"),
    ];
    const { graph } = buildGraph(files);
    expect(detectCircularDeps(graph)).toHaveLength(0);
  });

  it("detects simple A→B→A cycle", () => {
    const files = [
      makeFile("a.ts", { imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("b.ts", { imports: [{ from: "./a", resolvedFrom: "a.ts", symbols: ["y"], isTypeOnly: false }] }),
    ];
    const { graph } = buildGraph(files);
    const cycles = detectCircularDeps(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain("a.ts");
    expect(cycles[0]).toContain("b.ts");
  });

  it("detects A→B→C→A triangular cycle", () => {
    const files = [
      makeFile("a.ts", { imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("b.ts", { imports: [{ from: "./c", resolvedFrom: "c.ts", symbols: ["y"], isTypeOnly: false }] }),
      makeFile("c.ts", { imports: [{ from: "./a", resolvedFrom: "a.ts", symbols: ["z"], isTypeOnly: false }] }),
    ];
    const { graph } = buildGraph(files);
    const cycles = detectCircularDeps(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(4); // A, B, C, A
  });

  it("deduplicates rotated cycles", () => {
    // A→B→A is the same cycle regardless of start point
    const files = [
      makeFile("a.ts", { imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("b.ts", { imports: [{ from: "./a", resolvedFrom: "a.ts", symbols: ["y"], isTypeOnly: false }] }),
    ];
    const { graph } = buildGraph(files);
    const cycles = detectCircularDeps(graph);
    expect(cycles).toHaveLength(1);
  });

  it("ignores function nodes (only detects file-level cycles)", () => {
    const files = [
      makeFile("a.ts", {
        exports: [{ name: "foo", type: "function", loc: 3, isDefault: false, complexity: 1 }],
        imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["bar"], isTypeOnly: false }],
      }),
      makeFile("b.ts", {
        exports: [{ name: "bar", type: "function", loc: 3, isDefault: false, complexity: 1 }],
      }),
    ];
    const { graph } = buildGraph(files);
    const cycles = detectCircularDeps(graph);
    expect(cycles).toHaveLength(0);
  });

  it("returns empty for empty graph", () => {
    const { graph } = buildGraph([]);
    expect(detectCircularDeps(graph)).toHaveLength(0);
  });

  it("detects multiple independent cycles", () => {
    const files = [
      // Cycle 1: a ↔ b
      makeFile("a.ts", { imports: [{ from: "./b", resolvedFrom: "b.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("b.ts", { imports: [{ from: "./a", resolvedFrom: "a.ts", symbols: ["y"], isTypeOnly: false }] }),
      // Cycle 2: c ↔ d
      makeFile("c.ts", { imports: [{ from: "./d", resolvedFrom: "d.ts", symbols: ["x"], isTypeOnly: false }] }),
      makeFile("d.ts", { imports: [{ from: "./c", resolvedFrom: "c.ts", symbols: ["y"], isTypeOnly: false }] }),
    ];
    const { graph } = buildGraph(files);
    const cycles = detectCircularDeps(graph);
    expect(cycles).toHaveLength(2);
  });
});
