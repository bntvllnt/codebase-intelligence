import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "dist", "cli.js");
const pexec = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface DriftFinding {
  id: string;
  kind: string;
  score: number;
  file: string;
  evidenceIds: string[];
  recommendation: string;
  actions: Array<{ kind: string; command: string }>;
}

interface DriftEvidence {
  id: string;
  kind: string;
  summary: string;
}

interface DriftPayload {
  mode: "report-only";
  baseline: { status: "not-configured"; requiredForGate: true };
  minScore: number;
  totalFindings: number;
  findings: DriftFinding[];
  evidence: DriftEvidence[];
  cache?: unknown;
  nextSteps?: unknown;
}

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriftPayload(value: unknown): value is DriftPayload {
  return isRecord(value)
    && value.mode === "report-only"
    && isRecord(value.baseline)
    && Array.isArray(value.findings)
    && Array.isArray(value.evidence);
}

function parsePayload(stdout: string): DriftPayload {
  const parsed: unknown = JSON.parse(stdout);
  if (!isDriftPayload(parsed)) throw new Error("Expected content drift JSON object");
  return parsed;
}

function withoutRuntimeFields(payload: DriftPayload): Omit<DriftPayload, "cache" | "nextSteps"> {
  const copy = { ...payload };
  delete copy.cache;
  delete copy.nextSteps;
  return copy;
}

function textPayload(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("MCP result did not include content");
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") throw new Error("MCP result did not include text content");
  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) throw new Error("MCP text content was not a JSON object");
  return parsed;
}

async function run(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await pexec("node", [cli, ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    const err = isRecord(e) ? e : {};
    return {
      status: typeof err.code === "number" ? err.code : 1,
      stdout: typeof err.stdout === "string" ? err.stdout : "",
      stderr: typeof err.stderr === "string" ? err.stderr : "",
    };
  }
}

function writeFile(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createDriftFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-drift-"));
  const src = path.join(root, "src");

  writeFile(src, "users/profile.ts", `
export interface UserProfile {
  id: string;
  email: string;
}

export function createUserProfile(id: string): UserProfile {
  return { id, email: \`\${id}@example.test\` };
}

export function getUserProfile(id: string): UserProfile {
  return createUserProfile(id);
}
`);

  writeFile(src, "audit/audit-log.ts", `
export function writeAuditLog(event: string): void {
  void event;
}
`);

  writeFile(src, "mailer/email.ts", `
import { writeAuditLog } from "../audit/audit-log";
import type { UserProfile } from "../users/profile";

export function sendWelcomeEmail(profile: UserProfile): void {
  writeAuditLog(profile.id);
}
`);

  writeFile(src, "billing/invoice-calculator.ts", `
import { writeAuditLog } from "../audit/audit-log";
import { sendWelcomeEmail } from "../mailer/email";
import type { UserProfile } from "../users/profile";

export function calculateInvoice(profile: UserProfile): number {
  writeAuditLog(profile.id);
  return profile.email.length;
}

export function validateUserAccess(profile: UserProfile): boolean {
  return profile.id.length > 0;
}

export function prepareWelcomeEmail(profile: UserProfile): void {
  sendWelcomeEmail(profile);
}
`);

  writeFile(src, "auth/session.ts", `
import { writeAuditLog } from "../audit/audit-log";
import { calculateInvoice } from "../billing/invoice-calculator";
import type { UserProfile } from "../users/profile";

export function refreshSession(profile: UserProfile): number {
  writeAuditLog(profile.id);
  return calculateInvoice(profile);
}
`);

  writeFile(src, "utils/formatter.ts", `
import { writeAuditLog } from "../audit/audit-log";

export function formatDisplayName(name: string): string {
  writeAuditLog(name);
  return name.trim().toUpperCase();
}
`);

  writeFile(src, "reports/session.spec.ts", `
import { refreshSession } from "../auth/session";
import { createUserProfile } from "../users/profile";

refreshSession(createUserProfile("1"));
`);

  writeFile(src, "orphans/lonely.ts", `
export function lonelyFeature(): string {
  return "alone";
}
`);

  return src;
}

function assertEvidenceReferences(payload: DriftPayload): void {
  const evidenceIds = new Set(payload.evidence.map((item) => item.id));
  expect(evidenceIds.size).toBe(payload.evidence.length);
  for (const evidence of payload.evidence) {
    expect(evidence.id).toMatch(/^evidence-[a-f0-9]{10}$/);
    expect(evidence.summary.length).toBeGreaterThan(0);
  }
  for (const finding of payload.findings) {
    expect(finding.id).toMatch(/^drift-[a-f0-9]{10}$/);
    expect(finding.score).toBeGreaterThanOrEqual(payload.minScore);
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
    expect(finding.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    expect(finding.recommendation.length).toBeGreaterThan(0);
    expect(finding.actions.length).toBeGreaterThan(0);
  }
}

describe("CH-P2-04 content drift", () => {
  it("detects deterministic drift evidence through CLI and MCP in report-only mode", async () => {
    const src = createDriftFixture();
    try {
      const args = ["drift", src, "--min-score", "35", "--json", "--force"];
      const cliRun = await run(args);
      expect(cliRun.status).toBe(0);
      expect(cliRun.stderr).toContain("Parsed");

      const cliPayload = parsePayload(cliRun.stdout);
      expect(cliPayload.mode).toBe("report-only");
      expect(cliPayload.baseline).toMatchObject({ status: "not-configured", requiredForGate: true });
      expect(cliPayload.minScore).toBe(35);
      expect(cliPayload.totalFindings).toBe(cliPayload.findings.length);
      assertEvidenceReferences(cliPayload);

      const kinds = [...new Set(cliPayload.findings.map((finding) => finding.kind))];
      expect(kinds).toEqual(expect.arrayContaining([
        "name-drift",
        "scope-drift",
        "mixed-responsibility",
        "hidden-side-effect",
        "shape-drift",
        "orphan-scope",
        "misplaced-test",
      ]));

      const scopedRun = await run(["drift", src, "--scope", "auth", "--min-score", "35", "--json"]);
      expect(scopedRun.status).toBe(0);
      const scopedPayload = parsePayload(scopedRun.stdout);
      expect(scopedPayload.findings.length).toBeGreaterThan(0);
      expect(scopedPayload.findings.every((finding) => finding.file.startsWith("auth/"))).toBe(true);

      const stableRun = await run(args);
      expect(stableRun.status).toBe(0);
      expect(parsePayload(stableRun.stdout).findings.map((finding) => finding.id)).toEqual(
        cliPayload.findings.map((finding) => finding.id),
      );

      const transport = new StdioClientTransport({
        command: "node",
        args: [cli, src, "--force"],
        cwd: repoRoot,
        stderr: "pipe",
      });
      const client = new Client({ name: "drift-e2e", version: "0.1.0" });
      await client.connect(transport);
      try {
        const result = await client.callTool({
          name: "detect_content_drift",
          arguments: { minScore: 35 },
        });
        const mcpPayload = textPayload(result);
        if (!isDriftPayload(mcpPayload)) throw new Error("Expected MCP drift payload");
        expect(withoutRuntimeFields(mcpPayload)).toEqual(withoutRuntimeFields(cliPayload));
        expect(mcpPayload).toHaveProperty("nextSteps");
      } finally {
        await client.close();
        await transport.close();
      }
    } finally {
      fs.rmSync(path.dirname(src), { recursive: true, force: true });
    }
  }, 120_000);
});
