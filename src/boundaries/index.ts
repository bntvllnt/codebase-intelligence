import { createHash } from "node:crypto";
import path from "node:path";
import type {
  BoundariesConfig,
  BoundaryMatchedZone,
  BoundaryPreset,
  BoundaryRule,
  BoundaryRuleSummary,
  BoundaryViolation,
  BoundariesResult,
  CodebaseGraph,
} from "../types/index.js";

export interface BoundaryOptions {
  preset?: BoundaryPreset;
  list?: boolean;
  config?: BoundariesConfig;
}

type ZoneConfig = NonNullable<BoundariesConfig["zones"]>[number];

interface ResolvedBoundaryConfig {
  preset: BoundariesResult["preset"];
  zones: ZoneConfig[];
  rules: BoundaryRule[];
}

interface ZoneMatcher {
  zone: ZoneConfig;
  regexes: RegExp[];
  specificity: number;
}

const PRESET_CONFIGS = {
  layered: {
    zones: [
      { name: "ui", patterns: ["src/ui/**", "src/components/**", "app/**"] },
      { name: "application", patterns: ["src/app/**", "src/application/**", "src/services/**"] },
      { name: "domain", patterns: ["src/domain/**", "src/core/**"] },
      { name: "infrastructure", patterns: ["src/infra/**", "src/infrastructure/**", "src/db/**", "src/adapters/**"] },
      { name: "shared", patterns: ["src/shared/**", "src/utils/**", "src/types/**"] },
    ],
    rules: [
      { from: "domain", allow: ["shared"] },
      { from: "application", allow: ["domain", "shared"] },
      { from: "ui", allow: ["application", "domain", "shared"] },
      { from: "infrastructure", allow: ["domain", "shared"] },
      { from: "shared", allow: [] },
    ],
  },
  hexagonal: {
    zones: [
      { name: "domain", patterns: ["src/domain/**", "src/core/**"] },
      { name: "application", patterns: ["src/application/**", "src/app/**", "src/services/**"] },
      { name: "adapter", patterns: ["src/adapters/**", "src/http/**", "src/api/**"] },
      { name: "infrastructure", patterns: ["src/infra/**", "src/infrastructure/**", "src/db/**"] },
      { name: "shared", patterns: ["src/shared/**", "src/utils/**", "src/types/**"] },
    ],
    rules: [
      { from: "domain", allow: ["shared"] },
      { from: "application", allow: ["domain", "shared"] },
      { from: "adapter", allow: ["application", "domain", "shared"] },
      { from: "infrastructure", allow: ["domain", "shared"] },
      { from: "shared", allow: [] },
    ],
  },
  "feature-sliced": {
    zones: [
      { name: "app", patterns: ["src/app/**", "app/**"] },
      { name: "pages", patterns: ["src/pages/**", "pages/**"] },
      { name: "widgets", patterns: ["src/widgets/**"] },
      { name: "features", patterns: ["src/features/**"] },
      { name: "entities", patterns: ["src/entities/**"] },
      { name: "shared", patterns: ["src/shared/**", "src/utils/**", "src/types/**"] },
    ],
    rules: [
      { from: "shared", allow: [] },
      { from: "entities", allow: ["shared"] },
      { from: "features", allow: ["entities", "shared"] },
      { from: "widgets", allow: ["features", "entities", "shared"] },
      { from: "pages", allow: ["widgets", "features", "entities", "shared"] },
      { from: "app", allow: ["pages", "widgets", "features", "entities", "shared"] },
    ],
  },
  bulletproof: {
    zones: [
      { name: "entry", patterns: ["src/routes/**", "src/controllers/**", "src/api/**"] },
      { name: "feature", patterns: ["src/features/**", "src/modules/**"] },
      { name: "domain", patterns: ["src/domain/**", "src/core/**"] },
      { name: "data", patterns: ["src/data/**", "src/repositories/**", "src/db/**"] },
      { name: "shared", patterns: ["src/shared/**", "src/utils/**", "src/types/**"] },
    ],
    rules: [
      { from: "entry", allow: ["feature", "domain", "shared"] },
      { from: "feature", allow: ["domain", "data", "shared"] },
      { from: "domain", allow: ["shared"] },
      { from: "data", allow: ["domain", "shared"] },
      { from: "shared", allow: [] },
    ],
  },
} satisfies Record<BoundaryPreset, { zones: ZoneConfig[]; rules: BoundaryRule[] }>;

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\/+/, "");
  let out = "^";
  for (let idx = 0; idx < normalized.length; idx += 1) {
    const char = normalized[idx];
    const next = normalized[idx + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      idx += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else {
      out += escapeRegex(char);
    }
  }
  return new RegExp(`${out}$`);
}

