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

	if (token !== env.API_BEARER_TOKEN) {
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
