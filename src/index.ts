import { zValidator } from "@hono/zod-validator";
import { Result } from "better-result";
import { type Context, Hono, type Next } from "hono";
import { WorkflowCreationError, WorkflowNotFoundError } from "./errors";
import {
  createJob,
  type ExploreRequest,
  ExploreRequestSchema,
  getJob,
  type Job,
  JobStatusSchema,
  listJobs,
  ModeSchema,
  updateJob,
} from "./jobs";
import { requireAuth } from "./middleware/auth";
import { logError, logJobCreated } from "./utils/logger";
import { sendWebhook } from "./utils/webhook";

type ExploreEnv = Env & {
  IDEA_EXPLORER_WEBHOOK_URL?: string;
  IDEA_EXPLORER_JOBS: KVNamespace;
  RATE_LIMITER?: RateLimit;
};

type ExploreContext = Context<{ Bindings: ExploreEnv }>;

type EnumValidationResult =
  | { valid: true; value: string }
  | { valid: false; error: string };

interface EnumSchema {
  safeParse: (v: string) => { success: boolean };
  options: readonly string[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DOCS_HTML = `
<html>
  <body style="font-family: Arial, sans-serif; margin: 1.5rem; max-width: 36rem; line-height: 1.5;">
    <h2>Idea Explorer</h2>
    <p>
      A Cloudflare Worker that explores and analyzes ideas using Claude,
      committing research results to a GitHub repository.
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

function validateEnumFilter(
  value: string | undefined,
  schema: EnumSchema,
  fieldName: string
): EnumValidationResult | null {
  if (!value) {
    return null;
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      valid: false,
      error: `Invalid ${fieldName} value. Must be one of: ${schema.options.join(", ")}`,
    };
  }
  return { valid: true, value };
}

function parsePaginationParams(
  limitParam: string | undefined,
  offsetParam: string | undefined
): { limit: number; offset: number } {
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number.parseInt(offsetParam ?? "", 10) || 0);

  return { limit, offset };
}

function setSecurityHeaders(c: ExploreContext): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
}

async function securityHeadersMiddleware(
  c: ExploreContext,
  next: Next
): Promise<void> {
  await next();
  setSecurityHeaders(c);
}

async function rateLimitMiddleware(
  c: ExploreContext,
  next: Next
): Promise<Response | undefined> {
  const rateLimiter = c.env.RATE_LIMITER;
  if (!rateLimiter) {
    await next();
    return;
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  try {
    const { success } = await rateLimiter.limit({ key: ip });
    if (!success) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
  } catch (error) {
    logError("rate_limiter_error", error, { ip });
  }

  await next();
}

function renderDocs(c: ExploreContext): Response {
  return c.html(DOCS_HTML);
}

async function createExploreHandler(c: ExploreContext): Promise<Response> {
  const body = (await c.req.json()) as ExploreRequest;
  const webhookUrl = body.webhook_url || c.env.IDEA_EXPLORER_WEBHOOK_URL;

  const jobResult = await createJob(c.env.IDEA_EXPLORER_JOBS, {
    ...body,
    webhook_url: webhookUrl,
  });

  if (jobResult.status === "error") {
    logError("job_creation_failed", jobResult.error);
    return c.json({ error: "Failed to create job" }, 500);
  }

  const job = jobResult.value;
  logJobCreated(job.id, job.idea, job.mode);

  const workflowResult = await Result.tryPromise({
    try: () =>
      c.env.EXPLORATION_WORKFLOW.create({
        id: job.id,
        params: {
          jobId: job.id,
          idea: job.idea,
          mode: job.mode,
          model: job.model,
          context: job.context,
          update: job.update,
          collect_tool_stats: job.collect_tool_stats,
          webhook_url: job.webhook_url,
          callback_secret: job.callback_secret,
        },
      }),
    catch: (error) =>
      new WorkflowCreationError({ jobId: job.id, cause: error }),
  });

  if (workflowResult.status === "error") {
    await updateJob(c.env.IDEA_EXPLORER_JOBS, job.id, {
      status: "failed",
      error: "Workflow creation failed",
    });
    logError(
      "workflow_creation_failed",
      workflowResult.error,
      undefined,
      job.id
    );
    return c.json({ error: "Failed to start exploration" }, 500);
  }

  return c.json({ job_id: job.id, status: "pending" }, 202);
}

async function listJobsHandler(c: ExploreContext): Promise<Response> {
  const statusValidation = validateEnumFilter(
    c.req.query("status"),
    JobStatusSchema,
    "status"
  );
  if (statusValidation?.valid === false) {
    return c.json({ error: statusValidation.error }, 400);
  }

  const modeValidation = validateEnumFilter(
    c.req.query("mode"),
    ModeSchema,
    "mode"
  );
  if (modeValidation?.valid === false) {
    return c.json({ error: modeValidation.error }, 400);
  }

  const { limit, offset } = parsePaginationParams(
    c.req.query("limit"),
    c.req.query("offset")
  );

  const jobsResult = await listJobs(c.env.IDEA_EXPLORER_JOBS, {
    status: statusValidation?.valid ? statusValidation.value : undefined,
    mode: modeValidation?.valid ? modeValidation.value : undefined,
    limit,
    offset,
  });

  if (jobsResult.status === "error") {
    logError("jobs_list_failed", jobsResult.error);
    return c.json({ error: "Failed to retrieve jobs from storage" }, 500);
  }

  const { jobs, total } = jobsResult.value;

  return c.json({
    jobs,
    total,
    limit,
    offset,
  });
}

function addRunningStatusDetails(
  job: Job,
  response: Record<string, unknown>
): void {
  if (job.current_step) {
    response.current_step = job.current_step;
  }
  if (job.current_step_label) {
    response.current_step_label = job.current_step_label;
  }
  if (job.steps_completed !== undefined) {
    response.steps_completed = job.steps_completed;
  }
  if (job.steps_total !== undefined) {
    response.steps_total = job.steps_total;
  }
  if (job.step_started_at !== undefined) {
    response.step_started_at = job.step_started_at;
  }
  if (job.step_durations) {
    response.step_durations = job.step_durations;
  }
}

function buildStatusResponse(job: Job): Record<string, unknown> {
  const response: Record<string, unknown> = {
    status: job.status,
    idea: job.idea,
    mode: job.mode,
  };

  switch (job.status) {
    case "completed":
      if (job.github_url) {
        response.github_url = job.github_url;
      }
      break;
    case "failed":
      if (job.error) {
        response.error = job.error;
      }
      break;
    case "running":
      addRunningStatusDetails(job, response);
      break;
    default:
      break;
  }

  return response;
}

async function getJobStatusHandler(c: ExploreContext): Promise<Response> {
  const jobId = c.req.param("id");
  const jobResult = await getJob(c.env.IDEA_EXPLORER_JOBS, jobId);

  if (jobResult.status === "error") {
    logError("job_status_fetch_failed", jobResult.error, undefined, jobId);
    return c.json({ error: "Failed to retrieve job" }, 500);
  }

  const job = jobResult.value;
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(buildStatusResponse(job));
}

async function getWorkflowStatusHandler(c: ExploreContext): Promise<Response> {
  const jobId = c.req.param("id");
  const instanceResult = await Result.tryPromise({
    try: async () => {
      const instance = await c.env.EXPLORATION_WORKFLOW.get(jobId);
      return instance.status();
    },
    catch: () => new WorkflowNotFoundError({ jobId }),
  });

  if (instanceResult.status === "error") {
    return c.json({ error: instanceResult.error.message }, 404);
  }

  const status = instanceResult.value;
  return c.json({
    workflow_status: status.status,
    output: status.output,
    error: status.error,
  });
}

function healthHandler(c: ExploreContext): Response {
  return c.json({ status: "ok" });
}

function buildMockJob(params: {
  status: "completed" | "failed";
  webhookUrl: string;
  callbackSecret?: string;
  githubRepo: string;
}): Job {
  const job: Job = {
    id: `test-${crypto.randomUUID().slice(0, 8)}`,
    idea: "Test idea for webhook verification",
    mode: "business",
    model: "sonnet",
    status: params.status,
    webhook_url: params.webhookUrl,
    callback_secret: params.callbackSecret,
    created_at: Date.now(),
  };

  if (params.status === "completed") {
    job.github_url = `https://github.com/${params.githubRepo}/blob/main/ideas/2025-01-01-test-idea/research.md`;
  } else {
    job.error = "Test error message";
  }

