export const APP_NAME = "fixture-app";

export const MAX_LOGIN_ATTEMPTS = 5;

export const SESSION_TIMEOUT_MS = 3600000;

export function getDefaultPort(): number {
  return 3000;
}

export function getEnvironment(): string {
  return process.env.NODE_ENV ?? "development";
}

export const DEPRECATED_FLAG = true;
