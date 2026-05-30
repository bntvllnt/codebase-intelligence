import readline from "readline";
import { AGENT_TARGETS } from "./index.js";
import type { AgentId } from "./index.js";

// ── Interactive multiselect (zero-dependency) ───────────────
//
// A readline raw-mode checkbox picker. The pure helpers
// (buildPromptItems / toggle / collectSelection / renderMenu) hold the logic
// and are unit-tested; promptSelection is the thin terminal I/O shell.

export type PromptItemId = AgentId | "skill";

export interface PromptItem {
  id: PromptItemId;
  label: string;
  checked: boolean;
}

export interface PromptSelection {
  agents: AgentId[];
  skill: boolean;
}

const SKILL_LABEL = "Install global skill (~/.claude/skills/codebase-intelligence/SKILL.md)";

/** Build the picker rows, preselecting the given agents / skill. */
export function buildPromptItems(preAgents: readonly AgentId[], preSkill: boolean): PromptItem[] {
  const items: PromptItem[] = AGENT_TARGETS.map((t) => ({
    id: t.id,
    label: `${t.id.padEnd(7)} ${t.file}`,
    checked: preAgents.includes(t.id),
  }));
  items.push({ id: "skill", label: SKILL_LABEL, checked: preSkill });
  return items;
}

/** Flip the checkbox at `index` (mutates and returns the same array). */
export function toggleItem(items: PromptItem[], index: number): PromptItem[] {
  const item = items[index];
  item.checked = !item.checked;
  return items;
}

/** Check all if any are unchecked, otherwise clear all. */
export function toggleAll(items: PromptItem[]): PromptItem[] {
  const allChecked = items.every((i) => i.checked);
  for (const item of items) item.checked = !allChecked;
  return items;
}

/** Reduce the picker rows to a selection. */
export function collectSelection(items: readonly PromptItem[]): PromptSelection {
  const agents: AgentId[] = [];
  let skill = false;
  for (const item of items) {
    if (!item.checked) continue;
    if (item.id === "skill") skill = true;
    else agents.push(item.id);
  }
  return { agents, skill };
}

/** Render the menu body (no trailing newline). */
export function renderMenu(items: readonly PromptItem[], cursor: number): string {
  return items
    .map((item, i) => {
      const pointer = i === cursor ? ">" : " ";
      const box = item.checked ? "[x]" : "[ ]";
      return `${pointer} ${box} ${item.label}`;
    })
    .join("\n");
}

/**
 * Present the interactive picker. Returns the selection, or `null` if the user
 * cancelled (Esc / Ctrl-C). Falls back to the preselection when stdin is not a
 * TTY (no way to read keystrokes).
 */
export async function promptSelection(
  preAgents: readonly AgentId[],
  preSkill: boolean,
): Promise<PromptSelection | null> {
  const items = buildPromptItems(preAgents, preSkill);
  const input = process.stdin;
  const out = process.stderr;

  if (!input.isTTY) {
    return collectSelection(items);
  }

  out.write("Select what to set up (↑/↓ move · space toggle · a all · enter confirm · esc cancel):\n");
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  let cursor = 0;
  const draw = (first: boolean): void => {
    if (!first) out.write(`\x1b[${items.length}A\x1b[0J`);
    out.write(`${renderMenu(items, cursor)}\n`);
  };
  draw(true);

  return await new Promise<PromptSelection | null>((resolve) => {
    const cleanup = (): void => {
      input.setRawMode(false);
      input.removeListener("keypress", onKey);
      input.pause();
      out.write("\n");
    };

    const onKey = (str: string | undefined, key: readline.Key): void => {
      if (key.name === "up" || str === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
      } else if (key.name === "down" || str === "j") {
        cursor = (cursor + 1) % items.length;
      } else if (str === " ") {
        toggleItem(items, cursor);
      } else if (str === "a") {
        toggleAll(items);
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(collectSelection(items));
        return;
      } else if (key.name === "escape" || (key.ctrl === true && key.name === "c")) {
        cleanup();
        resolve(null);
        return;
      }
      draw(false);
    };

    input.on("keypress", onKey);
  });
}
