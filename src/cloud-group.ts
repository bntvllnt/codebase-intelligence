const SOURCE_DIRS = new Set(["src", "lib", "app", "packages", "apps"]);

export function cloudGroup(mod: string): string {
  const parts = mod.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length === 0 || parts[0] === ".") return "root";
  const start = SOURCE_DIRS.has(parts[0]) ? 1 : 0;
  const meaningful = parts.slice(start);
  if (meaningful.length === 0) return parts[0];
  if (meaningful.length === 1) return meaningful[0];
  return meaningful.slice(0, 2).join("/");
}
