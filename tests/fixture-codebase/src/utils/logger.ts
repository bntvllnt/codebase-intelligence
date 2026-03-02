export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "info";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(context: string, message: string, level: LogLevel = "info"): void {
  if (levels[level] >= levels[currentLevel]) {
    console.log(`[${level.toUpperCase()}] [${context}] ${message}`);
  }
}

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log(context, message, "error");
}

export default log;
