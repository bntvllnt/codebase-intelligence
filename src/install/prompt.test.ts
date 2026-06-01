import { describe, it, expect } from "vitest";
import {
  buildPromptItems,
  toggleItem,
  toggleAll,
  collectSelection,
  renderMenu,
  promptSelection,
} from "./prompt.js";
import { AGENT_TARGETS } from "./index.js";

describe("buildPromptItems", () => {
  it("has one row per agent plus a skill row", () => {
    const items = buildPromptItems(["agents", "claude"], false);
    expect(items).toHaveLength(AGENT_TARGETS.length + 1);
    expect(items[items.length - 1].id).toBe("skill");
  });

  it("preselects the given agents and skill", () => {
    const items = buildPromptItems(["agents", "claude"], true);
    const checked = new Set(items.filter((i) => i.checked).map((i) => i.id));
    expect(checked.has("agents")).toBe(true);
    expect(checked.has("claude")).toBe(true);
    expect(checked.has("gemini")).toBe(false);
    expect(checked.has("skill")).toBe(true);
  });
});

describe("collectSelection", () => {
  it("reduces checked rows to agents + skill", () => {
    const items = buildPromptItems(["claude"], false);
    toggleItem(items, items.findIndex((i) => i.id === "gemini"));
    toggleItem(items, items.findIndex((i) => i.id === "skill"));
    const sel = collectSelection(items);
    expect(sel.agents.sort()).toEqual(["claude", "gemini"]);
    expect(sel.skill).toBe(true);
  });

  it("empty when nothing is checked", () => {
    const items = buildPromptItems([], false);
    const sel = collectSelection(items);
    expect(sel.agents).toEqual([]);
    expect(sel.skill).toBe(false);
  });
});

describe("toggleItem / toggleAll", () => {
  it("toggleItem flips a single row", () => {
    const items = buildPromptItems([], false);
    expect(items[0].checked).toBe(false);
    toggleItem(items, 0);
    expect(items[0].checked).toBe(true);
  });

  it("toggleAll checks all when some are unchecked, then clears", () => {
    const items = buildPromptItems(["agents"], false);
    toggleAll(items);
    expect(items.every((i) => i.checked)).toBe(true);
    toggleAll(items);
    expect(items.every((i) => !i.checked)).toBe(true);
  });
});

describe("renderMenu", () => {
  it("marks the cursor row and renders checkboxes", () => {
    const items = buildPromptItems(["agents"], false);
    const out = renderMenu(items, 0);
    const lines = out.split("\n");
    expect(lines).toHaveLength(items.length);
    expect(lines[0].startsWith(">")).toBe(true);
    expect(lines[1].startsWith(" ")).toBe(true);
    expect(out).toContain("[x]");
    expect(out).toContain("[ ]");
  });
});

describe("promptSelection (non-TTY fallback)", () => {
  it("returns the preselection unchanged when stdin is not a TTY", async () => {
    // Under vitest stdin is not a TTY, so promptSelection cannot read
    // keystrokes and must fall back to the seeded preselection.
    expect(process.stdin.isTTY).toBeFalsy();
    const sel = await promptSelection(["agents", "claude"], true);
    expect(sel).toEqual({ agents: ["agents", "claude"], skill: true });
  });

  it("falls back to an empty selection when nothing is preselected", async () => {
    const sel = await promptSelection([], false);
    expect(sel).toEqual({ agents: [], skill: false });
  });
});
