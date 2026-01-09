import type { Job } from "../jobs";
import { logError, logWebhookSent } from "./logger";
import { retryWithBackoff } from "./retry";

interface WebhookSuccessPayload {
	status: "completed";
	job_id: string;
	idea: string;
	github_url: string;
	github_raw_url: string;
}

interface WebhookFailurePayload {
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
	const githubRawUrl = outputPath
		? `https://raw.githubusercontent.com/${githubRepo}/${branch}/${outputPath}`
		: "";

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

interface WebhookResponse {
	ok: boolean;
	status: number;
}

export async function sendWebhook(
	job: Job,
	githubRepo: string,
	branch: string,
	extraHeaders?: Record<string, string>,
): Promise<{ success: boolean; statusCode?: number; attempts: number }> {
	if (!job.webhook_url) {
		return { success: true, attempts: 0 };
	}

	const webhookUrl = job.webhook_url;

	const payload: WebhookPayload =
		job.status === "completed"
			? buildSuccessPayload(job, githubRepo, branch)
			: buildFailurePayload(job);

	const body = JSON.stringify(payload);

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...extraHeaders,
	};

	if (job.callback_secret) {
		headers["X-Signature"] = await generateSignature(job.callback_secret, body);
	}

	const result = await retryWithBackoff<WebhookResponse>(
		async (attempt) => {
			try {
				const response = await fetch(webhookUrl, {
					method: "POST",
					headers,
					body,
				});
				return { ok: response.ok, status: response.status };
			} catch (error) {
				logError(job.id, `webhook_attempt_${attempt}`, error);
				return { ok: false, status: 0 };
			}
		},
		(response) => !response.ok,
		{
			maxAttempts: MAX_ATTEMPTS,
			delaysMs: RETRY_DELAYS_MS,
		},
		(attempt, response) => {
			logWebhookSent(job.id, response.status, attempt);
		},
	);

	return {
		success: result.success,
		statusCode: result.result?.status,
		attempts: result.attempts,
	};
}
