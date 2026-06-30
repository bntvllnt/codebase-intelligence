import fs from "fs";
import path from "path";
import { CANONICAL_INDEX_DIR_NAME, LEGACY_INDEX_DIR_NAME } from "./cache-key.js";

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
