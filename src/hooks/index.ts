import fs from "fs";
import path from "path";

export interface HooksResult {
  action: "planned" | "installed" | "removed";
  hookPath: string;
  dryRun: boolean;
  command: string;
  summary: string;
}

function hookScript(command: string): string {
  return `#!/bin/sh\n${command}\n`;
}

export function installHooks(rootDir: string, options: { dryRun?: boolean; uninstall?: boolean; command?: string } = {}): HooksResult {
  const root = path.resolve(rootDir);
  const hookPath = path.join(root, ".git", "hooks", "pre-commit");
  const command = options.command ?? "codebase-intelligence ci . --base origin/main --new-only --summary";
  const dryRun = options.dryRun !== false;

  if (options.uninstall === true) {
    if (!dryRun && fs.existsSync(hookPath)) fs.rmSync(hookPath);
    return {
      action: dryRun ? "planned" : "removed",
      hookPath,
      dryRun,
      command,
      summary: dryRun ? `Would remove ${hookPath}` : `Removed ${hookPath}`,
    };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, hookScript(command), { mode: 0o755 });
  }

  return {
    action: dryRun ? "planned" : "installed",
    hookPath,
    dryRun,
    command,
    summary: dryRun ? `Would install pre-commit hook at ${hookPath}` : `Installed pre-commit hook at ${hookPath}`,
  };
}

export function formatHooksText(result: HooksResult): string {
  return `${result.summary}\ncommand=${result.command}`;
}
