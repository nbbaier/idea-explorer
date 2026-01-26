import { Result } from "better-result";
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
      const result = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) {
        throw new Error("Expected ok result");
      }
      expect(result.value.current_step).toBeUndefined();
      expect(result.value.current_step_label).toBeUndefined();
      expect(result.value.steps_completed).toBeUndefined();
      expect(result.value.steps_total).toBeUndefined();
      expect(result.value.step_started_at).toBeUndefined();
      expect(result.value.step_durations).toBeUndefined();
    });

    it("should update job with step progress", async () => {
      const createResult = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(createResult)).toBe(true);
      if (!Result.isOk(createResult)) {
        throw new Error("Expected ok result");
      }

      const updateResult = await updateJob(mockKV, createResult.value.id, {
        current_step: "initialize",
        current_step_label: "Initializing job...",
        steps_completed: 0,
        steps_total: 5,
        step_started_at: Date.now(),
      });

      expect(Result.isOk(updateResult)).toBe(true);
      if (!Result.isOk(updateResult)) {
        throw new Error("Expected ok result");
      }
      expect(updateResult.value.current_step).toBe("initialize");
      expect(updateResult.value.current_step_label).toBe("Initializing job...");
      expect(updateResult.value.steps_completed).toBe(0);
      expect(updateResult.value.steps_total).toBe(5);
      expect(updateResult.value.step_started_at).toBeDefined();
    });

    it("should update job with step durations", async () => {
      const createResult = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(createResult)).toBe(true);
      if (!Result.isOk(createResult)) {
        throw new Error("Expected ok result");
      }

      const updateResult = await updateJob(mockKV, createResult.value.id, {
        step_durations: { initialize: 245, check_existing: 1820 },
      });

      expect(Result.isOk(updateResult)).toBe(true);
      if (!Result.isOk(updateResult)) {
        throw new Error("Expected ok result");
      }
      expect(updateResult.value.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });

    it("should preserve existing step durations when adding new ones", async () => {
      const createResult = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(createResult)).toBe(true);
      if (!Result.isOk(createResult)) {
        throw new Error("Expected ok result");
      }
      const job = createResult.value;

      await updateJob(mockKV, job.id, {
        step_durations: { initialize: 245 },
      });

      const getResult = await getJob(mockKV, job.id);
      expect(Result.isOk(getResult)).toBe(true);
      if (!Result.isOk(getResult)) {
        throw new Error("Expected ok result");
      }
      const existingJob = getResult.value;

      const updateResult = await updateJob(mockKV, job.id, {
        step_durations: {
          ...existingJob?.step_durations,
          check_existing: 1820,
        },
      });

      expect(Result.isOk(updateResult)).toBe(true);
      if (!Result.isOk(updateResult)) {
        throw new Error("Expected ok result");
      }
      expect(updateResult.value.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });

    it("should track multiple step updates in sequence", async () => {
      const createResult = await createJob(mockKV, {
        idea: "Test idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(createResult)).toBe(true);
      if (!Result.isOk(createResult)) {
        throw new Error("Expected ok result");
      }
      const job = createResult.value;

      // Step 1: Initialize
      await updateJob(mockKV, job.id, {
        current_step: "initialize",
        current_step_label: "Initializing job...",
        steps_completed: 0,
        steps_total: 5,
        step_started_at: Date.now(),
      });

      // Step 2: Check existing
      const job1Result = await getJob(mockKV, job.id);
      expect(Result.isOk(job1Result)).toBe(true);
      if (!Result.isOk(job1Result)) {
        throw new Error("Expected ok result");
      }
      const job1 = job1Result.value;
      await updateJob(mockKV, job.id, {
        current_step: "check_existing",
        current_step_label: "Checking for existing research...",
        steps_completed: 1,
        step_started_at: Date.now(),
        step_durations: { ...job1?.step_durations, initialize: 245 },
      });

      // Step 3: Generate research
      const job2Result = await getJob(mockKV, job.id);
      expect(Result.isOk(job2Result)).toBe(true);
      if (!Result.isOk(job2Result)) {
        throw new Error("Expected ok result");
      }
      const job2 = job2Result.value;
      await updateJob(mockKV, job.id, {
        current_step: "generate_research",
        current_step_label: "Generating research with Claude...",
        steps_completed: 2,
        step_started_at: Date.now(),
        step_durations: { ...job2?.step_durations, check_existing: 1820 },
      });

      const finalResult = await getJob(mockKV, job.id);
      expect(Result.isOk(finalResult)).toBe(true);
      if (!Result.isOk(finalResult)) {
        throw new Error("Expected ok result");
      }
      const finalJob = finalResult.value;
      expect(finalJob?.current_step).toBe("generate_research");
      expect(finalJob?.steps_completed).toBe(2);
      expect(finalJob?.step_durations).toEqual({
        initialize: 245,
        check_existing: 1820,
      });
    });
  });

  describe("Continue From (Follow-up Explorations)", () => {
    it("should create a job with continue_from parameter", async () => {
      const result = await createJob(mockKV, {
        idea: "Follow-up idea",
        mode: "business",
        model: "sonnet",
        continue_from: "abc12345",
      });

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) {
        throw new Error("Expected ok result");
      }
      expect(result.value.continue_from).toBe("abc12345");
    });

    it("should create a job without continue_from when not provided", async () => {
      const result = await createJob(mockKV, {
        idea: "New idea",
        mode: "business",
        model: "sonnet",
      });

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) {
        throw new Error("Expected ok result");
      }
      expect(result.value.continue_from).toBeUndefined();
    });

    it("should accept continue_from in request schema", () => {
      const result = ExploreRequestSchema.safeParse({
        idea: "Test idea",
        continue_from: "job-id-12",
      });
      expect(result.success).toBe(true);
    });

    it("should reject when both update and continue_from are set", () => {
      const result = ExploreRequestSchema.safeParse({
        idea: "Test idea",
        update: true,
        continue_from: "job-id-12",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          "Cannot use both 'update' and 'continue_from' together"
        );
      }
    });

    it("should allow update without continue_from", () => {
      const result = ExploreRequestSchema.safeParse({
        idea: "Test idea",
        update: true,
      });
      expect(result.success).toBe(true);
    });

    it("should allow continue_from without update", () => {
      const result = ExploreRequestSchema.safeParse({
        idea: "Test idea",
        continue_from: "job-id-12",
      });
      expect(result.success).toBe(true);
    });

    it("should allow update: false with continue_from", () => {
      const result = ExploreRequestSchema.safeParse({
        idea: "Test idea",
        update: false,
        continue_from: "job-id-12",
      });
      expect(result.success).toBe(true);
    });
  });
});
