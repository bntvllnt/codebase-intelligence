import fs from "fs";
import path from "path";
import { CANONICAL_INDEX_DIR_NAME, LEGACY_INDEX_DIR_NAME } from "./cache-key.js";
import type { CacheFacts } from "../types/index.js";

type IndexDirectoryMigration = "none" | "migrated-legacy" | "ignored-legacy";

export interface IndexDirectoryResolution {
  activeDir: string;
  canonicalDir: string;
  legacyDir: string;
  migration: IndexDirectoryMigration;
}

/**
 * Return canonical and legacy cache paths for a target repo.
 *
 * @param targetPath - Repo/codebase root passed to the CLI.
 * @returns Absolute paths for canonical and legacy cache directories.
 */
export function getIndexDirs(targetPath: string): Pick<IndexDirectoryResolution, "canonicalDir" | "legacyDir"> {
  const root = path.resolve(targetPath);
  return {
    canonicalDir: path.join(root, CANONICAL_INDEX_DIR_NAME),
    legacyDir: path.join(root, LEGACY_INDEX_DIR_NAME),
  };
}

/**
 * Resolve the cache directory and migrate a legacy-only cache when safe.
 *
 * @param targetPath - Repo/codebase root passed to the CLI.
 * @returns The active canonical cache directory plus migration status.
 */
export function prepareIndexDirectory(targetPath: string): IndexDirectoryResolution {
  const { canonicalDir, legacyDir } = getIndexDirs(targetPath);
  const canonicalExists = fs.existsSync(canonicalDir);
  const legacyExists = fs.existsSync(legacyDir);

  if (!canonicalExists && legacyExists && fs.statSync(legacyDir).isDirectory()) {
    fs.renameSync(legacyDir, canonicalDir);
    return { activeDir: canonicalDir, canonicalDir, legacyDir, migration: "migrated-legacy" };
  }

  return {
    activeDir: canonicalDir,
    canonicalDir,
    legacyDir,
    migration: canonicalExists && legacyExists ? "ignored-legacy" : "none",
  };
}

function getLegacyWarnings(resolution: IndexDirectoryResolution): string[] {
  if (resolution.migration === "ignored-legacy") {
    return [`Legacy cache directory exists but ${resolution.canonicalDir} is active: ${resolution.legacyDir}`];
  }

  if (!fs.existsSync(resolution.legacyDir)) return [];

  try {
    if (!fs.statSync(resolution.legacyDir).isDirectory()) {
      return [`Legacy cache path exists but is not a directory and was left unchanged: ${resolution.legacyDir}`];
    }
  } catch {
    return [`Legacy cache path could not be inspected and was left unchanged: ${resolution.legacyDir}`];
  }

  return [];
}

/**
 * Convert cache path resolution into the stable JSON facts emitted by CLI surfaces.
 *
 * @param resolution - Cache directory resolution returned by `prepareIndexDirectory`.
 * @param gitignoreUpdated - Whether the current command updated `.gitignore`.
 * @returns Machine-readable cache migration facts.
 */
export function getCacheFacts(resolution: IndexDirectoryResolution, gitignoreUpdated = false): CacheFacts {
  return {
    cacheDir: resolution.canonicalDir,
    legacyCacheDir: resolution.legacyDir,
    migrated: resolution.migration === "migrated-legacy",
    gitignoreUpdated,
    warnings: getLegacyWarnings(resolution),
  };
}

/**
 * Return cache facts for commands that do not resolve or migrate the index first.
 *
 * @param targetPath - Repo/codebase root passed to the CLI.
 * @param gitignoreUpdated - Whether the current command updated `.gitignore`.
 * @returns Machine-readable cache facts with migration set to false.
 */
export function getCacheFactsForTarget(targetPath: string, gitignoreUpdated = false): CacheFacts {
  const { canonicalDir, legacyDir } = getIndexDirs(targetPath);
  return getCacheFacts(
    {
      activeDir: canonicalDir,
      canonicalDir,
      legacyDir,
      migration: canonicalDir !== legacyDir && fs.existsSync(canonicalDir) && fs.existsSync(legacyDir) ? "ignored-legacy" : "none",
    },
    gitignoreUpdated,
  );
}

/**
 * Remove canonical and legacy cache directories for explicit clean commands.
 *
 * @param targetPath - Repo/codebase root passed to the CLI.
 * @returns Absolute paths removed from disk.
 */
export function cleanIndexDirectories(targetPath: string): string[] {
  const { canonicalDir, legacyDir } = getIndexDirs(targetPath);
  const removed: string[] = [];

  for (const dir of [canonicalDir, legacyDir]) {
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }

  return removed;
}
