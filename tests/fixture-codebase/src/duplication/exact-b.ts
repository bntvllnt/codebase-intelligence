export function formatAccountEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.includes("@")) {
    return `${trimmed}@example.com`;
  }
  return trimmed;
}
