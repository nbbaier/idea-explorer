import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJob,
  ExploreRequestSchema,
  getJob,
  listJobs,
  updateJob,
} from "./jobs";

describe("Job Management", () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    const storage = new Map<string, { value: string; metadata?: unknown }>();
    mockKV = {
      get: vi.fn(
        (key: string, type?: "text" | "json" | "arrayBuffer" | "stream") => {
          const item = storage.get(key);
          if (!item) {
            return Promise.resolve(null);
          }

          if (type === "json") {
            return Promise.resolve(JSON.parse(item.value));
          }
          return Promise.resolve(item.value);
        }
      ),
      put: vi.fn(
        (key: string, value: string, options?: { metadata?: unknown }) => {
          storage.set(key, { value, metadata: options?.metadata });
          return Promise.resolve();
        }
      ),
      list: vi.fn(() => {
        const keys = Array.from(storage.entries()).map(([name, item]) => ({
          name,
          metadata: item.metadata,
        }));
        return Promise.resolve({ keys });
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

  describe("Metadata Optimization", () => {
    it("should use metadata for filtering to avoid N+1 fetches", async () => {
      // Create a few jobs
      await createJob(mockKV, {
        idea: "Idea 1",
        mode: "business",
        model: "sonnet",
      });
      await createJob(mockKV, {
        idea: "Idea 2",
        mode: "exploration",
        model: "sonnet",
      });
      await createJob(mockKV, {
        idea: "Idea 3",
        mode: "business",
        model: "sonnet",
      });

      // Reset the spy on kv.get to clear calls from createJob
      vi.clearAllMocks();

      // List jobs filtering by "exploration"
      // This should only fetch the body for Idea 2
      const result = await listJobs(mockKV, { mode: "exploration" });

      if (!Result.isOk(result)) {
        throw new Error("Expected ok result");
      }

      expect(result.value.jobs).toHaveLength(1);
      expect(result.value.jobs[0].idea).toBe("Idea 2");

      // Verify kv.get was called ONLY once (for the matching job)
      // The other two should be filtered out by metadata without fetching
      expect(mockKV.get).toHaveBeenCalledTimes(1);
    });

    it("should fallback to fetching body if metadata is missing", async () => {
      // 1. Manually insert a job WITHOUT metadata (simulating old data)
      await mockKV.put(
        "old-job",
        JSON.stringify({
          id: "old-job",
          idea: "Old Idea",
          mode: "business",
          model: "sonnet",
          status: "pending",
          created_at: Date.now(),
        })
      );

      // 2. Create a new job WITH metadata
      await createJob(mockKV, {
        idea: "New Idea",
        mode: "business",
        model: "sonnet",
      });

      vi.clearAllMocks();

      // 3. List jobs
      const result = await listJobs(mockKV);
      if (!Result.isOk(result)) {
        throw new Error("Expected ok result");
      }

      expect(result.value.jobs).toHaveLength(2);

      // Verify kv.get was called:
      // - Once for "old-job" (because metadata was missing)
      // - Once for "New Idea" (to get the full body for the response)
      expect(mockKV.get).toHaveBeenCalledTimes(2);
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
});
