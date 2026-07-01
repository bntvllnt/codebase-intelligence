import { ALL_RULES } from "../rules/registry.js";

export interface RuleExplanation {
  ruleId: string;
  found: boolean;
  description: string;
  category?: string;
  defaultSeverity?: string;
  fixable?: boolean;
  examples: string[];
  docs: string[];
}

export function explainRule(ruleId: string): RuleExplanation {
  const rule = ALL_RULES.find((item) => item.id === ruleId);
  if (!rule) {
    return {
      ruleId,
      found: false,
      description: "Unknown rule.",
      examples: [`codebase-intelligence check . --json`],
      docs: ["docs/cli-reference.md"],
    };
  }
  return {
    ruleId,
    found: true,
    description: rule.meta.description,
    category: rule.meta.category,
    defaultSeverity: rule.defaultSeverity,
    fixable: rule.meta.fixable,
    examples: [
      `codebase-intelligence check . --json`,
      `codebase-intelligence check . --fail-on warn --json`,
    ],
    docs: ["docs/cli-reference.md", "schema.json"],
  };
}

export function formatRuleExplanationText(result: RuleExplanation): string {
  if (!result.found) return `Unknown rule: ${result.ruleId}`;
  return [
    result.ruleId,
    `description=${result.description}`,
    `category=${result.category ?? "unknown"}`,
    `defaultSeverity=${result.defaultSeverity ?? "unknown"}`,
    `fixable=${String(result.fixable)}`,
    `example=${result.examples[0]}`,
  ].join("\n");
}
