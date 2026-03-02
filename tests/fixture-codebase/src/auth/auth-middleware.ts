import { AuthService } from "./auth-service.js";
import { log, logError } from "../utils/logger.js";
import type { User } from "../users/user-types.js";

export interface RequestContext {
  headers: Record<string, string>;
  user?: User;
}

const authService = new AuthService();

export function authenticate(ctx: RequestContext): RequestContext {
  log("middleware", "authenticate()");
  const token = ctx.headers["authorization"]?.replace("Bearer ", "");

  if (!token) {
    logError("middleware", new Error("No token provided"));
    return ctx;
  }

  const user = authService.validate(token);
  return { ...ctx, user };
}

export function requireAuth(ctx: RequestContext): boolean {
  log("middleware", "requireAuth()");
  return ctx.user !== undefined;
}
