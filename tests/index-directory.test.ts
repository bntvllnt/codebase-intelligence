import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { CANONICAL_INDEX_DIR_NAME, LEGACY_INDEX_DIR_NAME } from "../src/persistence/cache-key.js";
import { cleanIndexDirectories, prepareIndexDirectory } from "../src/persistence/index-dir.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ci-index-dir-"));
}

describe("index directory migration", () => {
  it("uses the canonical directory when no cache exists", () => {
    const dir = tempDir();
    try {
      const result = prepareIndexDirectory(dir);
      expect(result.activeDir).toBe(path.join(dir, CANONICAL_INDEX_DIR_NAME));
      expect(result.migration).toBe("none");
      expect(fs.existsSync(result.activeDir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps an existing canonical directory", () => {
    const dir = tempDir();
    try {
      const canonical = path.join(dir, CANONICAL_INDEX_DIR_NAME);
      fs.mkdirSync(canonical);

      const result = prepareIndexDirectory(dir);
      expect(result.activeDir).toBe(canonical);
      expect(result.migration).toBe("none");
      expect(fs.existsSync(canonical)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates a legacy-only directory to the canonical name", () => {
    const dir = tempDir();
    try {
      const legacy = path.join(dir, LEGACY_INDEX_DIR_NAME);
      const canonical = path.join(dir, CANONICAL_INDEX_DIR_NAME);
      fs.mkdirSync(legacy);
      fs.writeFileSync(path.join(legacy, "marker.txt"), "legacy\n");

      const result = prepareIndexDirectory(dir);
      expect(result.activeDir).toBe(canonical);
      expect(result.migration).toBe("migrated-legacy");
      expect(fs.existsSync(legacy)).toBe(false);
      expect(fs.readFileSync(path.join(canonical, "marker.txt"), "utf-8")).toBe("legacy\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers canonical and leaves legacy untouched when both have the same signature", () => {
    const dir = tempDir();
    try {
      const canonical = path.join(dir, CANONICAL_INDEX_DIR_NAME);
      const legacy = path.join(dir, LEGACY_INDEX_DIR_NAME);
      fs.mkdirSync(canonical);
      fs.mkdirSync(legacy);
      fs.writeFileSync(path.join(canonical, "marker.txt"), "canonical\n");
      fs.writeFileSync(path.join(legacy, "marker.txt"), "legacy\n");
      fs.writeFileSync(path.join(canonical, "meta.json"), JSON.stringify({ cacheKey: "same" }));
      fs.writeFileSync(path.join(legacy, "meta.json"), JSON.stringify({ cacheKey: "same" }));

      const result = prepareIndexDirectory(dir);
      expect(result.activeDir).toBe(canonical);
      expect(result.migration).toBe("ignored-legacy");
      expect(fs.readFileSync(path.join(canonical, "marker.txt"), "utf-8")).toBe("canonical\n");
      expect(fs.readFileSync(path.join(legacy, "marker.txt"), "utf-8")).toBe("legacy\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers canonical and leaves legacy untouched when both have different signatures", () => {
    const dir = tempDir();
    try {
      const canonical = path.join(dir, CANONICAL_INDEX_DIR_NAME);
      const legacy = path.join(dir, LEGACY_INDEX_DIR_NAME);
      fs.mkdirSync(canonical);
      fs.mkdirSync(legacy);
      fs.writeFileSync(path.join(canonical, "meta.json"), JSON.stringify({ cacheKey: "canonical" }));
      fs.writeFileSync(path.join(legacy, "meta.json"), JSON.stringify({ cacheKey: "legacy" }));

      const result = prepareIndexDirectory(dir);
      expect(result.activeDir).toBe(canonical);
      expect(result.migration).toBe("ignored-legacy");
      expect(JSON.parse(fs.readFileSync(path.join(canonical, "meta.json"), "utf-8"))).toEqual({ cacheKey: "canonical" });
      expect(JSON.parse(fs.readFileSync(path.join(legacy, "meta.json"), "utf-8"))).toEqual({ cacheKey: "legacy" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clean removes canonical and legacy index directories", () => {
    const dir = tempDir();
    try {
      const canonical = path.join(dir, CANONICAL_INDEX_DIR_NAME);
      const legacy = path.join(dir, LEGACY_INDEX_DIR_NAME);
      fs.mkdirSync(canonical);
      fs.mkdirSync(legacy);

      const removed = cleanIndexDirectories(dir);
      expect(removed.sort()).toEqual([canonical, legacy].sort());
      expect(fs.existsSync(canonical)).toBe(false);
      expect(fs.existsSync(legacy)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
