import { EventEmitter } from "events";
import type { CodebaseGraph } from "../types/index.js";

export interface LspDiagnostic {
  file: string;
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  severity: "warning" | "information";
  code: string;
  message: string;
}

export interface LspHoverFact {
  file: string;
  symbol?: string;
  markdown: string;
}

export interface LspSnapshot {
  diagnostics: LspDiagnostic[];
  hovers: LspHoverFact[];
  summary: string;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
}

function diagnosticForFile(file: string, complexity: number, blastRadius: number): LspDiagnostic | null {
  if (complexity < 10 && blastRadius < 8) return null;
  return {
    file,
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    severity: "warning",
    code: "codebase-intelligence/risk",
    message: `Risk hotspot: complexity ${complexity.toFixed(1)}, blast radius ${String(blastRadius)}`,
  };
}

export function computeLspSnapshot(graph: CodebaseGraph): LspSnapshot {
  const diagnostics: LspDiagnostic[] = [];
  const hovers: LspHoverFact[] = [];
  const circularFiles = new Set(graph.stats.circularDeps.flat());

  for (const [file, metrics] of graph.fileMetrics) {
    const diagnostic = diagnosticForFile(file, metrics.cognitiveComplexity ?? metrics.cyclomaticComplexity, metrics.blastRadius);
    if (diagnostic) diagnostics.push(diagnostic);
    if (metrics.deadExports.length > 0) {
      diagnostics.push({
        file,
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        severity: "information",
        code: "codebase-intelligence/dead-export",
        message: `Dead exports: ${metrics.deadExports.slice(0, 5).join(", ")}`,
      });
    }
    if (circularFiles.has(file)) {
      diagnostics.push({
        file,
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        severity: "warning",
        code: "codebase-intelligence/circular-dependency",
        message: "File participates in a circular dependency.",
      });
    }
    hovers.push({
      file,
      markdown: [
        `**${file}**`,
        "",
        `- Fan-in: ${String(metrics.fanIn)}`,
        `- Fan-out: ${String(metrics.fanOut)}`,
        `- PageRank: ${metrics.pageRank.toFixed(4)}`,
        `- Blast radius: ${String(metrics.blastRadius)}`,
        `- Dead exports: ${String(metrics.deadExports.length)}`,
      ].join("\n"),
    });
  }

  for (const symbol of graph.symbolNodes) {
    hovers.push({
      file: symbol.file,
      symbol: symbol.name,
      markdown: [
        `**${symbol.name}**`,
        "",
        `- Type: ${symbol.type}`,
        `- Cyclomatic: ${String(symbol.complexity)}`,
        `- Cognitive: ${String(symbol.cognitiveComplexity ?? symbol.complexity)}`,
        `- Duplicate: ${symbol.duplication ? "yes" : "no"}`,
      ].join("\n"),
    });
  }

  return {
    diagnostics: diagnostics.sort((left, right) => left.file.localeCompare(right.file)),
    hovers: hovers.sort((left, right) => left.file.localeCompare(right.file) || (left.symbol ?? "").localeCompare(right.symbol ?? "")),
    summary: `${String(diagnostics.length)} diagnostic(s), ${String(hovers.length)} hover fact(s).`,
  };
}

function frame(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function response(id: JsonRpcMessage["id"], result: unknown): string {
  return frame({ jsonrpc: "2.0", id, result });
}

function notification(method: string, params: unknown): string {
  return frame({ jsonrpc: "2.0", method, params });
}

function parseMessages(buffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = [];
  let rest = buffer;
  for (;;) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      rest = rest.slice(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (rest.length < bodyStart + length) break;
    const body = rest.slice(bodyStart, bodyStart + length);
    rest = rest.slice(bodyStart + length);
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") messages.push(parsed as JsonRpcMessage);
  }
  return { messages, rest };
}

export function startLspServer(graph: CodebaseGraph): EventEmitter {
  const emitter = new EventEmitter();
  const snapshot = computeLspSnapshot(graph);
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parsed = parseMessages(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      if (message.method === "initialize") {
        process.stdout.write(response(message.id, {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
          },
          serverInfo: { name: "codebase-intelligence-lsp" },
        }));
      } else if (message.method === "textDocument/didOpen") {
        process.stdout.write(notification("textDocument/publishDiagnostics", { diagnostics: snapshot.diagnostics }));
      } else if (message.method === "textDocument/hover") {
        process.stdout.write(response(message.id, { contents: snapshot.hovers[0]?.markdown ?? "No facts." }));
      } else if (message.method === "shutdown") {
        process.stdout.write(response(message.id, null));
      } else if (message.method === "exit") {
        emitter.emit("exit");
      }
    }
  });

  return emitter;
}

export function formatLspSnapshotText(snapshot: LspSnapshot): string {
  const lines = ["LSP diagnostics snapshot", snapshot.summary, ""];
  for (const diagnostic of snapshot.diagnostics.slice(0, 10)) {
    lines.push(`${diagnostic.file}:${String(diagnostic.range.startLine)} ${diagnostic.code} — ${diagnostic.message}`);
  }
  return lines.join("\n");
}
