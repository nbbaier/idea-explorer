import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../jobs";
import { sendWebhook } from "./webhook";

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

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should send a successful webhook", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const result = sendWebhook(mockJob, githubRepo, branch);

    const finalResult = await result;

    expect(finalResult.success).toBe(true);
    expect(finalResult.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      mockJob.webhook_url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );

    const completedCallArgs = vi.mocked(fetch).mock.calls[0]?.[1];
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
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const jobWithSecret = {
      ...mockJob,
      callback_secret: "test-secret",
    };

    const result = await sendWebhook(jobWithSecret, githubRepo, branch);

    expect(result.success).toBe(true);
    const callArgs = vi.mocked(fetch).mock.calls[0]?.[1];
    const headers = callArgs?.headers as Record<string, string>;
    expect(headers["X-Signature"]).toBeDefined();
    expect(headers["X-Signature"]).toMatch(SIGNATURE_PATTERN);
  });

  it("should send a failure webhook", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const failedJob: Job = {
      ...mockJob,
      status: "failed",
      error: "Something went wrong",
    };

    const result = await sendWebhook(failedJob, githubRepo, branch);

    expect(result.success).toBe(true);
    const failedCallArgs = vi.mocked(fetch).mock.calls[0]?.[1];
    const failedCallBody = JSON.parse(failedCallArgs?.body as string);
    expect(failedCallBody).toMatchObject({
      event: "idea_explored",
      status: "failed",
      job_id: failedJob.id,
      error: "Something went wrong",
    });
  });

  it("should retry on failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const promise = sendWebhook(mockJob, githubRepo, branch);

    // First attempt fails, wait for next attempt
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should return success false after max retries", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const promise = sendWebhook(mockJob, githubRepo, branch);

    // Attempt 1 fails, wait for 2
    await vi.advanceTimersByTimeAsync(1000);
    // Attempt 2 fails, wait for 3
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("should handle fetch exceptions", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const promise = sendWebhook(mockJob, githubRepo, branch);

    // Attempt 1 fails, wait for 2
    await vi.advanceTimersByTimeAsync(1000);
    // Attempt 2 fails, wait for 3
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it("should return success true immediately if no webhook_url", async () => {
    const jobNoUrl = { ...mockJob, webhook_url: undefined };
    const result = await sendWebhook(jobNoUrl, githubRepo, branch);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
