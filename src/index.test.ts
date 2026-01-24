import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Job } from "./jobs";

// Mock crypto.subtle.timingSafeEqual for Node.js test environment
beforeAll(() => {
  if (!crypto.subtle.timingSafeEqual) {
    crypto.subtle.timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
      if (a.byteLength !== b.byteLength) {
        return false;
      }
      const aView = new Uint8Array(a);
      const bView = new Uint8Array(b);
      let result = 0;
      for (let i = 0; i < aView.length; i++) {
        const aByte = aView[i] ?? 0;
        const bByte = bView[i] ?? 0;
        // biome-ignore lint/suspicious/noBitwiseOperators: timing-safe comparison requires bitwise ops
        result |= aByte ^ bByte;
      }
      return result === 0;
    };
  }
});

// Mock the workflows
vi.mock("./workflows/exploration", () => ({
  ExplorationWorkflow: class MockWorkflow {},
}));

// Import after mocking
const { default: app } = await import("./index");

interface JobsResponse {
  jobs: unknown[];
  total: number;
  limit: number;
  offset: number;
}

interface ErrorResponse {
  error: string;
}

interface KVOptions {
  metadata?: unknown;
}

describe("GET /api/jobs", () => {
  // Mock KV namespace
  const createMockKV = (jobs: Record<string, string>) => {
    // We store metadata in a separate map to simulate KV behavior
    const metadataStore: Record<string, unknown> = {};

    // Initialize metadata for existing jobs if possible (lazy migration simulation)
    // But for tests we can just leave it empty and let the fallback mechanism work,
    // OR we can pre-populate it for some tests if we want to test metadata path.
    // The current tests just pass JSON strings.

    return {
      list: async <T>() => {
        // In real KV, list returns keys sorted by name (lexicographically)
        // We'll just return them as is from Object.keys
        // If we want to test metadata optimization, we should populate metadataStore.

        const keys = Object.keys(jobs).map((name) => ({
          name,
          metadata: metadataStore[name] as T | undefined,
        }));
        return { keys };
      },
      get: (key: string, type?: string): Promise<string | null | Job> => {
        const value = jobs[key];
        if (!value) {
          return Promise.resolve(null);
        }
        if (type === "json") {
          return Promise.resolve(JSON.parse(value));
        }
        return Promise.resolve(value);
      },
      put: async (key: string, value: string, options?: KVOptions) => {
        jobs[key] = value;
        if (options?.metadata) {
          metadataStore[key] = options.metadata;
        }
        return Promise.resolve();
      },
    } as unknown as KVNamespace;
  };

  const createMockEnv = (jobs: Record<string, string>) => ({
    IDEA_EXPLORER_API_TOKEN: "test-token",
    IDEA_EXPLORER_JOBS: createMockKV(jobs),
    GITHUB_REPO: "test/repo",
    GITHUB_BRANCH: "main",
  });

  it("should return empty list when no jobs exist", async () => {
    const env = createMockEnv({});

    const req = new Request("http://localhost/api/jobs", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data).toEqual({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it("should return all jobs sorted by created_at descending", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
      job2: JSON.stringify({
        id: "job2",
        idea: "Second idea",
        mode: "exploration",
        model: "opus",
        status: "pending",
        created_at: 2000,
      }),
      job3: JSON.stringify({
        id: "job3",
        idea: "Third idea",
        mode: "business",
        model: "sonnet",
        status: "failed",
        created_at: 1500,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.total).toBe(3);
    expect(data.jobs.length).toBe(3);
    expect((data.jobs[0] as { id: string }).id).toBe("job2"); // newest first
    expect((data.jobs[1] as { id: string }).id).toBe("job3");
    expect((data.jobs[2] as { id: string }).id).toBe("job1");
  });

  it("should filter jobs by status", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
      job2: JSON.stringify({
        id: "job2",
        idea: "Second idea",
        mode: "exploration",
        model: "opus",
        status: "pending",
        created_at: 2000,
      }),
      job3: JSON.stringify({
        id: "job3",
        idea: "Third idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1500,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?status=completed", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.total).toBe(2);
    expect(data.jobs.length).toBe(2);
    expect(
      data.jobs.every(
        (j: unknown) => (j as { status: string }).status === "completed"
      )
    ).toBe(true);
  });

  it("should filter jobs by mode", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
      job2: JSON.stringify({
        id: "job2",
        idea: "Second idea",
        mode: "exploration",
        model: "opus",
        status: "pending",
        created_at: 2000,
      }),
      job3: JSON.stringify({
        id: "job3",
        idea: "Third idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1500,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?mode=business", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.total).toBe(2);
    expect(data.jobs.length).toBe(2);
    expect(
      data.jobs.every(
        (j: unknown) => (j as { mode: string }).mode === "business"
      )
    ).toBe(true);
  });

  it("should paginate results with limit and offset", async () => {
    const jobs: Record<string, string> = {};
    for (let i = 1; i <= 25; i++) {
      jobs[`job${i}`] = JSON.stringify({
        id: `job${i}`,
        idea: `Idea ${i}`,
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: i * 1000,
      });
    }

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?limit=10&offset=5", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.total).toBe(25);
    expect(data.jobs.length).toBe(10);
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(5);
  });

  it("should combine status filter and pagination", async () => {
    const jobs: Record<string, string> = {};
    for (let i = 1; i <= 25; i++) {
      jobs[`job${i}`] = JSON.stringify({
        id: `job${i}`,
        idea: `Idea ${i}`,
        mode: "business",
        model: "sonnet",
        status: i % 2 === 0 ? "completed" : "pending",
        created_at: i * 1000,
      });
    }

    const env = createMockEnv(jobs);

    const req = new Request(
      "http://localhost/api/jobs?status=completed&limit=5&offset=2",
      {
        headers: { Authorization: "Bearer test-token" },
      }
    );

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.total).toBe(12); // 12 completed jobs out of 25
    expect(data.jobs.length).toBe(5);
    expect(
      data.jobs.every(
        (j: unknown) => (j as { status: string }).status === "completed"
      )
    ).toBe(true);
  });

  it("should require authentication", async () => {
    const env = createMockEnv({});

    const req = new Request("http://localhost/api/jobs");

    const res = await app.fetch(req, env);
    const data = (await res.json()) as ErrorResponse;

    expect(res.status).toBe(401);
    expect(data.error).toContain("Unauthorized");
  });

  it("should use default pagination values", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.limit).toBe(20);
    expect(data.offset).toBe(0);
  });

  it("should validate and clamp limit to max 100", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?limit=500", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.limit).toBe(100); // clamped to max
  });

  it("should handle negative offset and limit values", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?limit=-10&offset=-5", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.limit).toBe(1); // minimum value
    expect(data.offset).toBe(0); // clamped to 0
  });

  it("should handle invalid pagination parameters", async () => {
    const jobs = {
      job1: JSON.stringify({
        id: "job1",
        idea: "First idea",
        mode: "business",
        model: "sonnet",
        status: "completed",
        created_at: 1000,
      }),
    };

    const env = createMockEnv(jobs);

    const req = new Request("http://localhost/api/jobs?limit=abc&offset=xyz", {
      headers: { Authorization: "Bearer test-token" },
    });

    const res = await app.fetch(req, env);
    const data = (await res.json()) as JobsResponse;

    expect(res.status).toBe(200);
    expect(data.limit).toBe(20); // default on invalid
    expect(data.offset).toBe(0); // default on invalid
  });
});
