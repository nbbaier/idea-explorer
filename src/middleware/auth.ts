import type { Context, MiddlewareHandler } from "hono";

interface AuthEnv {
	API_BEARER_TOKEN: string;
}

export const requireAuth = (): MiddlewareHandler<{ Bindings: AuthEnv }> => {
	return async (c: Context<{ Bindings: AuthEnv }>, next) => {
		const authHeader = c.req.header("Authorization");

		if (!authHeader) {
			return c.json(
				{ error: "Unauthorized: Missing Authorization header" },
				401,
			);
		}

		if (!authHeader.startsWith("Bearer ")) {
			return c.json(
				{ error: "Unauthorized: Invalid Authorization header format" },
				401,
			);
		}

		const token = authHeader.slice(7);

		const encoder = new TextEncoder();
		const tokenBuffer = encoder.encode(token);
		const secretBuffer = encoder.encode(c.env.API_BEARER_TOKEN);

		if (tokenBuffer.byteLength !== secretBuffer.byteLength) {
			return c.json({ error: "Unauthorized: Invalid token" }, 401);
		}

		if (!crypto.subtle.timingSafeEqual(tokenBuffer, secretBuffer)) {
			return c.json({ error: "Unauthorized: Invalid token" }, 401);
		}

		await next();
	};
};
