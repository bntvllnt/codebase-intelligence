import fs from "fs";
import path from "path";
import { z } from "zod";
import type { CodebaseIntelligenceConfig, OutputFormat } from "../types/index.js";

/** Thrown on missing/invalid config. The CLI maps this to exit code 2. */
export class ConfigError extends Error {
  readonly configPath: string | undefined;
  constructor(message: string, configPath?: string) {
    super(message);
    this.name = "ConfigError";
    this.configPath = configPath;
  }
}

/** Overrides supplied from CLI flags. They win over file values. */
export interface ConfigOverrides {
  configPath?: string;
  format?: OutputFormat;
  quiet?: boolean;
  summary?: boolean;
  failOn?: "error" | "warn" | "never";
  gate?: "all" | "new-only";
  base?: string;
  diffFile?: string;
  changedSince?: string;
  production?: boolean;
}

const CONFIG_FILENAMES = [
  "codebase-intelligence.json",
  ".codebase-intelligence.json",
  ".codebase-intelligencerc.json",
  ".codebase-intelligencerc",
];

const severitySchema = z.union([
  z.enum(["off", "warn", "error"]),
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);

// Options only make sense for an enabled rule — "off"/0 with options is rejected.
const activeSeveritySchema = z.union([z.enum(["warn", "error"]), z.literal(1), z.literal(2)]);

const ruleSettingSchema = z.union([
  severitySchema,
  z.tuple([activeSeveritySchema, z.record(z.string(), z.unknown())]),
]);

const configSchema = z
  .object({
    $schema: z.string().optional(),
    root: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    entry: z.array(z.string()).optional(),
    ignore: z
      .object({
        dependencies: z.array(z.string()).optional(),
        unresolvedImports: z.array(z.string()).optional(),
        exportsUsedInFile: z.boolean().optional(),
      })
      .strict()
      .optional(),
    rules: z.record(z.string(), ruleSettingSchema).optional(),
    boundaries: z
      .object({
        preset: z.enum(["bulletproof", "layered", "hexagonal", "feature-sliced"]).optional(),
        zones: z
          .array(
            z
              .object({
                name: z.string(),
                patterns: z.array(z.string()),
                autoDiscover: z.boolean().optional(),
              })
              .strict(),
          )
          .optional(),
        rules: z
          .array(
            z
              .object({
                from: z.string(),
                allow: z.array(z.string()).optional(),
                forbid: z.array(z.string()).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({ health: z.object({ minScore: z.number() }).strict().optional() })
      .strict()
      .optional(),
    output: z
      .object({
        format: z.enum(["text", "json", "sarif", "markdown", "annotations", "pr-comment-github", "pr-comment-gitlab", "badge", "codeclimate", "compact"]).optional(),
        quiet: z.boolean().optional(),
        summary: z.boolean().optional(),
      })
      .strict()
      .optional(),
    baseline: z.string().optional(),
    ci: z
      .object({
        gate: z.enum(["all", "new-only"]).optional(),
        failOn: z.enum(["error", "warn", "never"]).optional(),
        maxWarnings: z.number().optional(),
        maxNew: z.number().optional(),
        tolerance: z.number().optional(),
        base: z.string().optional(),
        minScore: z.number().optional(),
        production: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Walk up from startDir looking for a config file or a package.json key. */
export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(pkg, "utf-8"));
        if (isRecord(parsed) && "codebaseIntelligence" in parsed) return pkg;
      } catch {
        /* malformed package.json — keep walking */
      }
    }
    // Stop at the repository root — don't inherit ambient config from parent directories.
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function applyOverrides(
  config: CodebaseIntelligenceConfig,
  overrides: ConfigOverrides | undefined,
): CodebaseIntelligenceConfig {
  if (!overrides) return config;
  const output = { ...config.output };
  if (overrides.format !== undefined) output.format = overrides.format;
  if (overrides.quiet !== undefined) output.quiet = overrides.quiet;
  if (overrides.summary !== undefined) output.summary = overrides.summary;

  const ci = { ...config.ci };
  if (overrides.failOn !== undefined) ci.failOn = overrides.failOn;
  if (overrides.gate !== undefined) ci.gate = overrides.gate;
  if (overrides.base !== undefined) ci.base = overrides.base;
  if (overrides.production !== undefined) ci.production = overrides.production;

  return { ...config, output, ci };
}

/**
 * Load config for a project root. Discovers the file (or uses overrides.configPath),
 * parses JSON, validates with zod, and applies CLI overrides.
 * @throws {ConfigError} on missing file, invalid JSON, or schema violation.
 */
export function loadConfig(
  rootDir: string,
  overrides?: ConfigOverrides,
): { config: CodebaseIntelligenceConfig; configPath: string | null } {
  const file = overrides?.configPath ? path.resolve(overrides.configPath) : findConfigFile(rootDir);

  let raw: unknown = {};
  let configPath: string | null = null;

  if (file) {
    if (!fs.existsSync(file)) throw new ConfigError(`Config file not found: ${path.basename(file)}`, file);
    configPath = file;

    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf-8");
    } catch {
      throw new ConfigError(`Config file is not readable: ${path.basename(file)}`, file);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new ConfigError(`Invalid JSON in config file: ${path.basename(file)}`, file);
    }

    if (path.basename(file) === "package.json") {
      parsed = isRecord(parsed) ? parsed.codebaseIntelligence : undefined;
    }
    raw = parsed ?? {};
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    const label = configPath ? ` (${path.basename(configPath)})` : "";
    throw new ConfigError(`Invalid config${label}: ${where} — ${issue.message}`, configPath ?? undefined);
  }

  return { config: applyOverrides(result.data, overrides), configPath };
}
