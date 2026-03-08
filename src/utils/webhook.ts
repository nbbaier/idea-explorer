import { Result } from "better-result";
import { z } from "zod";
import { WebhookDeliveryError } from "../errors";
import type { Job } from "../jobs";
import { logError, logWebhookSent } from "./logger";

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
const WEBHOOK_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 60_000;

interface WebhookResponse {
  ok: boolean;
  status: number;
  retryAfterMs?: number;
}

export interface WebhookResult {
  success: boolean;
  statusCode?: number;
  attempts: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  const delayMs = retryAt - Date.now();
  if (delayMs <= 0) {
    return undefined;
  }
  return Math.min(delayMs, MAX_RETRY_AFTER_MS);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Webhook request timed out"));
  }, WEBHOOK_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendWebhook(
  job: Job,
  githubRepo: string,
  branch: string,
  extraHeaders?: Record<string, string>
): Promise<Result<WebhookResult, WebhookDeliveryError>> {
  if (!job.webhook_url) {
    return Result.ok({ success: true, attempts: 0 });
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

  let lastResponse: WebhookResponse | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(webhookUrl, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });
      const isRedirect = response.status >= 300 && response.status < 400;
      lastResponse = {
        ok: response.ok && !isRedirect,
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
      };
    } catch (error) {
      logError(`webhook_attempt_${attempt}`, error, undefined, job.id);
      lastResponse = { ok: false, status: 0 };
    }

    logWebhookSent(job.id, lastResponse.status, attempt);

    if (lastResponse.ok) {
      return Result.ok({
        success: true,
        statusCode: lastResponse.status,
        attempts: attempt,
      });
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(
        lastResponse.retryAfterMs ?? RETRY_DELAYS_MS[attempt - 1] ?? 0
      );
    }
  }

  const lastStatus = lastResponse?.status ?? 0;
  logError(
    "webhook_delivery_failed",
    new Error("Webhook delivery failed"),
    {
      status_code: lastStatus,
      attempts: MAX_ATTEMPTS,
      url: webhookUrl,
    },
    job.id
  );

  return Result.err(
    new WebhookDeliveryError({
      url: webhookUrl,
      attempts: MAX_ATTEMPTS,
      lastStatus,
    })
  );
}
