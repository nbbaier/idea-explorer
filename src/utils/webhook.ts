import { z } from "zod";
import type { Job } from "../jobs";
import { logError, logWebhookSent } from "./logger";
import { retryWithBackoff } from "./retry";

const WebhookSuccessPayloadSchema = z.object({
  event: z.literal("idea_explored"),
  status: z.literal("completed"),
  job_id: z.string(),
  idea: z.string(),
  github_url: z.string(),
  github_raw_url: z.string(),
  step_durations: z.record(z.string(), z.number()).optional(),
});

const WebhookFailurePayloadSchema = z.object({
  event: z.literal("idea_explored"),
  status: z.literal("failed"),
  job_id: z.string(),
  idea: z.string(),
  error: z.string(),
  step_durations: z.record(z.string(), z.number()).optional(),
});

const WebhookPayloadSchema = z.discriminatedUnion("status", [
  WebhookSuccessPayloadSchema,
  WebhookFailurePayloadSchema,
]);

type WebhookSuccessPayload = z.infer<typeof WebhookSuccessPayloadSchema>;
type WebhookFailurePayload = z.infer<typeof WebhookFailurePayloadSchema>;
type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

const encoder = new TextEncoder();

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

async function generateSignature(
  secret: string,
  body: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(toHex).join("");
  return `sha256=${hashHex}`;
}

function buildSuccessPayload(
  job: Job,
  githubRepo: string,
  branch: string
): WebhookSuccessPayload {
  const githubUrl = job.github_url ?? "";
  const outputPath = githubUrl.split(`/blob/${branch}/`)[1] ?? "";
  const githubRawUrl = outputPath
    ? `https://raw.githubusercontent.com/${githubRepo}/${branch}/${outputPath}`
    : "";

  const payload: WebhookSuccessPayload = {
    event: "idea_explored",
    status: "completed",
    job_id: job.id,
    idea: job.idea,
    github_url: githubUrl,
    github_raw_url: githubRawUrl,
  };

  if (job.step_durations) {
    payload.step_durations = job.step_durations;
  }

  return payload;
}

function buildFailurePayload(job: Job): WebhookFailurePayload {
  const payload: WebhookFailurePayload = {
    event: "idea_explored",
    status: "failed",
    job_id: job.id,
    idea: job.idea,
    error: job.error ?? "Unknown error",
  };

  if (job.step_durations) {
    payload.step_durations = job.step_durations;
  }

  return payload;
}

const RETRY_DELAYS_MS = [1000, 5000, 30_000]; // 1s, 5s, 30s
const MAX_ATTEMPTS = 3;

interface WebhookResponse {
  ok: boolean;
  status: number;
}

export async function sendWebhook(
  job: Job,
  githubRepo: string,
  branch: string,
  extraHeaders?: Record<string, string>
): Promise<{ success: boolean; statusCode?: number; attempts: number }> {
  if (!job.webhook_url) {
    return { success: true, attempts: 0 };
  }

  const webhookUrl = job.webhook_url;

  let payload: WebhookPayload;
  if (job.status === "completed") {
    payload = buildSuccessPayload(job, githubRepo, branch);
  } else {
    payload = buildFailurePayload(job);
  }

  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (job.callback_secret) {
    headers["X-Signature"] = await generateSignature(job.callback_secret, body);
  }

  async function attemptWebhook(attempt: number): Promise<WebhookResponse> {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });
      const isRedirect = response.status >= 300 && response.status < 400;
      return { ok: response.ok && !isRedirect, status: response.status };
    } catch (error) {
      logError(`webhook_attempt_${attempt}`, error, undefined, job.id);
      return { ok: false, status: 0 };
    }
  }

  function shouldRetry(response: WebhookResponse): boolean {
    return !response.ok;
  }

  function recordAttempt(attempt: number, response: WebhookResponse): void {
    logWebhookSent(job.id, response.status, attempt);
  }

  const result = await retryWithBackoff<WebhookResponse>(
    attemptWebhook,
    shouldRetry,
    {
      maxAttempts: MAX_ATTEMPTS,
      delaysMs: RETRY_DELAYS_MS,
    },
    recordAttempt
  );

  if (!result.success) {
    logError(
      "webhook_delivery_failed",
      new Error("Webhook delivery failed"),
      {
        status_code: result.result?.status ?? 0,
        attempts: result.attempts,
        url: webhookUrl,
      },
      job.id
    );
  }

  return {
    success: result.success,
    statusCode: result.result?.status,
    attempts: result.attempts,
  };
}
