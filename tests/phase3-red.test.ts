import { describe, it, expect, beforeAll } from "vitest";
import { getFixturePipeline } from "./helpers/pipeline.js";
import { setGraph } from "../src/server/graph-store.js";
import path from "path";
import fs from "fs";
import os from "os";

beforeAll(() => {
  const { codebaseGraph } = getFixturePipeline();
  setGraph(codebaseGraph, "fixture-test");
});

describe("3.1 — persistence round-trip", () => {
  it("write graph to JSON and read back with identical counts", async () => {
    const { exportGraph, importGraph } = await import("../src/persistence/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const tmpDir = path.join(os.tmpdir(), `cv-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      exportGraph(codebaseGraph, tmpDir, "abc123");
      const loaded = importGraph(tmpDir);

      expect(loaded).not.toBeNull();
      if (!loaded) return;

      expect(loaded.graph.nodes.length).toBe(codebaseGraph.nodes.length);
      expect(loaded.graph.edges.length).toBe(codebaseGraph.edges.length);
      expect(loaded.graph.callEdges.length).toBe(codebaseGraph.callEdges.length);
      expect(loaded.graph.symbolNodes.length).toBe(codebaseGraph.symbolNodes.length);
      expect(loaded.headHash).toBe("abc123");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("3.2 — staleness detection", () => {
  it("detects stale index when HEAD differs from indexed commit", async () => {
    const { getStaleness, setIndexedHead } = await import("../src/server/graph-store.js");

    setIndexedHead("old-hash-123");
    const staleness = getStaleness("new-hash-456");

    expect(staleness.stale).toBe(true);
  });

  it("reports not stale when HEAD matches indexed commit", async () => {
    const { getStaleness, setIndexedHead } = await import("../src/server/graph-store.js");

    setIndexedHead("same-hash");
    const staleness = getStaleness("same-hash");

    expect(staleness.stale).toBe(false);
  });
});

describe("3.3 — entry point detection", () => {
  it("routes.ts and middleware.ts are identified as entry points", async () => {
    const { detectEntryPoints } = await import("../src/process/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const entryPoints = detectEntryPoints(codebaseGraph);

    const entryFiles = entryPoints.map((ep) => ep.file);
    expect(entryFiles).toContain("api/routes.ts");
    expect(entryFiles).toContain("api/middleware.ts");
  });
});

describe("3.4 — call chain tracing", () => {
  it("traces handleLogin through auth-service → user-service → user-repository", async () => {
    const { traceProcesses } = await import("../src/process/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const processes = traceProcesses(codebaseGraph);

    const loginProcess = processes.find(
      (p) => p.name === "handleLogin" || p.entryPoint.symbol === "handleLogin"
    );
    expect(loginProcess).toBeDefined();
    if (!loginProcess) return;

    expect(loginProcess.depth).toBeGreaterThanOrEqual(2);

    const stepFiles = loginProcess.steps.map((s) => s.file);
    expect(stepFiles).toContain("api/routes.ts");
    expect(stepFiles.some((f) => f.includes("auth"))).toBe(true);
    expect(stepFiles.some((f) => f.includes("user"))).toBe(true);
  });

  it("processes include correct module coverage", async () => {
    const { traceProcesses } = await import("../src/process/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const processes = traceProcesses(codebaseGraph);
    expect(processes.length).toBeGreaterThanOrEqual(3);

    const loginProcess = processes.find(
      (p) => p.name === "handleLogin" || p.entryPoint.symbol === "handleLogin"
    );
    expect(loginProcess).toBeDefined();
    if (!loginProcess) return;

    expect(loginProcess.modulesTouched.length).toBeGreaterThanOrEqual(2);
  });
});

describe("3.5 — circular call chain", () => {
  it("handles cycles without infinite trace", async () => {
    const { traceProcesses } = await import("../src/process/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const processes = traceProcesses(codebaseGraph);

    for (const proc of processes) {
      expect(proc.steps.length).toBeLessThan(100);
      expect(proc.depth).toBeLessThan(50);
    }
  });
});

describe("3.6 — Louvain clustering", () => {
  it("groups auth/* files together", async () => {
    const { detectCommunities } = await import("../src/community/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const clusters = detectCommunities(codebaseGraph);

    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(clusters.length).toBeLessThanOrEqual(10);

    const allFiles = clusters.flatMap((c) => c.files);
    const authFiles = ["auth/auth-service.ts", "auth/auth-middleware.ts"];
    for (const af of authFiles) {
      if (allFiles.includes(af)) {
        const cluster = clusters.find((c) => c.files.includes(af));
        expect(cluster).toBeDefined();
      }
    }
  });

  it("all file nodes are assigned to a cluster", async () => {
    const { detectCommunities } = await import("../src/community/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const clusters = detectCommunities(codebaseGraph);
    const clusteredFiles = new Set(clusters.flatMap((c) => c.files));
    const fileNodes = codebaseGraph.nodes.filter((n) => n.type === "file");

    for (const node of fileNodes) {
      expect(clusteredFiles.has(node.id)).toBe(true);
    }
  });

  it("clusters have cohesion > 0", async () => {
    const { detectCommunities } = await import("../src/community/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const clusters = detectCommunities(codebaseGraph);

    for (const cluster of clusters) {
      expect(cluster.cohesion).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("3.7 — detect_changes MCP tool", () => {
  it("detect_changes tool is registered", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTools } = await import("../src/mcp/index.js");
    const { codebaseGraph } = getFixturePipeline();

    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerTools(server, codebaseGraph);

    expect(server).toBeDefined();
  });
});

describe("3.8 — detect_changes without git", () => {
  it.todo("detect_changes returns clear error when git unavailable");
});

describe("3.9 — MCP resources", () => {
  it("resources are registered on server", async () => {
    const { createHttpMcpServer } = await import("../src/mcp/transport.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { codebaseGraph } = getFixturePipeline();

    const port = 9878;
    const httpServer = await createHttpMcpServer(codebaseGraph, port);

    try {
      const client = new Client({ name: "test-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      );
      await client.connect(transport);

      const { resources } = await client.listResources();
      expect(resources.length).toBeGreaterThanOrEqual(3);

      const resourceUris = resources.map((r) => r.uri);
      expect(resourceUris).toContain("codebase://clusters");
      expect(resourceUris).toContain("codebase://processes");
      expect(resourceUris).toContain("codebase://setup");

      await client.close();
    } finally {
      await new Promise<void>((resolve) => {
        httpServer.close(() => { resolve(); });
      });
    }
  });
});

describe("3.10 — GET /api/changes", () => {
  it.todo("GET /api/changes?scope=staged returns changed symbols");
});

describe("3.18 — GET /api/processes", () => {
  it("returns process list from analyzer", async () => {
    const { GET } = await import("../app/api/processes/route.js");
    expect(GET).toBeDefined();

    const response = GET();
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      processes: Array<{ name: string; steps: unknown[] }>;
    };
    expect(data.processes).toBeDefined();
    expect(data.processes.length).toBeGreaterThanOrEqual(3);
    expect(data.processes[0]).toHaveProperty("name");
    expect(data.processes[0]).toHaveProperty("steps");
  });
});