  return job;
}

async function testWebhookHandler(c: ExploreContext): Promise<Response> {
  const webhookUrl =
    c.req.query("webhook_url") || c.env.IDEA_EXPLORER_WEBHOOK_URL;
  const status = c.req.query("status") === "failed" ? "failed" : "completed";
  const callbackSecret = c.req.query("callback_secret");

  if (!webhookUrl) {
    return c.json(
      {
        error:
          "webhook_url query parameter or IDEA_EXPLORER_WEBHOOK_URL env var required",
      },
      400
    );
  }

  const mockJob = buildMockJob({
    status,
    webhookUrl,
    callbackSecret,
    githubRepo: c.env.GITHUB_REPO,
  });

  const webhookResult = await sendWebhook(
    mockJob,
    c.env.GITHUB_REPO,
    c.env.GITHUB_BRANCH || "main",
    { "X-Test-Webhook": "true" }
  );

  if (webhookResult.status === "error") {
    return c.json({
      message: "Mock webhook failed",
      webhook_url: webhookUrl,
      status,
      error: webhookResult.error.message,
    });
  }

  return c.json({
    message: "Mock webhook sent",
    webhook_url: webhookUrl,
    status,
    result: webhookResult.value,
  });
}

function notFoundHandler(c: ExploreContext): Response {
  return c.json({ error: "Not found" }, 404);
}

const app = new Hono<{ Bindings: ExploreEnv }>();

app.use("*", securityHeadersMiddleware);

app.use("/api/*", requireAuth());

app.use("/api/*", rateLimitMiddleware);

app.get("/", renderDocs);

app.post(
  "/api/explore",
  zValidator("json", ExploreRequestSchema),
  createExploreHandler
);

app.get("/api/jobs", listJobsHandler);

app.get("/api/status/:id", getJobStatusHandler);

app.get("/api/workflow-status/:id", getWorkflowStatusHandler);

app.get("/api/health", healthHandler);

app.get("/api/test-webhook", requireAuth(), testWebhookHandler);

app.all("*", notFoundHandler);

export default app;

// biome-ignore lint/performance/noBarrelFile: neededed for cloudflare
export { ExplorationWorkflow } from "./workflows/exploration";