function autoDiscoveredPatterns(zone: ZoneConfig): string[] {
  if (zone.autoDiscover !== true) return [];
  const name = zone.name.toLowerCase();
  return [`${name}/**`, `src/${name}/**`, `app/${name}/**`, `packages/*/${name}/**`];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function combineRules(rules: readonly BoundaryRule[]): BoundaryRule[] {
  const bySource = new Map<string, { allow?: Set<string>; forbid?: Set<string> }>();
  for (const rule of rules) {
    const existing = bySource.get(rule.from) ?? {};
    if (rule.allow) existing.allow = new Set([...(existing.allow ?? []), ...rule.allow]);
    if (rule.forbid) existing.forbid = new Set([...(existing.forbid ?? []), ...rule.forbid]);
    bySource.set(rule.from, existing);
  }

  return [...bySource.entries()]
    .map(([from, rule]) => ({
      from,
      ...(rule.allow ? { allow: [...rule.allow].sort((left, right) => left.localeCompare(right)) } : {}),
      ...(rule.forbid ? { forbid: [...rule.forbid].sort((left, right) => left.localeCompare(right)) } : {}),
    }))
    .sort((left, right) => left.from.localeCompare(right.from));
}

function resolveConfig(options: BoundaryOptions): ResolvedBoundaryConfig {
  const configured = options.config;
  if (options.preset) {
    const preset = PRESET_CONFIGS[options.preset];
    return { preset: options.preset, zones: preset.zones, rules: combineRules(preset.rules) };
  }

  const presetName = configured?.preset;
  const preset = presetName ? PRESET_CONFIGS[presetName] : undefined;
  const zones = configured?.zones ?? preset?.zones ?? [];
  const rules = configured?.rules ?? preset?.rules ?? [];
  const label: BoundariesResult["preset"] = configured?.zones || configured?.rules
    ? configured.preset ?? "custom"
    : presetName ?? "none";
  return { preset: label, zones, rules: combineRules(rules) };
}

function buildMatchers(zones: readonly ZoneConfig[]): ZoneMatcher[] {
  return zones
    .map((zone) => {
      const patterns = unique([...zone.patterns, ...autoDiscoveredPatterns(zone)]);
      return {
        zone: { ...zone, patterns },
        regexes: patterns.map(globToRegex),
        specificity: Math.max(...patterns.map((pattern) => pattern.replace(/\*/g, "").length), 0),
      };
    })
    .sort((left, right) => right.specificity - left.specificity || left.zone.name.localeCompare(right.zone.name));
}

function zoneForFile(file: string, matchers: readonly ZoneMatcher[]): string | null {
  for (const matcher of matchers) {
    if (matcher.regexes.some((regex) => regex.test(file))) return matcher.zone.name;
  }
  return null;
}

function violationKind(rule: BoundaryRule, toZone: string, symbols: readonly string[]): BoundaryViolation["kind"] | null {
  if (toZone === rule.from) return null;
  const violatesForbid = (rule.forbid?.includes("*") ?? false) || (rule.forbid?.includes(toZone) ?? false);
  const violatesAllow = rule.allow !== undefined && !rule.allow.includes(toZone);
  if (!violatesForbid && !violatesAllow) return null;
  if (symbols.includes("*")) return "risky-re-export-chain";
  if (violatesForbid) return "forbidden-edge";
  if (violatesAllow) return "disallowed-edge";
  return null;
}

function stableViolationId(source: string, target: string, fromZone: string, toZone: string): string {
  const hash = createHash("sha1").update(`${source}|${target}|${fromZone}|${toZone}`).digest("hex").slice(0, 10);
  return `boundary:${hash}`;
}

function ruleIdFor(rule: BoundaryRule): string {
  if (rule.forbid && rule.forbid.length > 0) return `${rule.from}:forbid:${rule.forbid.join(",")}`;
  if (rule.allow) return `${rule.from}:allow:${rule.allow.join(",")}`;
  return `${rule.from}:allow:*`;
}

function violationMessage(kind: BoundaryViolation["kind"], fromZone: string, toZone: string): string {
  if (kind === "risky-re-export-chain") return `Boundary violation: ${fromZone} re-exports ${toZone} across a forbidden boundary`;
  if (kind === "forbidden-edge") return `Boundary violation: ${fromZone} must not import ${toZone}`;
  return `Boundary violation: ${fromZone} is not allowed to import ${toZone}`;
}

function toRuleSummary(rule: BoundaryRule): BoundaryRuleSummary {
  return {
    from: rule.from,
    ...(rule.allow ? { allow: [...rule.allow].sort((left, right) => left.localeCompare(right)) } : {}),
    ...(rule.forbid ? { forbid: [...rule.forbid].sort((left, right) => left.localeCompare(right)) } : {}),
  };
}

export function computeBoundaries(graph: CodebaseGraph, options: BoundaryOptions = {}): BoundariesResult {
  const config = resolveConfig(options);
  const matchers = buildMatchers(config.zones);
  const ruleBySource = new Map(config.rules.map((rule) => [rule.from, rule]));
  const filePaths = graph.nodes
    .filter((node) => node.type === "file")
    .map((node) => node.path)
    .sort((left, right) => left.localeCompare(right));
  const zoneByFile = new Map(filePaths.map((file) => [file, zoneForFile(file, matchers)]));
  const zones: BoundaryMatchedZone[] = matchers.map((matcher) => ({
    name: matcher.zone.name,
    patterns: matcher.zone.patterns,
    autoDiscover: matcher.zone.autoDiscover === true,
    matchedFiles: filePaths.filter((file) => zoneByFile.get(file) === matcher.zone.name),
  }));

  const violations: BoundaryViolation[] = [];
  for (const edge of graph.edges) {
    const fromZone = zoneByFile.get(edge.source);
    const toZone = zoneByFile.get(edge.target);
    if (!fromZone || !toZone) continue;
    const rule = ruleBySource.get(fromZone);
    if (!rule) continue;
    const kind = violationKind(rule, toZone, edge.symbols);
    if (!kind) continue;
    const message = violationMessage(kind, fromZone, toZone);
    violations.push({
      id: stableViolationId(edge.source, edge.target, fromZone, toZone),
      kind,
      ruleId: ruleIdFor(rule),
      source: edge.source,
      target: edge.target,
      fromZone,
      toZone,
      symbols: [...edge.symbols].sort((left, right) => left.localeCompare(right)),
      isTypeOnly: edge.isTypeOnly,
      message,
      evidence: [
        `edge=${edge.source}->${edge.target}`,
        `fromZone=${fromZone}`,
        `toZone=${toZone}`,
        `symbols=${edge.symbols.length > 0 ? edge.symbols.join(",") : "*"}`,
        `typeOnly=${String(edge.isTypeOnly)}`,
      ],
      actions: [
        {
          command: `codebase-intelligence dependents . ${edge.target} --json`,
          reason: "Inspect blast radius before moving imports behind an allowed boundary.",
        },
        {
          command: "codebase-intelligence boundaries . --list --json",
          reason: "List resolved zones and rules before changing architecture config.",
        },
      ],
    });
  }

  violations.sort((left, right) =>
    left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.ruleId.localeCompare(right.ruleId),
  );

  return {
    preset: config.preset,
    zones,
    rules: config.rules.map(toRuleSummary).sort((left, right) => left.from.localeCompare(right.from)),
    violations,
    summary: {
      zones: zones.length,
      rules: config.rules.length,
      checkedEdges: graph.edges.length,
      violations: violations.length,
      unassignedFiles: filePaths.filter((file) => zoneByFile.get(file) === null).length,
    },
    verdict: violations.length > 0 ? "fail" : "pass",
  };
}
