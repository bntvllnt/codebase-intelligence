import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseCodebase } from "../parser/index.js";
import { buildGraph } from "../graph/index.js";
import { analyzeGraph } from "../analyzer/index.js";
import { setGraph, getGraph, getProjectName } from "./graph-store.js";

let projectDir: string;

beforeAll(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-api-test-"));

  fs.writeFileSync(
    path.join(projectDir, "utils.ts"),
    `export function add(a: number, b: number): number { return a + b; }
export const VERSION = "1.0.0";
`,
  );

  fs.writeFileSync(
    path.join(projectDir, "types.ts"),
    `export interface User { id: string; name: string; }
export type UserList = User[];
`,
  );

  fs.writeFileSync(
    path.join(projectDir, "main.ts"),
    `import { add, VERSION } from "./utils";
import type { User } from "./types";
export function greet(user: User): string {
  return \`Hello \${user.name}, \${VERSION}, \${add(1, 2)}\`;
}
export default function run(): void { console.log("running"); }
`,
  );

  fs.mkdirSync(path.join(projectDir, "lib"));
  fs.writeFileSync(
    path.join(projectDir, "lib", "helper.ts"),
    `import { add } from "../utils";
export class Calculator { sum(a: number, b: number): number { return add(a, b); } }
`,
  );

  const files = parseCodebase(projectDir);
  const built = buildGraph(files);
  const graph = analyzeGraph(built, files);
  setGraph(graph, "test-project");
});

afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("graph-store", () => {
  it("returns the stored graph", () => {
    const graph = getGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.stats.totalFiles).toBeGreaterThan(0);
  });

  it("returns the project name", () => {
    expect(getProjectName()).toBe("test-project");
  });
});

describe("GET /api/graph", () => {
  it("returns nodes, edges, and stats", async () => {
    const { GET } = await import("../../app/api/graph/route.js");
    const response = GET();
    const data = await response.json();

    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("edges");
    expect(data).toHaveProperty("stats");
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.stats.totalFiles).toBeGreaterThan(0);
  });

  it("includes metrics on file nodes", async () => {
    const { GET } = await import("../../app/api/graph/route.js");
    const response = GET();
    const data = await response.json();
    const node = data.nodes[0];

    expect(node).toHaveProperty("id");
    expect(node).toHaveProperty("label");
    expect(node).toHaveProperty("path");
    expect(node).toHaveProperty("loc");
    expect(node).toHaveProperty("module");
    expect(node).toHaveProperty("pageRank");
    expect(node).toHaveProperty("coupling");
    expect(node).toHaveProperty("fanIn");
    expect(node).toHaveProperty("fanOut");
    expect(node).toHaveProperty("functions");
  });

  it("includes edge properties", async () => {
    const { GET } = await import("../../app/api/graph/route.js");
    const response = GET();
    const data = await response.json();

    if (data.edges.length > 0) {
      const edge = data.edges[0];
      expect(edge).toHaveProperty("source");
      expect(edge).toHaveProperty("target");
      expect(edge).toHaveProperty("symbols");
      expect(edge).toHaveProperty("weight");
    }
  });
});

describe("GET /api/meta", () => {
  it("returns project name", async () => {
    const { GET } = await import("../../app/api/meta/route.js");
    const response = GET();
    const data = await response.json();

    expect(data.projectName).toBe("test-project");
  });
});

describe("GET /api/ping", () => {
  it("returns ok: true", async () => {
    const { GET } = await import("../../app/api/ping/route.js");
    const response = GET();
    const data = await response.json();

    expect(data.ok).toBe(true);
  });
});

describe("GET /api/modules", () => {
  it("returns module metrics", async () => {
    const { GET } = await import("../../app/api/modules/route.js");
    const response = GET();
    const data = await response.json();

    expect(data).toHaveProperty("modules");
    expect(Array.isArray(data.modules)).toBe(true);
  });
});

describe("GET /api/forces", () => {
  it("returns force analysis data", async () => {
    const { GET } = await import("../../app/api/forces/route.js");
    const response = GET();
    const data = await response.json();

    expect(data).toHaveProperty("moduleCohesion");
    expect(data).toHaveProperty("tensionFiles");
    expect(data).toHaveProperty("bridgeFiles");
    expect(data).toHaveProperty("extractionCandidates");
    expect(data).toHaveProperty("summary");
  });
});

describe("GET /api/hotspots", () => {
  it("returns hotspots sorted by score", async () => {
    const { GET } = await import("../../app/api/hotspots/route.js");
    const request = new Request("http://localhost/api/hotspots?metric=coupling&limit=5");
    const response = GET(request);
    const data = await response.json();

    expect(data).toHaveProperty("metric", "coupling");
    expect(data).toHaveProperty("hotspots");
    expect(data.hotspots.length).toBeLessThanOrEqual(5);
  });

  it("defaults to coupling metric", async () => {
    const { GET } = await import("../../app/api/hotspots/route.js");
    const request = new Request("http://localhost/api/hotspots");
    const response = GET(request);
    const data = await response.json();

    expect(data).toHaveProperty("metric", "coupling");
    expect(data).toHaveProperty("hotspots");
  });
});

