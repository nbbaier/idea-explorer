import type { Job } from "../jobs";
import { logError, logWebhookSent } from "./logger";

export interface WebhookSuccessPayload {
	status: "completed";
	job_id: string;
	idea: string;
	github_url: string;
	github_raw_url: string;
}

export interface WebhookFailurePayload {
	status: "failed";
	job_id: string;
	idea: string;
	error: string;
}

export type WebhookPayload = WebhookSuccessPayload | WebhookFailurePayload;

async function generateSignature(
	secret: string,
	body: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const hashArray = Array.from(new Uint8Array(signature));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hashHex}`;
}

function buildSuccessPayload(
	job: Job,
	githubRepo: string,
	branch: string,
): WebhookSuccessPayload {
	const githubUrl = job.github_url ?? "";
	const outputPath = githubUrl.split(`/blob/${branch}/`)[1] ?? "";
	const githubRawUrl = `https://raw.githubusercontent.com/${githubRepo}/${branch}/${outputPath}`;

	return {
		status: "completed",
		job_id: job.id,
		idea: job.idea,
		github_url: githubUrl,
		github_raw_url: githubRawUrl,
	};
}

function buildFailurePayload(job: Job): WebhookFailurePayload {
	return {
		status: "failed",
		job_id: job.id,
		idea: job.idea,
		error: job.error ?? "Unknown error",
	};
}

const RETRY_DELAYS_MS = [1000, 5000, 30000]; // 1s, 5s, 30s
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWebhook(
	job: Job,
	githubRepo: string,
	branch: string,
): Promise<{ success: boolean; statusCode?: number; attempts: number }> {
	if (!job.webhook_url) {
		return { success: true, attempts: 0 };
	}

	const payload: WebhookPayload =
		job.status === "completed"
			? buildSuccessPayload(job, githubRepo, branch)
			: buildFailurePayload(job);

	const body = JSON.stringify(payload);

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (job.callback_secret) {
		headers["X-Signature"] = await generateSignature(job.callback_secret, body);
	}

	let lastStatusCode: number | undefined;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(job.webhook_url, {
				method: "POST",
				headers,
				body,
			});

			lastStatusCode = response.status;
			logWebhookSent(job.id, response.status, attempt);

			if (response.ok) {
				return {
					success: true,
					statusCode: response.status,
					attempts: attempt,
				};
			}
		} catch (error) {
			logError(job.id, `webhook_attempt_${attempt}`, error);
		}

		// Wait before next retry (if not last attempt)
		if (attempt < MAX_ATTEMPTS) {
			await sleep(RETRY_DELAYS_MS[attempt - 1]);
		}
	}

	return {
		success: false,
		statusCode: lastStatusCode,
		attempts: MAX_ATTEMPTS,
	};
}
