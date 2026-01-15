import type { Context, MiddlewareHandler, Next } from "hono";

interface AuthEnv {
  IDEA_EXPLORER_API_TOKEN: string;
}

const encoder = new TextEncoder();

type AuthContext = Context<{ Bindings: AuthEnv }>;

function unauthorized(c: AuthContext, message: string): Response {
  return c.json({ error: message }, 401);
}

export function requireAuth(): MiddlewareHandler<{ Bindings: AuthEnv }> {
  return async function requireAuthMiddleware(
    c: AuthContext,
    next: Next
  ): Promise<Response | void> {
    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      return unauthorized(c, "Unauthorized: Missing Authorization header");
    }

    if (!authHeader.startsWith("Bearer ")) {
      return unauthorized(
        c,
        "Unauthorized: Invalid Authorization header format"
      );
    }

    const token = authHeader.slice(7);

    const tokenBuffer = encoder.encode(token);
    const secretBuffer = encoder.encode(c.env.IDEA_EXPLORER_API_TOKEN);

    if (tokenBuffer.byteLength !== secretBuffer.byteLength) {
      return unauthorized(c, "Unauthorized: Invalid token");
    }

    if (!crypto.subtle.timingSafeEqual(tokenBuffer, secretBuffer)) {
      return unauthorized(c, "Unauthorized: Invalid token");
    }

    await next();
  };
}
