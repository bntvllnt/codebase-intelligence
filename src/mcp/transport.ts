import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import type { CodebaseGraph } from "../types/index.js";
import { registerTools } from "./index.js";

/** Create an HTTP server that serves MCP tools via StreamableHTTP transport (stateless). */
export async function createHttpMcpServer(graph: CodebaseGraph, port: number): Promise<http.Server> {
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      void (async () => {
        const server = new McpServer({
          name: "codebase-intelligence-http",
          version: "0.1.0",
        });
        registerTools(server, graph);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on("close", () => {
          void transport.close();
        });

        await server.connect(transport);

        const body = await new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          req.on("end", () => { resolve(data); });
        });

        await transport.handleRequest(req, res, body ? JSON.parse(body) as unknown : undefined);
      })();
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, "127.0.0.1", () => { resolve(); });
  });

  return httpServer;
}
