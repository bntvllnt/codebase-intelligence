function formatDate(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export { formatDate, truncate };
