import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock crypto.subtle.timingSafeEqual for Node.js test environment
beforeAll(() => {
	if (!crypto.subtle.timingSafeEqual) {
		crypto.subtle.timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
			if (a.byteLength !== b.byteLength) return false;
			const aView = new Uint8Array(a);
			const bView = new Uint8Array(b);
			let result = 0;
			for (let i = 0; i < aView.length; i++) {
				result |= aView[i] ^ bView[i];
			}
			return result === 0;
		};
	}
});

// Mock the Sandbox import
vi.mock("@cloudflare/sandbox", () => ({
	Sandbox: class MockSandbox {},
}));

// Mock the workflows
vi.mock("./workflows/exploration", () => ({
	ExplorationWorkflow: class MockWorkflow {},
}));

// Import after mocking
const { default: app } = await import("./index");

type JobsResponse = {
	jobs: unknown[];
	total: number;
	limit: number;
	offset: number;
};

type ErrorResponse = {
	error: string;
};

describe("GET /api/jobs", () => {
	// Mock KV namespace
	const createMockKV = (jobs: Record<string, string>) => {
		return {
			list: async () => ({
				keys: Object.keys(jobs).map((name) => ({ name })),
			}),
			get: async (key: string, type?: string) => {
				const value = jobs[key];
				if (!value) return null;
				if (type === "json") return JSON.parse(value);
				return value;
			},
		} as unknown as KVNamespace;
	};

	const createMockEnv = (jobs: Record<string, string>) => ({
		API_BEARER_TOKEN: "test-token",
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
				(j: unknown) => (j as { status: string }).status === "completed",
			),
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
				(j: unknown) => (j as { mode: string }).mode === "business",
			),
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
			},
		);

		const res = await app.fetch(req, env);
		const data = (await res.json()) as JobsResponse;

		expect(res.status).toBe(200);
		expect(data.total).toBe(12); // 12 completed jobs out of 25
		expect(data.jobs.length).toBe(5);
		expect(
			data.jobs.every(
				(j: unknown) => (j as { status: string }).status === "completed",
			),
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
});
