import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, findConfigFile, ConfigError } from "../src/config/index.js";

// Real temp config files on disk — no mocking of fs or the loader.

describe("config loader", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: unknown): void =>
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));

  it("discovers codebase-intelligence.json and parses rules", () => {
    write("codebase-intelligence.json", { rules: { "no-comments": "error" } });
    const { config, configPath } = loadConfig(dir);
    expect(configPath).toBe(path.join(dir, "codebase-intelligence.json"));
    expect(config.rules?.["no-comments"]).toBe("error");
  });

  it("returns empty config + null path when nothing is found", () => {
    const { config, configPath } = loadConfig(dir);
    expect(configPath).toBeNull();
    expect(config.rules).toBeUndefined();
  });

  it("reads the codebaseIntelligence key from package.json", () => {
    write("package.json", { name: "x", codebaseIntelligence: { rules: { "no-comments": 2 } } });
    const { config, configPath } = loadConfig(dir);
    expect(configPath).toBe(path.join(dir, "package.json"));
    expect(config.rules?.["no-comments"]).toBe(2);
  });

  it("walks up to find a parent config", () => {
    write("codebase-intelligence.json", { rules: {} });
    const nested = path.join(dir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    expect(findConfigFile(nested)).toBe(path.join(dir, "codebase-intelligence.json"));
  });

  it("throws ConfigError on invalid JSON", () => {
    write("codebase-intelligence.json", "{ not json ");
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("throws ConfigError on an unknown top-level key (strict schema)", () => {
    write("codebase-intelligence.json", { bogusKey: 1 });
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("allows a $schema reference", () => {
    write("codebase-intelligence.json", { $schema: "./schema.json", rules: {} });
    expect(() => loadConfig(dir)).not.toThrow();
  });

  it("applies CLI overrides over file values", () => {
    write("codebase-intelligence.json", { ci: { failOn: "error" }, output: { format: "text" } });
    const { config } = loadConfig(dir, { failOn: "warn", format: "json" });
    expect(config.ci?.failOn).toBe("warn");
    expect(config.output?.format).toBe("json");
  });

  it("uses an explicit configPath override", () => {
    const custom = path.join(dir, "my.json");
    fs.writeFileSync(custom, JSON.stringify({ rules: { "no-circular-deps": "off" } }));
    const { config, configPath } = loadConfig(dir, { configPath: custom });
    expect(configPath).toBe(custom);
    expect(config.rules?.["no-circular-deps"]).toBe("off");
  });
});
