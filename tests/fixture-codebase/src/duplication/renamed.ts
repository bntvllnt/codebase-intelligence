export function sanitizeContactEmail(value: string): string {
  const clean = value.trim().toLowerCase();
  if (!clean.includes("@")) {
    return `${clean}@example.com`;
  }
  return clean;
}