describe("GET /api/file/[...path]", () => {
  it("returns file details for valid path", async () => {
    const { GET } = await import("../../app/api/file/[...path]/route.js");
    const graph = getGraph();
    const firstFile = graph.nodes.find((n) => n.type === "file");
    if (!firstFile) throw new Error("No files in graph");

    const segments = firstFile.path.split("/");
    const request = new Request(`http://localhost/api/file/${firstFile.path}`);
    const response = await GET(request, { params: Promise.resolve({ path: segments }) });
    const data = await response.json();

    expect(data).toHaveProperty("path");
    expect(data).toHaveProperty("metrics");
    expect(data.metrics).toHaveProperty("pageRank");
    expect(data.metrics).toHaveProperty("fanIn");
  });

  it("returns 404 for unknown file", async () => {
    const { GET } = await import("../../app/api/file/[...path]/route.js");
    const request = new Request("http://localhost/api/file/nonexistent.ts");
    const response = await GET(request, { params: Promise.resolve({ path: ["nonexistent.ts"] }) });

    expect(response.status).toBe(404);
  });
});

describe("GET /api/groups", () => {
  it("returns object with groups array", async () => {
    const { GET } = await import("../../app/api/groups/route.js");
    const response = GET();
    const data = await response.json() as { groups: Array<Record<string, unknown>> };

    expect(Array.isArray(data.groups)).toBe(true);
  });

  it("each group has required fields", async () => {
    const { GET } = await import("../../app/api/groups/route.js");
    const response = GET();
    const data = await response.json() as { groups: Array<Record<string, unknown>> };

    if (data.groups.length > 0) {
      const group = data.groups[0];
      expect(group).toHaveProperty("name");
      expect(group).toHaveProperty("files");
      expect(group).toHaveProperty("loc");
      expect(group).toHaveProperty("importance");
      expect(group).toHaveProperty("fanIn");
      expect(group).toHaveProperty("fanOut");
      expect(group).toHaveProperty("color");
    }
  });

  it("groups are sorted by importance descending", async () => {
    const { GET } = await import("../../app/api/groups/route.js");
    const response = GET();
    const data = await response.json() as { groups: Array<{ importance: number }> };

    for (let i = 1; i < data.groups.length; i++) {
      expect(data.groups[i - 1].importance).toBeGreaterThanOrEqual(data.groups[i].importance);
    }
  });
});

describe("POST /api/mcp", () => {
  it("lists available tools on GET", async () => {
    const { GET } = await import("../../app/api/mcp/route.js");
    const response = GET();
    const data = await response.json();

    expect(data).toHaveProperty("tools");
    expect(data.tools.length).toBe(8);
    expect(data.tools.map((t: { name: string }) => t.name)).toContain("codebase_overview");
    expect(data.tools.map((t: { name: string }) => t.name)).toContain("get_groups");
  });

  it("invokes codebase_overview tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "codebase_overview" }),
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data).toHaveProperty("content");
    expect(data.content[0].type).toBe("text");
    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("totalFiles");
    expect(parsed).toHaveProperty("modules");
  });

  it("invokes file_context tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const graph = getGraph();
    const firstFile = graph.nodes.find((n) => n.type === "file");
    if (!firstFile) throw new Error("No files in graph");

    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "file_context", params: { filePath: firstFile.path } }),
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.isError).toBeUndefined();
    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("path");
    expect(parsed).toHaveProperty("metrics");
  });

  it("invokes find_hotspots tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "find_hotspots", params: { metric: "coupling", limit: 3 } }),
    });
    const response = await POST(request);
    const data = await response.json();

    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("metric", "coupling");
    expect(parsed).toHaveProperty("hotspots");
    expect(parsed.hotspots.length).toBeLessThanOrEqual(3);
  });

  it("invokes get_module_structure tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "get_module_structure" }),
    });
    const response = await POST(request);
    const data = await response.json();

    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("modules");
    expect(parsed).toHaveProperty("circularDeps");
  });

  it("invokes analyze_forces tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "analyze_forces" }),
    });
    const response = await POST(request);
    const data = await response.json();

    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("moduleCohesion");
    expect(parsed).toHaveProperty("summary");
  });

  it("invokes find_dead_exports tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "find_dead_exports" }),
    });
    const response = await POST(request);
    const data = await response.json();

    const parsed = JSON.parse(data.content[0].text);
    expect(parsed).toHaveProperty("totalDeadExports");
    expect(parsed).toHaveProperty("files");
  });

  it("invokes get_groups tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "get_groups" }),
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data).toHaveProperty("content");
    expect(data.content[0].type).toBe("text");
  });

  it("returns error for unknown tool", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "nonexistent_tool" }),
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.isError).toBe(true);
  });

  it("returns 400 for missing tool field", async () => {
    const { POST } = await import("../../app/api/mcp/route.js");
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });
});
