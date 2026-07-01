export function prepareInviteEmail(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return `${normalized}@example.com`;
  }
  return normalized || "unknown@example.com";
}
