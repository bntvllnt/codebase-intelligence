import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph, setIndexedHead } from "../src/server/graph-store.js";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
  setIndexedHead("abc123");
});

describe("5.1 — file tree renders from GET /api/graph", () => {
  it("graph response nodes have path and module for directory grouping", async () => {
    const { GET } = await import("../app/api/graph/route.js");
    const response = GET();
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      nodes: Array<{ id: string; path: string; module: string; type: string }>;
    };

    const fileNodes = data.nodes.filter((n) => n.type === "file");
    expect(fileNodes.length).toBeGreaterThan(0);

    for (const node of fileNodes) {
      expect(node).toHaveProperty("path");
      expect(node).toHaveProperty("module");
      expect(node.path.length).toBeGreaterThan(0);
    }

    const modules = [...new Set(fileNodes.map((n) => n.module))];
    expect(modules.length).toBeGreaterThanOrEqual(2);
  });
});

describe("5.2 — search bar calls GET /api/search", () => {
  it("search returns ranked results with file and score", async () => {
    const { GET } = await import("../app/api/search/route.js");
    const request = new Request("http://localhost/api/search?q=auth");
    const response = GET(request);
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      query: string;
      results: Array<{ file: string; score: number; symbols: Array<{ name: string }> }>;
    };

    expect(data.query).toBe("auth");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]).toHaveProperty("file");
    expect(data.results[0]).toHaveProperty("score");
  });
});

describe("5.3 — symbol disambiguation", () => {
  it("GET /api/symbols/:name resolves re-exports to source definition", async () => {
    const { GET } = await import("../app/api/symbols/[name]/route.js");
    const request = new Request("http://localhost/api/symbols/AuthService");
    const response = await GET(request, { params: Promise.resolve({ name: "AuthService" }) });
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      disambiguation?: Array<{ name: string; file: string; symbolId: string }>;
      name?: string;
      file?: string;
    };

    expect(data.disambiguation).toBeUndefined();
    expect(data.name).toBe("AuthService");
    expect(data.file).toBe("auth/auth-service.ts");
  });

  it("GET /api/symbols/:name returns disambiguation when multiple source files", async () => {
    const { GET } = await import("../app/api/symbols/[name]/route.js");
    const request = new Request("http://localhost/api/symbols/getUserById");
    const response = await GET(request, { params: Promise.resolve({ name: "getUserById" }) });
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      name?: string;
      file?: string;
    };

    expect(data.name).toBe("getUserById");
    expect(data.file).toBe("users/user-repository.ts");
  });
});

describe("5.4 — staleness banner from GET /api/meta", () => {
  it("meta endpoint includes staleness info", async () => {
    const { GET } = await import("../app/api/meta/route.js");
    const response = GET();
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      projectName: string;
      staleness: { stale: boolean; indexedHash: string };
    };

    expect(data.projectName).toBeDefined();
    expect(data.staleness).toBeDefined();
    expect(data.staleness).toHaveProperty("stale");
    expect(data.staleness).toHaveProperty("indexedHash");
    expect(data.staleness.indexedHash).toBe("abc123");
  });
});
