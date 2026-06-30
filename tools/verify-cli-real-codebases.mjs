#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const cli = path.join(root, "dist", "cli.js");
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
const profile = process.env.CBI_REAL_PROFILE ?? "default";
const timeoutMs = Number.parseInt(
  process.env.CBI_REAL_TIMEOUT_MS ?? (profile === "heavy" ? "180000" : "60000"),
  10,
);
const maxBufferBytes = Number.parseInt(process.env.CBI_REAL_MAX_BUFFER ?? String(64 * 1024 * 1024), 10);
const parsedToTrackedTolerance = 1.25;
const parsedToTrackedSlack = 20;
const minLargeRepoDependencyDensity = 0.05;
const largeRepoFileThreshold = 300;
const bannedPathSegments = new Set([
  ".code-visualizer",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  ".worktrees",
]);

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

const heavyProfileTargets = [
  {
    name: "heavy-harness",
    path: "/home/ubuntu/harness",
    file: "harnesses/cli/src/cli-args/list-models.ts",
    symbol: "listModels",
    minFiles: 800,
    minDependencies: 500,
  },
  {
    name: "heavy-ui",
    path: "/home/ubuntu/ui",
    file: "",
    symbol: "",
    minFiles: 1500,
    minDependencies: 1000,
  },
  {
    name: "heavy-songtrivia",
    path: "/home/ubuntu/anthm/songtrivia",
    file: "",
    symbol: "",
    minFiles: 2500,
    minDependencies: 2500,
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

const profileTargets = profile === "heavy" ? heavyProfileTargets : [];
if (profile !== "default" && profile !== "heavy") {
  console.error(`Unknown CBI_REAL_PROFILE=${profile}; expected default or heavy`);
  process.exit(2);
}

const shouldDiscoverHome = process.env.CBI_REAL_DISCOVER_HOME === "1" || profile === "heavy";
const discoveredTargets = shouldDiscoverHome
  ? discoverHomeTargets(process.env.CBI_REAL_HOME ?? "/home/ubuntu", profile === "heavy" ? largeRepoFileThreshold : 1)
  : [];

const targets = uniqueTargets([...defaultTargets, ...profileTargets, ...extraTargets, ...discoveredTargets]);

let pass = 0;
let fail = 0;

function run(args, okCodes = [0]) {
  const result = spawnSync("node", [cli, ...args], {
    encoding: "utf-8",
    cwd: root,
    timeout: timeoutMs,
    maxBuffer: maxBufferBytes,
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
  const result = JSON.parse(run([...args, "--json"], okCodes).stdout);
  assertNoBannedPaths(result, args.join(" "));
  return result;
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

function uniqueTargets(candidates) {
  const seen = new Set();
  const targets = [];

  for (const target of candidates) {
    if (!fs.existsSync(target.path)) continue;
    const realPath = fs.realpathSync(target.path);
    if (seen.has(realPath)) continue;
    seen.add(realPath);
    targets.push(target);
  }

  return targets;
}

function discoverHomeTargets(homeDir, minTrackedFiles) {
  const repos = [];
  const maxDepth = Number.parseInt(process.env.CBI_REAL_DISCOVER_DEPTH ?? "5", 10);
  const limit = Number.parseInt(process.env.CBI_REAL_DISCOVER_LIMIT ?? "6", 10);
  const queue = [{ dir: homeDir, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth || !fs.existsSync(current.dir)) continue;

    if (fs.existsSync(path.join(current.dir, ".git"))) {
      const trackedFiles = trackedTypeScriptCount(current.dir);
      if (trackedFiles >= minTrackedFiles) {
        repos.push({ path: current.dir, trackedFiles });
      }
      continue;
    }

    for (const entry of fs.readdirSync(current.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (shouldSkipDiscoveryDir(entry.name)) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return repos
    .sort((left, right) => right.trackedFiles - left.trackedFiles)
    .slice(0, limit)
    .map((repo, index) => ({
      name: `home-${index + 1}-${path.basename(repo.path)}`,
      path: repo.path,
      file: "",
      symbol: "",
    }));
}

function shouldSkipDiscoveryDir(name) {
  return name === ".git"
    || name === "node_modules"
    || name === ".code-visualizer"
    || name === ".next"
    || name === "dist"
    || name === "coverage"
    || name === ".turbo"
    || name === ".cache"
    || name === ".worktrees"
    || name === ".claude";
}

function trackedTypeScriptCount(targetPath) {
  const target = path.resolve(targetPath);
  const rootResult = spawnSync("git", ["-C", target, "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (rootResult.status !== 0) return 0;

  const repoRoot = rootResult.stdout.trim();
  const filesResult = spawnSync("git", ["-C", repoRoot, "ls-files", "--", "*.ts", "*.tsx"], {
    encoding: "utf-8",
  });
  if (filesResult.status !== 0) return 0;

  return filesResult.stdout
    .split("\n")
    .filter(Boolean)
    .map((file) => path.resolve(repoRoot, file))
    .filter((file) => file.startsWith(`${target}${path.sep}`) || file === target)
    .filter((file) => !file.endsWith(".d.ts"))
    .length;
}

function overviewFileCount(overview) {
  const files = overview.files ?? overview.fileCount ?? overview.totalFiles;
  if (typeof files !== "number") throw new Error("missing file count");
  return files;
}

function assertParsedToTrackedRatio(target, parsedFiles) {
  const trackedFiles = trackedTypeScriptCount(target.path);
  if (trackedFiles === 0) return;

  const allowed = Math.ceil(trackedFiles * parsedToTrackedTolerance + parsedToTrackedSlack);
  if (parsedFiles > allowed) {
    throw new Error(
      `parsed ${parsedFiles} files but git tracks ${trackedFiles}; likely generated/worktree pollution`,
    );
  }
}

function assertDependencyDensity(overview) {
  const files = overviewFileCount(overview);
  const dependencies = overview.totalDependencies;
  if (files < largeRepoFileThreshold || typeof dependencies !== "number") return;

  const minDependencies = Math.floor(files * minLargeRepoDependencyDensity);
  if (dependencies < minDependencies) {
    throw new Error(
      `only ${dependencies} dependencies for ${files} files; likely unresolved workspace imports`,
    );
  }
}

function assertTargetThresholds(target, overview) {
  const files = overviewFileCount(overview);
  const dependencies = overview.totalDependencies;

  if (typeof target.minFiles === "number" && files < target.minFiles) {
    throw new Error(`expected at least ${target.minFiles} files for ${target.name}, got ${files}`);
  }

  if (typeof target.minDependencies === "number" && typeof dependencies === "number" && dependencies < target.minDependencies) {
    throw new Error(`expected at least ${target.minDependencies} dependencies for ${target.name}, got ${dependencies}`);
  }
}

function assertNoBannedPaths(value, location) {
  const violation = findBannedPath(value);
  if (violation) {
    throw new Error(`banned generated/worktree path in ${location}: ${violation}`);
  }
}

function findBannedPath(value, keyPath = []) {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/");
    if (normalized.includes("package.json:")) return "";
    const segments = normalized.split("/");
    if (segments.includes(".claude") && segments.includes("worktrees")) return value;
    for (const segment of segments) {
      if (bannedPathSegments.has(segment)) return value;
    }
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findBannedPath(item, keyPath);
      if (result) return result;
    }
    return "";
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (keyPath.length === 0 && key === "cache") continue;
      const result = findBannedPath(item, [...keyPath, key]);
      if (result) return result;
    }
  }

  return "";
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
  if (version !== expectedVersion) throw new Error(`expected version ${expectedVersion}, got ${version}`);
  return version;
});

for (const inputTarget of targets) {
  const target = discoverFileAndSymbol(inputTarget);

  record(`${target.name}: overview`, () => {
    const overview = json(["overview", target.path]);
    const files = overviewFileCount(overview);
    assertParsedToTrackedRatio(target, files);
    assertDependencyDensity(overview);
    assertTargetThresholds(target, overview);
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

  for (const command of ["modules", "forces", "dead-exports", "opportunities", "groups", "processes", "clusters"]) {
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
