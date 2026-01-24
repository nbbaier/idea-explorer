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
  let storage: Map<string, string>;
  let metadataStorage: Map<string, unknown>;

  beforeEach(() => {
    storage = new Map<string, string>();
    metadataStorage = new Map<string, unknown>();
    mockKV = {
      get: vi.fn((key: string, type?: string) => {
        const value = storage.get(key) || null;
        if (value && type === "json") {
          return Promise.resolve(JSON.parse(value));
        }
        return Promise.resolve(value);
      }),
      put: vi.fn(
        (key: string, value: string, options?: { metadata?: unknown }) => {
          storage.set(key, value);
          if (options?.metadata) {
            metadataStorage.set(key, options.metadata);
          }
          return Promise.resolve();
        }
      ),
      list: vi.fn(() => {
        const keys: { name: string; metadata: unknown }[] = [];
        for (const key of storage.keys()) {
          keys.push({ name: key, metadata: metadataStorage.get(key) });
        }
        return Promise.resolve({ keys, list_complete: true });
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

  describe("Job Listing", () => {
    it("should list jobs correctly with pagination and filtering", async () => {
      // Create 5 jobs
      const jobs: Job[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await createJob(mockKV, {
          idea: `Idea ${i}`,
          mode: i % 2 === 0 ? "business" : "exploration",
        });
        if (Result.isOk(result)) {
          jobs.push(result.value);
          // Add a small delay to ensure different created_at
          await new Promise((resolve) => setTimeout(resolve, 10));
          // Update status for some
          if (i === 0) {
            await updateJob(mockKV, result.value.id, { status: "completed" });
          }
        }
      }

      // Test listing all
      const listAll = await listJobs(mockKV);
      expect(Result.isOk(listAll)).toBe(true);
      if (Result.isOk(listAll)) {
        expect(listAll.value.total).toBe(5);
        expect(listAll.value.jobs).toHaveLength(5);
        // Verify sort order (descending created_at)
        expect(listAll.value.jobs[0].idea).toBe("Idea 4");
      }

      // Test filtering by mode
      const listBusiness = await listJobs(mockKV, { mode: "business" });
      expect(Result.isOk(listBusiness)).toBe(true);
      if (Result.isOk(listBusiness)) {
        expect(listBusiness.value.total).toBe(3); // 0, 2, 4
        expect(
          listBusiness.value.jobs.every((j) => j.mode === "business")
        ).toBe(true);
      }

      // Test filtering by status
      const listCompleted = await listJobs(mockKV, { status: "completed" });
      expect(Result.isOk(listCompleted)).toBe(true);
      if (Result.isOk(listCompleted)) {
        expect(listCompleted.value.total).toBe(1);
        expect(listCompleted.value.jobs[0].idea).toBe("Idea 0");
      }

      // Test pagination
      const page1 = await listJobs(mockKV, { limit: 2, offset: 0 });
      expect(Result.isOk(page1)).toBe(true);
      if (Result.isOk(page1)) {
        expect(page1.value.total).toBe(5);
        expect(page1.value.jobs).toHaveLength(2);
        expect(page1.value.jobs[0].idea).toBe("Idea 4");
        expect(page1.value.jobs[1].idea).toBe("Idea 3");
      }

      const page2 = await listJobs(mockKV, { limit: 2, offset: 2 });
      expect(Result.isOk(page2)).toBe(true);
      if (Result.isOk(page2)) {
        expect(page2.value.total).toBe(5);
        expect(page2.value.jobs).toHaveLength(2);
        expect(page2.value.jobs[0].idea).toBe("Idea 2");
      }
    });

    it("should use metadata to avoid fetching bodies for filtered out items", async () => {
      // Mock get to spy on it
      const spyGet = vi.spyOn(mockKV, "get");

      // Create jobs
      await createJob(mockKV, { idea: "Job 1", mode: "business" });
      await createJob(mockKV, { idea: "Job 2", mode: "exploration" });
      await createJob(mockKV, { idea: "Job 3", mode: "business" });

      spyGet.mockClear();

      // List with filter
      const result = await listJobs(mockKV, { mode: "exploration" });

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value.total).toBe(1);
        expect(result.value.jobs[0].idea).toBe("Job 2");
      }

      // We expect get to be called ONLY for the job that matched the filter (Job 2)
      // keys.map in listJobs does NOT call get if metadata is present.
      // Then page.map calls get for the result items.
      expect(spyGet).toHaveBeenCalledTimes(1);
    });

    it("should fallback to fetching body if metadata is missing", async () => {
      // Manually put a job without metadata
      const id = "legacy-job";
      const legacyJob = {
        id,
        idea: "Legacy Job",
        mode: "business",
        model: "sonnet",
        status: "pending",
        created_at: Date.now(),
      };
      storage.set(id, JSON.stringify(legacyJob));

      // Mock get to spy on it
      const spyGet = vi.spyOn(mockKV, "get");

      const result = await listJobs(mockKV);

      expect(Result.isOk(result)).toBe(true);
      if (Result.isOk(result)) {
        expect(result.value.total).toBe(1);
        expect(result.value.jobs[0].id).toBe(id);
      }

      // Expected calls:
      // 1. In keys.map, metadata is missing, so it calls get(id) to build summary.
      // 2. In page.map, it might call get(id) again OR use the loaded job.
      // My implementation re-fetches or uses the loaded job if I passed it.
      // Let's check implementation:
      // return { ... _job: job };
      // ... if ('_job' in s) return s._job
      // So it should NOT call get again.

      // So expect 1 call.
      expect(spyGet).toHaveBeenCalledTimes(1);
    });
  });
});
