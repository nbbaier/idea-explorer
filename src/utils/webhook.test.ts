import { Result } from "better-result";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../jobs";
import { logError } from "./logger";
import { sendWebhook } from "./webhook";

vi.mock("./logger", () => ({ logError: vi.fn(), logWebhookSent: vi.fn() }));

const SIGNATURE_PATTERN = /^sha256=[a-f0-9]{64}$/;

describe("webhook utility", () => {
  const mockJob: Job = {
    id: "test-job",
    idea: "Test Idea",
    mode: "exploration",
    model: "sonnet",
    status: "completed",
    webhook_url: "https://example.com/webhook",
    github_url:
      "https://github.com/owner/repo/blob/main/ideas/test/research.md",
    created_at: Date.now(),
    step_durations: { step1: 100 },
  };

  const githubRepo = "owner/repo";
  const branch = "main";
  const originalFetch = globalThis.fetch;
  let fetchMock: Mock;
  const flushTimers = async () => {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: Mock }).fetch = fetchMock;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    vi.useRealTimers();
  });

  it("should send a successful webhook", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const result = sendWebhook(mockJob, githubRepo, branch);
    const finalResult = await result;

    if (!Result.isOk(finalResult)) {
      throw new Error("Expected ok result");
    }
    expect(finalResult.value.success).toBe(true);
    expect(finalResult.value.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      mockJob.webhook_url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );

    const completedCallArgs = fetchMock.mock.calls[0]?.[1];
    const callBody = JSON.parse(completedCallArgs?.body as string);
    expect(callBody).toMatchObject({
      event: "idea_explored",
      status: "completed",
      job_id: mockJob.id,
      idea: mockJob.idea,
      github_url: mockJob.github_url,
    });
  });

  it("should include HMAC signature when callback_secret is provided", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const jobWithSecret = {
      ...mockJob,
      callback_secret: "test-secret",
    };

    const result = await sendWebhook(jobWithSecret, githubRepo, branch);

    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.success).toBe(true);
    const callArgs = fetchMock.mock.calls[0]?.[1];
    const headers = callArgs?.headers as Record<string, string>;
    expect(headers["X-Signature"]).toBeDefined();
    expect(headers["X-Signature"]).toMatch(SIGNATURE_PATTERN);
  });

  it("should send a failure webhook", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const failedJob: Job = {
      ...mockJob,
      status: "failed",
      error: "Something went wrong",
    };

    const result = await sendWebhook(failedJob, githubRepo, branch);

    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.success).toBe(true);
    const failedCallArgs = fetchMock.mock.calls[0]?.[1];
    const failedCallBody = JSON.parse(failedCallArgs?.body as string);
    expect(failedCallBody).toMatchObject({
      event: "idea_explored",
      status: "failed",
      job_id: failedJob.id,
      error: "Something went wrong",
    });
  });

  it("should retry on failure", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const promise = sendWebhook(mockJob, githubRepo, branch);
    await flushTimers();

    const result = await promise;

    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.success).toBe(true);
    expect(result.value.attempts).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should return error after max retries", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const promise = sendWebhook(mockJob, githubRepo, branch);
    await flushTimers();

    const result = await promise;

    if (!Result.isError(result)) {
      throw new Error("Expected error result");
    }
    expect(result.error.name).toBe("WebhookDeliveryError");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("should log when webhook cannot be delivered", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const promise = sendWebhook(mockJob, githubRepo, branch);
    await flushTimers();

    const result = await promise;

    expect(Result.isError(result)).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      "webhook_delivery_failed",
      expect.any(Error),
      expect.objectContaining({
        status_code: 503,
        attempts: 3,
        url: mockJob.webhook_url,
      }),
      mockJob.id
    );
  });

  it("should handle fetch exceptions", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const promise = sendWebhook(mockJob, githubRepo, branch);
    await flushTimers();

    const result = await promise;

    if (!Result.isError(result)) {
      throw new Error("Expected error result");
    }
    expect(result.error.name).toBe("WebhookDeliveryError");
  });

  it("should return success true immediately if no webhook_url", async () => {
    const jobNoUrl = { ...mockJob, webhook_url: undefined };
    const result = await sendWebhook(jobNoUrl, githubRepo, branch);

    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.success).toBe(true);
    expect(result.value.attempts).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
