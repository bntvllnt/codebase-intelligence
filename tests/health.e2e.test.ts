import { execFile, execFileSync, execSync } from "node:child_process";
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

interface HealthFilePayload {
  file: string;
  loc: number;
  maintainabilityIndex: number;
  crapScore: number;
  riskScore: number;
  coverage: number;
  coverageSource: string;
  metrics: Record<string, unknown>;
  evidence: string[];
}

interface HealthPayload {
  score: number;
  minScore: number;
  verdict: "pass" | "fail";
  summary: string;
  components: Record<string, number>;
  coverage: {
    source: string;
    coveredFiles: number;
    totalFiles: number;
    warning?: string;
  };
  files: HealthFilePayload[];
  hotspots: HealthFilePayload[];
  actions: Array<{ command: string; reason: string }>;
  cache?: unknown;
  nextSteps?: unknown;
}

beforeAll(() => {
  if (!fs.existsSync(cli)) execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });
}, 120_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHealthFilePayload(value: unknown): value is HealthFilePayload {
  return isRecord(value)
    && typeof value.file === "string"
    && typeof value.maintainabilityIndex === "number"
    && typeof value.crapScore === "number"
    && typeof value.riskScore === "number"
    && typeof value.coverage === "number"
    && Array.isArray(value.evidence);
}

function isHealthPayload(value: unknown): value is HealthPayload {
  return isRecord(value)
    && typeof value.score === "number"
    && typeof value.minScore === "number"
    && (value.verdict === "pass" || value.verdict === "fail")
    && isRecord(value.components)
    && isRecord(value.coverage)
    && Array.isArray(value.files)
    && value.files.every(isHealthFilePayload)
    && Array.isArray(value.hotspots)
    && value.hotspots.every(isHealthFilePayload);
}

function parsePayload(stdout: string): HealthPayload {
  const parsed: unknown = JSON.parse(stdout);
  if (!isHealthPayload(parsed)) throw new Error("Expected health JSON object");
  return parsed;
}

function textPayload(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("MCP result did not include content");
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") throw new Error("MCP result did not include text content");
  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) throw new Error("MCP text content was not a JSON object");
  return parsed;
}

function withoutRuntimeFields(payload: HealthPayload): Omit<HealthPayload, "cache" | "nextSteps"> {
  const copy = { ...payload };
  delete copy.cache;
  delete copy.nextSteps;
  return copy;
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
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(root: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function gitOutput(root: string, args: readonly string[], input?: string): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Health Test",
      GIT_AUTHOR_EMAIL: "32437578+bntvllnt@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Health Test",
      GIT_COMMITTER_EMAIL: "32437578+bntvllnt@users.noreply.github.com",
    },
  }).trim();
}

function currentHead(root: string): string | undefined {
  try {
    return gitOutput(root, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return undefined;
  }
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "."]);
  const tree = gitOutput(root, ["write-tree"]);
  const parent = currentHead(root);
  const args = ["-c", "commit.gpgsign=false", "commit-tree", tree];
  if (parent) args.push("-p", parent);
  const commit = gitOutput(root, args, `${message}\n`);
  git(root, ["update-ref", "HEAD", commit]);
}

function createHealthFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-health-"));

  writeFile(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2));
  writeFile(root, "src/shared/math.ts", "export function add(left: number, right: number): number {\n  return left + right;\n}\n");
  writeFile(root, "src/shared/math.test.ts", "import { add } from \"./math\";\n\nexport const result = add(1, 2);\n");
  writeFile(root, "src/risky/process.ts", [
    "export interface OrderInput {",
    "  items: number[];",
    "  vip: boolean;",
    "  blocked: boolean;",
    "  retries: number;",
    "}",
    "",
    "export function processOrder(input: OrderInput): number {",
    "  let score = 0;",
    "  if (input.blocked) return -1;",
    "  for (const item of input.items) {",
    "    if (item > 50) score += item;",
    "    else if (item > 20) score += 10;",
    "    else score += 1;",
    "    if (input.vip && item % 2 === 0) score += 5;",
    "    if (!input.vip && item < 0) score -= 10;",
    "  }",
    "  if (input.retries > 3) score -= 20;",
    "  if (score > 100) return 100;",
    "  if (score < 0) return 0;",
    "  return score;",
    "}",
    "",
    "export const riskVersion = 0;",
    "",
  ].join("\n"));
  writeFile(root, "src/entry-a.ts", "import { processOrder } from \"./risky/process\";\n\nexport const a = processOrder({ items: [1], vip: false, blocked: false, retries: 0 });\n");
  writeFile(root, "src/entry-b.ts", "import { processOrder } from \"./risky/process\";\n\nexport const b = processOrder({ items: [2], vip: true, blocked: false, retries: 1 });\n");
  writeFile(root, "src/entry-c.ts", "import { processOrder } from \"./risky/process\";\n\nexport const c = processOrder({ items: [3], vip: false, blocked: false, retries: 2 });\n");

  git(root, ["init"]);
  git(root, ["config", "user.email", "32437578+bntvllnt@users.noreply.github.com"]);
  git(root, ["config", "user.name", "Health Test"]);
  commitAll(root, "initial");

  for (const version of [1, 2, 3]) {
    const processPath = path.join(root, "src/risky/process.ts");
    const next = fs.readFileSync(processPath, "utf-8").replace(/riskVersion = \d+/, `riskVersion = ${version}`);
    fs.writeFileSync(processPath, next);
    commitAll(root, `risk churn ${version}`);
  }

  fs.mkdirSync(path.join(root, "coverage"), { recursive: true });
  const coverage = {
    [path.join(root, "src/shared/math.ts")]: { s: { "0": 1, "1": 1 } },
    [path.join(root, "src/risky/process.ts")]: { s: { "0": 1, "1": 0, "2": 0, "3": 0 } },
  };
  fs.writeFileSync(path.join(root, "coverage/coverage-final.json"), JSON.stringify(coverage, null, 2));

  return root;
}

describe("CH-P2-05 health score chain", () => {
  it("scores maintainability, CRAP, risk hotspots, stable exits, and MCP parity", async () => {
    const root = createHealthFixture();
    try {
      const passRun = await run(["health", root, "--min-score", "0", "--json", "--force"]);
      expect(passRun.status).toBe(0);
      expect(passRun.stderr).toContain("Parsed");

      const cliPayload = parsePayload(passRun.stdout);
      expect(cliPayload.verdict).toBe("pass");
      expect(cliPayload.minScore).toBe(0);
      expect(cliPayload.coverage.source).toBe("istanbul");
      expect(cliPayload.hotspots[0]?.file).toBe("src/risky/process.ts");

      const risky = cliPayload.files.find((file) => file.file === "src/risky/process.ts");
      const stable = cliPayload.files.find((file) => file.file === "src/shared/math.ts");
      if (!risky || !stable) throw new Error("Expected risky and stable files");
      const riskyComplexity = risky.metrics.complexity;
      if (typeof riskyComplexity !== "number") throw new Error("Expected numeric complexity");
      expect(risky.maintainabilityIndex).toBeLessThan(stable.maintainabilityIndex);
      expect(risky.crapScore).toBeGreaterThan(riskyComplexity);
      expect(risky.riskScore).toBeGreaterThan(stable.riskScore);
      expect(risky.coverageSource).toBe("istanbul");

      const failRun = await run(["health", root, "--min-score", "100", "--json"]);
      expect(failRun.status).toBe(1);
      expect(parsePayload(failRun.stdout).verdict).toBe("fail");

      const scoreRun = await run(["health", root, "--score", "--min-score", "0"]);
      expect(scoreRun.status).toBe(0);
      expect(scoreRun.stdout).toContain("Health Score:");

      const riskRun = await run(["hotspots", root, "--metric", "risk", "--limit", "1", "--json"]);
      expect(riskRun.status).toBe(0);
      const riskPayload: unknown = JSON.parse(riskRun.stdout);
      if (!isRecord(riskPayload) || !Array.isArray(riskPayload.hotspots)) throw new Error("Expected hotspots payload");
      expect(riskPayload.hotspots[0]).toMatchObject({ path: "src/risky/process.ts" });

      const transport = new StdioClientTransport({
        command: "node",
        args: [cli, root, "--force"],
        cwd: repoRoot,
        stderr: "pipe",
      });
      const client = new Client({ name: "health-e2e", version: "0.1.0" });
      await client.connect(transport);
      try {
        const result = await client.callTool({
          name: "get_health_score",
          arguments: { minScore: 0 },
        });
        const mcpPayloadRecord = textPayload(result);
        if (!isHealthPayload(mcpPayloadRecord)) throw new Error("Expected MCP health payload");
        expect(withoutRuntimeFields(mcpPayloadRecord)).toEqual(withoutRuntimeFields(cliPayload));
        expect(mcpPayloadRecord).toHaveProperty("nextSteps");
      } finally {
        await client.close();
        await transport.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
