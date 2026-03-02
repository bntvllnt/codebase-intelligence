import { authenticate, requireAuth } from "../auth/auth-middleware.js";
import { log } from "../utils/logger.js";
import type { RequestContext } from "../auth/auth-middleware.js";

export function withAuth(
  handler: (ctx: RequestContext) => unknown
): (ctx: RequestContext) => unknown {
  return (ctx: RequestContext) => {
    log("api-middleware", "withAuth()");
    const authed = authenticate(ctx);
    if (!requireAuth(authed)) {
      return { error: "Unauthorized", status: 401 };
    }
    return handler(authed);
  };
}

export function withLogging(
  handler: (ctx: RequestContext) => unknown
): (ctx: RequestContext) => unknown {
  return (ctx: RequestContext) => {
    log("api-middleware", `Request: ${JSON.stringify(ctx.headers)}`);
    const result = handler(ctx);
    log("api-middleware", "Response sent");
    return result;
  };
}
