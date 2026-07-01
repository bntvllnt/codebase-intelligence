import fs from "fs";
import path from "path";

export interface ConfigMigrationResult {
  source: string;
  dryRun: boolean;
  target: string;
  generated: Record<string, unknown>;
  warnings: string[];
  changed: boolean;
  summary: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function migrateConfig(rootDir: string, options: { source?: string; write?: boolean } = {}): ConfigMigrationResult {
  const root = path.resolve(rootDir);
  const source = options.source ?? "auto";
  const target = path.join(root, "codebase-intelligence.json");
  const warnings: string[] = [];
  const generated: Record<string, unknown> = {
    $schema: "./schema.json",
    rules: {},
    ci: { gate: "new-only", failOn: "error" },
  };

  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson && typeof packageJson === "object" && "codebaseIntelligence" in packageJson) {
    warnings.push("package.json already contains codebaseIntelligence config; prefer dedicated codebase-intelligence.json for agent workflows.");
  }

  const existing = readJson(target);
  if (existing && typeof existing === "object") {
    warnings.push("codebase-intelligence.json already exists; dry-run output leaves it unchanged.");
    Object.assign(generated, existing);
  }

  const dryRun = options.write !== true;
  if (!dryRun) {
    fs.writeFileSync(target, `${JSON.stringify(generated, null, 2)}\n`);
  }

  return {
    source,
    dryRun,
    target,
    generated,
    warnings,
    changed: !dryRun,
    summary: dryRun ? `Dry-run config migration to ${target}` : `Wrote ${target}`,
  };
}

export function formatConfigMigrationText(result: ConfigMigrationResult): string {
  const lines = [result.summary, `source=${result.source}`, `dryRun=${String(result.dryRun)}`];
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
