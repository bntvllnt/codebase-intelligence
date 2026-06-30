#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const cli = path.join(root, "dist", "cli.js");

const defaultTargets = [
  { name: "codebase-intelligence", path: root, file: "src/install/index.ts", symbol: "upsertManagedBlock" },
  {
    name: "create-vllnt-app-cli",
    path: "/home/ubuntu/vllnt-toolbox/create-vllnt-app/cli",
    file: "src/core/doctor.ts",
    symbol: "runDoctor",
  },
  {
    name: "create-vllnt-app-www",
    path: "/home/ubuntu/vllnt-toolbox/create-vllnt-app/www",
    file: "app/[locale]/(marketing)/layout.tsx",
    symbol: "default",
  },
];

const extraTargets = (process.env.CBI_REAL_TARGETS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((targetPath, index) => ({
    name: `external-${index + 1}`,
    path: targetPath,
    file: "",
    symbol: "",
  }));

const targets = [...defaultTargets, ...extraTargets].filter((target) => fs.existsSync(target.path));

let pass = 0;
let fail = 0;

function run(args, okCodes = [0]) {
  const result = spawnSync("node", [cli, ...args], {
    encoding: "utf-8",
    cwd: root,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (!okCodes.includes(result.status)) {
    throw new Error(
      `exit ${result.status}: ${args.join(" ")}\n${result.stderr.slice(0, 800)}\n${result.stdout.slice(0, 800)}`,
    );
  }
  return result;
}

function json(args, okCodes = [0]) {
  return JSON.parse(run([...args, "--json"], okCodes).stdout);
}

function record(name, fn) {
  try {
    const detail = fn();
    pass += 1;
    console.log(`PASS\t${name}\t${detail ?? ""}`);
  } catch (error) {
    fail += 1;
    console.log(`FAIL\t${name}\t${error instanceof Error ? error.message : String(error)}`);
  }
}

function arrayAt(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function discoverFileAndSymbol(target) {
  if (target.file && target.symbol) return target;
  const hotspots = json(["hotspots", target.path, "--metric", "tension", "--limit", "12"]);
  for (const item of arrayAt(hotspots, ["hotspots", "files", "results"])) {
    const file = item?.file ?? item?.path ?? item?.id ?? item?.relativePath;
    if (typeof file !== "string") continue;
    const context = json(["file", target.path, file]);
    const exported = arrayAt(context, ["exports"]).find((entry) => typeof entry?.name === "string");
    if (typeof exported?.name === "string") return { ...target, file, symbol: exported.name };
  }
  throw new Error(`Could not discover exported symbol for ${target.name}`);
}

record("version", () => {
  const version = run(["--version"]).stdout.trim();
  if (!/^2\.\d+\.\d+/.test(version)) throw new Error(`unexpected version ${version}`);
  return version;
});

for (const inputTarget of targets) {
  const target = discoverFileAndSymbol(inputTarget);

  record(`${target.name}: overview`, () => {
    const overview = json(["overview", target.path]);
    const files = overview.files ?? overview.fileCount ?? overview.totalFiles;
    if (typeof files !== "number") throw new Error("missing file count");
    return `${files} files`;
  });

  record(`${target.name}: hotspots`, () => {
    const hotspots = json(["hotspots", target.path, "--metric", "tension", "--limit", "8"]);
    if (arrayAt(hotspots, ["hotspots", "files", "results"]).length === 0) throw new Error("empty hotspots");
    return "ranked";
  });

  record(`${target.name}: file`, () => {
    const result = json(["file", target.path, target.file]);
    const exports = arrayAt(result, ["exports"]);
    if (!result.path || !exports.some((entry) => entry.name === target.symbol)) {
      throw new Error("missing expected export");
    }
    return `${target.file} / ${target.symbol}`;
  });

  record(`${target.name}: search`, () => {
    const result = json(["search", target.path, "auth"]);
    if (!("results" in result)) throw new Error("missing results");
    return `${Array.isArray(result.results) ? result.results.length : 0} results`;
  });

  record(`${target.name}: changes`, () => {
    const result = json(["changes", target.path]);
    if (!("changedFiles" in result)) throw new Error("missing changedFiles");
    return `${result.changedFiles.length} changed`;
  });

  record(`${target.name}: dependents`, () => {
    const result = json(["dependents", target.path, target.file]);
    if (!("directDependents" in result) || !("transitiveDependents" in result)) {
      throw new Error("missing dependent arrays");
    }
    return `${result.totalAffected} affected`;
  });

  for (const command of ["modules", "forces", "dead-exports", "groups", "processes", "clusters"]) {
    record(`${target.name}: ${command}`, () => {
      const result = json([command, target.path]);
      if (!result || typeof result !== "object") throw new Error("invalid JSON object");
      return "json ok";
    });
  }

  record(`${target.name}: check`, () => {
    const output = run(["check", target.path, "--format", "json"], [0, 1]);
    const result = JSON.parse(output.stdout);
    if (!("verdict" in result) && !("findings" in result)) throw new Error("missing verdict/findings");
    return `exit ${output.status}`;
  });

  record(`${target.name}: symbol`, () => {
    const result = json(["symbol", target.path, target.symbol]);
    if (result.name !== target.symbol) throw new Error("wrong symbol");
    return target.symbol;
  });

  record(`${target.name}: impact`, () => {
    const result = json(["impact", target.path, target.symbol]);
    if (result.symbol !== target.symbol) throw new Error("wrong symbol");
    return `${result.totalAffected} affected`;
  });

  record(`${target.name}: rename`, () => {
    const result = json(["rename", target.path, target.symbol, `${target.symbol}Renamed`]);
    if (result.oldName !== target.symbol || typeof result.totalReferences !== "number") {
      throw new Error("bad rename payload");
    }
    return `${result.totalReferences} refs`;
  });
}

record("init: temp repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-init-matrix-"));
  try {
    const result = json(["init", dir, "--yes"]);
    if (!fs.existsSync(path.join(dir, "AGENTS.md")) || !fs.existsSync(path.join(dir, "CLAUDE.md"))) {
      throw new Error("missing agent files");
    }
    if (!result || typeof result !== "object") throw new Error("invalid JSON");
    return "AGENTS.md + CLAUDE.md";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

record("invalid hotspot metric exits 2", () => {
  const result = run(["hotspots", ".", "--metric", "nope", "--json"], [2]);
  if (!result.stderr.includes("--metric must be one of")) throw new Error("missing metric error");
  return "exit 2";
});

record("invalid changes scope exits 2", () => {
  const result = run(["changes", ".", "--scope", "nope", "--json"], [2]);
  if (!result.stderr.includes("--scope must be one of")) throw new Error("missing scope error");
  return "exit 2";
});

record("invalid check gate exits 2", () => {
  const result = run(["check", ".", "--gate", "future-only", "--json"], [2]);
  if (!result.stderr.includes("--gate must be one of")) throw new Error("missing gate error");
  return "exit 2";
});

console.log(`SUMMARY pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
