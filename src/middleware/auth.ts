export interface AuthEnv {
	API_BEARER_TOKEN: string;
}

export type AuthResult =
	| { success: true }
	| { success: false; response: Response };

export function requireAuth(request: Request, env: AuthEnv): AuthResult {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader) {
		return {
			success: false,
			response: new Response(
				JSON.stringify({ error: "Unauthorized: Missing Authorization header" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	if (!authHeader.startsWith("Bearer ")) {
		return {
			success: false,
			response: new Response(
				JSON.stringify({
					error: "Unauthorized: Invalid Authorization header format",
				}),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	const token = authHeader.slice(7);

	// Use constant-time comparison to prevent timing attacks
	const encoder = new TextEncoder();
	const tokenBuffer = encoder.encode(token);
	const secretBuffer = encoder.encode(env.API_BEARER_TOKEN);

	if (tokenBuffer.byteLength !== secretBuffer.byteLength) {
		return {
			success: false,
			response: new Response(
				JSON.stringify({ error: "Unauthorized: Invalid token" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	if (!crypto.subtle.timingSafeEqual(tokenBuffer, secretBuffer)) {
		return {
			success: false,
			response: new Response(
				JSON.stringify({ error: "Unauthorized: Invalid token" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	return { success: true };
}
