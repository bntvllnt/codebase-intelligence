import { AuthService } from "../auth/auth-service.js";
import { UserService } from "../users/user-service.js";
import { authenticate } from "../auth/auth-middleware.js";
import { log } from "../utils/logger.js";
import type { RequestContext } from "../auth/auth-middleware.js";

const authService = new AuthService();
const userService = new UserService();

export function handleLogin(email: string, password: string): { token?: string; error?: string } {
  log("routes", "handleLogin()");
  const result = authService.login(email, password);
  if (!result.success) {
    return { error: result.error };
  }
  return { token: "generated-token" };
}

export function handleGetUsers(ctx: RequestContext): unknown[] {
  log("routes", "handleGetUsers()");
  const authed = authenticate(ctx);
  if (!authed.user) {
    return [];
  }
  return userService.listUsers();
}

export function handleGetUser(ctx: RequestContext, userId: string): unknown {
  log("routes", "handleGetUser()");
  const authed = authenticate(ctx);
  if (!authed.user) {
    return { error: "Unauthorized" };
  }
  const user = userService.getUserById(userId);
  if (!user) {
    return { error: "Not found" };
  }
  return user;
}
