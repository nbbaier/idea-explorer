import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, ExploreRequestSchema, getJob, updateJob } from "./jobs";

describe("Job Management", () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    const storage = new Map<string, string>();
    mockKV = {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key) || null)),
      put: vi.fn((key: string, value: string, _options?: unknown) => {
        storage.set(key, value);
        return Promise.resolve();
      }),
    } as unknown as KVNamespace;
  });

  describe("Webhook URL validation", () => {
    const baseRequest = { idea: "Test idea" };

    it("allows public https URLs", () => {
      const result = ExploreRequestSchema.safeParse({
        ...baseRequest,
        webhook_url: "https://example.com/webhook",
      });
      expect(result.success).toBe(true);
    });

    it("rejects private or reserved IPv4", () => {
      const blocked = [
        "http://10.0.0.5/webhook",
        "http://172.20.1.2/webhook",
        "http://192.168.0.10/webhook",
        "http://127.0.0.1/webhook",
        "http://169.254.10.10/webhook",
        "http://100.64.0.1/webhook",
      ];
      for (const url of blocked) {
        const result = ExploreRequestSchema.safeParse({
          ...baseRequest,
          webhook_url: url,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects private or reserved IPv6", () => {
      const blocked = [
        "http://[::1]/webhook",
        "http://[fd00::1]/webhook",
        "http://[fe80::1]/webhook",
        "http://[::ffff:192.168.1.5]/webhook",
      ];
      for (const url of blocked) {
        const result = ExploreRequestSchema.safeParse({
          ...baseRequest,
          webhook_url: url,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects internal or single-label hostnames", () => {
      const blocked = [
        "http://localhost:3000/webhook",
        "http://api.internal/webhook",
        "http://printer/webhook",
        "http://service.local/webhook",
      ];
      for (const url of blocked) {
        const result = ExploreRequestSchema.safeParse({
          ...baseRequest,
          webhook_url: url,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("Step Progress Tracking", () => {
    it("should create a job without step progress fields", async () => {
      const job = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(job.current_step).toBeUndefined();
      expect(job.current_step_label).toBeUndefined();
      expect(job.steps_completed).toBeUndefined();
      expect(job.steps_total).toBeUndefined();
      expect(job.step_started_at).toBeUndefined();
      expect(job.step_durations).toBeUndefined();
    });

    it("should update job with step progress", async () => {
      const job = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      const updated = await updateJob(mockKV, job.id, {
        current_step: "initialize",
        current_step_label: "Initializing job...",
        steps_completed: 0,
        steps_total: 5,
        step_started_at: Date.now(),
      });

      expect(updated?.current_step).toBe("initialize");
      expect(updated?.current_step_label).toBe("Initializing job...");
      expect(updated?.steps_completed).toBe(0);
      expect(updated?.steps_total).toBe(5);
      expect(updated?.step_started_at).toBeDefined();
    });

    it("should update job with step durations", async () => {
      const job = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      const updated = await updateJob(mockKV, job.id, {
        step_durations: { initialize: 245, check_existing: 1820 },
      });

      expect(updated?.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });

    it("should preserve existing step durations when adding new ones", async () => {
      const job = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      await updateJob(mockKV, job.id, {
        step_durations: { initialize: 245 },
      });

      const existingJob = await getJob(mockKV, job.id);
      const updated = await updateJob(mockKV, job.id, {
        step_durations: {
          ...existingJob?.step_durations,
          check_existing: 1820,
        },
      });

      expect(updated?.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });

    it("should track multiple step updates in sequence", async () => {
      const job = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      // Step 1: Initialize
      await updateJob(mockKV, job.id, {
        current_step: "initialize",
        current_step_label: "Initializing job...",
        steps_completed: 0,
        steps_total: 5,
        step_started_at: Date.now(),
      });

      // Step 2: Check existing
      const job1 = await getJob(mockKV, job.id);
      await updateJob(mockKV, job.id, {
        current_step: "check_existing",
        current_step_label: "Checking for existing research...",
        steps_completed: 1,
        step_started_at: Date.now(),
        step_durations: { ...job1?.step_durations, initialize: 245 },
      });

      // Step 3: Generate research
      const job2 = await getJob(mockKV, job.id);
      await updateJob(mockKV, job.id, {
        current_step: "generate_research",
        current_step_label: "Generating research with Claude...",
        steps_completed: 2,
        step_started_at: Date.now(),
        step_durations: { ...job2?.step_durations, check_existing: 1820 },
      });

      const finalJob = await getJob(mockKV, job.id);
      expect(finalJob?.current_step).toBe("generate_research");
      expect(finalJob?.steps_completed).toBe(2);
      expect(finalJob?.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });
  });
});
