import { Sandbox } from "@cloudflare/sandbox";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	createJob,
	ExploreModeSchema,
	ExploreRequestSchema,
	getJob,
	type Job,
	JobStatusSchema,
} from "./jobs";
import { requireAuth } from "./middleware/auth";
import { logJobCreated } from "./utils/logger";
import { sendWebhook } from "./utils/webhook";

type ExploreEnv = Env & {
	WEBHOOK_URL?: string;
	IDEA_EXPLORER_JOBS: KVNamespace;
};

const app = new Hono<{ Bindings: ExploreEnv }>();

app.use("/api/*", requireAuth());

app.post(
	"/api/explore",
	zValidator("json", ExploreRequestSchema),
	async (c) => {
		const body = c.req.valid("json");

		const webhookUrl = body.webhook_url || c.env.WEBHOOK_URL;

		const job = await createJob(c.env.IDEA_EXPLORER_JOBS, {
			...body,
			webhook_url: webhookUrl,
		});

		logJobCreated(job.id, job.idea, job.mode);

		await c.env.EXPLORATION_WORKFLOW.create({
			id: job.id,
			params: {
				jobId: job.id,
				idea: job.idea,
				mode: job.mode,
				model: job.model,
				context: job.context,
				update: job.update,
				webhook_url: job.webhook_url,
				callback_secret: job.callback_secret,
			},
		});

		return c.json({ job_id: job.id, status: "pending" }, 202);
	},
);

app.get("/api/jobs", async (c) => {
	// Note: This implementation loads all jobs into memory for filtering.
	// For personal use scale (dozens to hundreds of explorations), this is acceptable.
	// If scaling beyond personal use, consider using KV metadata for filtering
	// or migrating to a database with proper indexing.
	let jobs: (Job | null)[];
	try {
		const { keys } = await c.env.IDEA_EXPLORER_JOBS.list();
		jobs = await Promise.all(
			keys.map((k) => c.env.IDEA_EXPLORER_JOBS.get(k.name, "json")),
		);
	} catch {
		return c.json({ error: "Failed to retrieve jobs from storage" }, 500);
	}

	// Apply filters
	let filtered = jobs.filter((j) => j != null) as Job[];

	const statusFilter = c.req.query("status");
	if (statusFilter) {
		const statusValidation = JobStatusSchema.safeParse(statusFilter);
		if (!statusValidation.success) {
			return c.json(
				{
					error: `Invalid status value. Must be one of: ${JobStatusSchema.options.join(", ")}`,
				},
				400,
			);
		}
		filtered = filtered.filter((j) => j.status === statusFilter);
	}

	const modeFilter = c.req.query("mode");
	if (modeFilter) {
		const modeValidation = ExploreModeSchema.safeParse(modeFilter);
		if (!modeValidation.success) {
			return c.json(
				{
					error: `Invalid mode value. Must be one of: ${ExploreModeSchema.options.join(", ")}`,
				},
				400,
			);
		}
		filtered = filtered.filter((j) => j.mode === modeFilter);
	}

	// Sort by created_at descending
	filtered.sort((a, b) => b.created_at - a.created_at);

	// Paginate
	const limitParam = c.req.query("limit") || "20";
	const offsetParam = c.req.query("offset") || "0";

	const limit = Math.max(
		1,
		Math.min(100, Number.parseInt(limitParam, 10) || 20),
	);
	const offset = Math.max(0, Number.parseInt(offsetParam, 10) || 0);

	return c.json({
		jobs: filtered.slice(offset, offset + limit),
		total: filtered.length,
		limit,
		offset,
	});
});

app.get("/api/status/:id", async (c) => {
	const jobId = c.req.param("id");
	const job = await getJob(c.env.IDEA_EXPLORER_JOBS, jobId);

	if (!job) return c.json({ error: "Job not found" }, 404);

	const response: Record<string, unknown> = {
		status: job.status,
		idea: job.idea,
		mode: job.mode,
	};

	if (job.status === "completed" && job.github_url) {
		response.github_url = job.github_url;
	}

	if (job.status === "failed" && job.error) {
		response.error = job.error;
	}

	// Include step progress information when job is running
	if (job.status === "running") {
		if (job.current_step) response.current_step = job.current_step;
		if (job.current_step_label)
			response.current_step_label = job.current_step_label;
		if (job.steps_completed !== undefined)
			response.steps_completed = job.steps_completed;
		if (job.steps_total !== undefined) response.steps_total = job.steps_total;
		if (job.step_started_at !== undefined)
			response.step_started_at = job.step_started_at;
		if (job.step_durations) response.step_durations = job.step_durations;
	}

	return c.json(response);
});

app.get("/api/workflow-status/:id", async (c) => {
	const jobId = c.req.param("id");
	try {
		const instance = await c.env.EXPLORATION_WORKFLOW.get(jobId);
		const status = await instance.status();
		return c.json({
			workflow_status: status.status,
			output: status.output,
			error: status.error,
		});
	} catch {
		return c.json({ error: "Workflow instance not found" }, 404);
	}
});

app.get("/", async (c) => {
	const docs = `
<html>
  <body style="font-family: Arial, sans-serif; margin: 1.5rem; max-width: 36rem; line-height: 1.5;">
    <h2>Idea Explorer</h2>
    <p>
      A Cloudflare Container-based service that runs autonomous Claude Code
      sessions to explore and analyze ideas, committing results to a GitHub
      repository.
    </p>
    <h3>API</h3>
    <p>POST /api/explore</p>
    <p>GET /api/jobs</p>
    <p>GET /api/status/:id</p>
    <p>GET /api/health</p>
    <p>GET /api/test-webhook</p>
    <h3>Documentation</h3>
    <a href="https://github.com/nbbaier/idea-explorer/blob/main/SPEC.md" target="_blank">https://github.com/nbbaier/idea-explorer/blob/main/SPEC.md</a>
  </body>
</html>
   `;
	return c.html(docs);
});

app.get("/api/health", async (c) => {
	return c.json({ status: "ok" });
});

app.get("/api/test-webhook", async (c) => {
	const webhookUrl = c.req.query("webhook_url") || c.env.WEBHOOK_URL;
	const status = c.req.query("status") === "failed" ? "failed" : "completed";
	const callbackSecret = c.req.query("callback_secret");

	if (!webhookUrl) {
		return c.json(
			{ error: "webhook_url query parameter or WEBHOOK_URL env var required" },
			400,
		);
	}

	const mockJob: Job = {
		id: `test-${crypto.randomUUID().slice(0, 8)}`,
		idea: "Test idea for webhook verification",
		mode: "business",
		model: "sonnet",
		status,
		webhook_url: webhookUrl,
		callback_secret: callbackSecret,
		created_at: Date.now(),
		...(status === "completed"
			? {
					github_url: `https://github.com/${c.env.GITHUB_REPO}/blob/main/ideas/2025-01-01-test-idea/research.md`,
				}
			: { error: "Test error message" }),
	};

	const result = await sendWebhook(
		mockJob,
		c.env.GITHUB_REPO,
		c.env.GITHUB_BRANCH || "main",
		{ "X-Test-Webhook": "true" },
	);

	return c.json({
		message: "Mock webhook sent",
		webhook_url: webhookUrl,
		status,
		result,
	});
});

app.all("*", (c) => c.json({ error: "Not found" }, 404));

export default app;
export { Sandbox };
export { ExplorationWorkflow } from "./workflows/exploration";
