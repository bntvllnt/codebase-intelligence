import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  upsertManagedBlock,
  ensurePreamble,
  renderBlock,
  renderSkill,
  installRepoFiles,
  installGitignoreEntry,
  installGlobalSkill,
  isAgentId,
  resolveInitPlan,
  AGENT_TARGETS,
  ALL_AGENT_IDS,
  DEFAULT_AGENTS,
  DEFAULT_MARKERS,
} from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

describe("upsertManagedBlock", () => {
  it("wraps the block with markers for empty input", () => {
    const out = upsertManagedBlock("", "BODY");
    expect(out).toContain(DEFAULT_MARKERS.start);
    expect(out).toContain(DEFAULT_MARKERS.end);
    expect(out).toContain("BODY");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("appends to existing content without markers, preserving it", () => {
    const existing = "# My Notes\n\nimportant user content\n";
    const out = upsertManagedBlock(existing, "BODY");
    expect(out).toContain("important user content");
    expect(out.indexOf("important user content")).toBeLessThan(out.indexOf(DEFAULT_MARKERS.start));
    expect(out).toContain("BODY");
  });

  it("replaces only the managed region, preserving content before and after", () => {
    const first = upsertManagedBlock("BEFORE\n", "OLD BODY");
    const withAfter = `${first}\nAFTER USER CONTENT\n`;
    const out = upsertManagedBlock(withAfter, "NEW BODY");
    expect(out).toContain("BEFORE");
    expect(out).toContain("AFTER USER CONTENT");
    expect(out).toContain("NEW BODY");
    expect(out).not.toContain("OLD BODY");
    expect(out.match(new RegExp(DEFAULT_MARKERS.end.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&"), "g"))?.length).toBe(1);
  });

  it("is idempotent", () => {
    const once = upsertManagedBlock("seed\n", "BODY");
    const twice = upsertManagedBlock(once, "BODY");
    expect(twice).toBe(once);
  });
});

describe("ensurePreamble", () => {
  it("returns preamble for empty content", () => {
    expect(ensurePreamble("", "---\nx: 1\n---\n")).toBe("---\nx: 1\n---\n");
  });

  it("leaves content that already has frontmatter untouched", () => {
    const content = "---\nexisting: true\n---\nbody\n";
    expect(ensurePreamble(content, "---\nx: 1\n---\n")).toBe(content);
  });

  it("prepends preamble when content lacks frontmatter", () => {
    const out = ensurePreamble("plain body\n", "---\nx: 1\n---\n");
    expect(out.startsWith("---\nx: 1\n---")).toBe(true);
    expect(out).toContain("plain body");
  });
});

describe("renderBlock / renderSkill content", () => {
  it("block states the discovery-first mandate and key commands", () => {
    const block = renderBlock();
    expect(block).toMatch(/BEFORE grep\/read/i);
    for (const cmd of ["overview", "hotspots", "impact", "dependents", "dead-exports"]) {
      expect(block).toContain(cmd);
    }
    expect(block).toContain("--json");
  });

  it("skill has valid registry frontmatter and prefers CLI over grep", () => {
    const skill = renderSkill();
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/name: codebase-intelligence/);
    expect(skill).toMatch(/Prefer it over grep\/read/i);
  });
});

describe("registry skill file stays in sync with renderSkill()", () => {
  it("committed skills/codebase-intelligence/SKILL.md equals renderSkill() output", () => {
    const skillPath = path.join(repoRoot, "skills", "codebase-intelligence", "SKILL.md");
    const onDisk = fs.readFileSync(skillPath, "utf-8");
    expect(onDisk).toBe(renderSkill());
  });
});

describe("isAgentId", () => {
  it("accepts known ids and rejects unknown", () => {
    expect(isAgentId("claude")).toBe(true);
    expect(isAgentId("agents")).toBe(true);
    expect(isAgentId("nope")).toBe(false);
  });
});

describe("installRepoFiles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-init-repo-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates every agent file with the managed block", () => {
    const results = installRepoFiles(tmp);
    expect(results).toHaveLength(AGENT_TARGETS.length);
    for (const target of AGENT_TARGETS) {
      const filePath = path.join(tmp, target.file);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain(DEFAULT_MARKERS.start);
      expect(content).toContain("Codebase Intelligence");
    }
    expect(results.every((r) => r.action === "created")).toBe(true);
  });

  it("adds frontmatter to the Cursor .mdc target", () => {
    installRepoFiles(tmp, { agents: ["cursor"] });
    const cursorTarget = AGENT_TARGETS.find((t) => t.id === "cursor");
    if (!cursorTarget) throw new Error("cursor target missing from registry");
    const content = fs.readFileSync(path.join(tmp, cursorTarget.file), "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("alwaysApply: true");
  });

  it("honors the agents subset", () => {
    const results = installRepoFiles(tmp, { agents: ["claude"] });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("CLAUDE.md");
    expect(fs.existsSync(path.join(tmp, "AGENTS.md"))).toBe(false);
  });

  it("merges into a pre-existing file without clobbering user content", () => {
    const claudePath = path.join(tmp, "CLAUDE.md");
    fs.writeFileSync(claudePath, "# Project Rules\n\nDo not delete me.\n", "utf-8");

    installRepoFiles(tmp, { agents: ["claude"] });

    const content = fs.readFileSync(claudePath, "utf-8");
    expect(content).toContain("Do not delete me.");
    expect(content).toContain(DEFAULT_MARKERS.start);
  });

  it("is idempotent — a second run reports unchanged and content is stable", () => {
    installRepoFiles(tmp);
    const before = AGENT_TARGETS.map((t) => fs.readFileSync(path.join(tmp, t.file), "utf-8"));

    const second = installRepoFiles(tmp);
    expect(second.every((r) => r.action === "unchanged")).toBe(true);

    const after = AGENT_TARGETS.map((t) => fs.readFileSync(path.join(tmp, t.file), "utf-8"));
    expect(after).toEqual(before);
  });

  it("adds the canonical cache directory to .gitignore idempotently", () => {
    const first = installGitignoreEntry(tmp);
    const second = installGitignoreEntry(tmp);

    expect(first).toEqual({ path: ".gitignore", action: "created" });
    expect(second).toEqual({ path: ".gitignore", action: "unchanged" });
    expect(fs.readFileSync(path.join(tmp, ".gitignore"), "utf-8")).toBe(".codebase-intelligence/\n");
  });

  it("preserves existing .gitignore content when adding the cache directory", () => {
    fs.writeFileSync(path.join(tmp, ".gitignore"), "dist/\n", "utf-8");

    const result = installGitignoreEntry(tmp);

    expect(result).toEqual({ path: ".gitignore", action: "updated" });
    expect(fs.readFileSync(path.join(tmp, ".gitignore"), "utf-8")).toBe("dist/\n.codebase-intelligence/\n");
  });

  it("covers all registry ids in ALL_AGENT_IDS", () => {
    expect([...ALL_AGENT_IDS].sort()).toEqual(AGENT_TARGETS.map((t) => t.id).sort());
  });
});

describe("installGlobalSkill", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ci-init-home-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("writes the skill to ~/.claude/skills and is idempotent", () => {
    const first = installGlobalSkill(home);
    const skillPath = path.join(home, ".claude", "skills", "codebase-intelligence", "SKILL.md");
    expect(first.action).toBe("created");
    expect(first.path).toBe(skillPath);
    expect(fs.readFileSync(skillPath, "utf-8")).toBe(renderSkill());

    const second = installGlobalSkill(home);
    expect(second.action).toBe("unchanged");
  });
});

describe("resolveInitPlan", () => {
  it("defaults to AGENTS.md + CLAUDE.md only", () => {
    expect([...DEFAULT_AGENTS]).toEqual(["agents", "claude"]);
  });

  it("--all selects every agent (explicit, non-interactive)", () => {
    const plan = resolveInitPlan({ all: true }, true);
    expect(plan.mode).toBe("explicit");
    expect(plan.agents).toEqual([...ALL_AGENT_IDS]);
    expect(plan.installSkill).toBe(false);
    expect(plan.installGitignore).toBe(false);
  });

  it("--agents picks the listed agents", () => {
    const plan = resolveInitPlan({ agents: "claude,gemini" }, true);
    expect(plan.mode).toBe("explicit");
    expect(plan.agents).toEqual(["claude", "gemini"]);
    expect(plan.invalidAgents).toEqual([]);
    expect(plan.installGitignore).toBe(false);
  });

  it("--gitignore requests .gitignore installation", () => {
    const plan = resolveInitPlan({ gitignore: true }, false);
    expect(plan.installGitignore).toBe(true);
  });

  it("--agents reports unknown ids and keeps valid ones", () => {
    const plan = resolveInitPlan({ agents: "claude,bogus" }, true);
    expect(plan.agents).toEqual(["claude"]);
    expect(plan.invalidAgents).toEqual(["bogus"]);
  });

  it("no flags on a TTY → interactive, seeded with the default set", () => {
    const plan = resolveInitPlan({}, true);
    expect(plan.mode).toBe("interactive");
    expect(plan.agents).toEqual([...DEFAULT_AGENTS]);
  });

  it("no flags without a TTY → non-interactive default", () => {
    const plan = resolveInitPlan({}, false);
    expect(plan.mode).toBe("default");
    expect(plan.agents).toEqual([...DEFAULT_AGENTS]);
  });

  it("--json forces non-interactive even on a TTY", () => {
    expect(resolveInitPlan({ json: true }, true).mode).toBe("default");
  });

  it("--yes forces non-interactive even on a TTY", () => {
    expect(resolveInitPlan({ yes: true }, true).mode).toBe("default");
  });

  it("--skill is opt-in across modes", () => {
    expect(resolveInitPlan({ skill: true }, false).installSkill).toBe(true);
    expect(resolveInitPlan({}, false).installSkill).toBe(false);
  });
});
