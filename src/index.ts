import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createJob,
  ExploreRequestSchema,
  getJob,
  type Job,
  JobStatusSchema,
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

interface EnumSchema {
  safeParse: (v: string) => { success: boolean };
  options: readonly string[];
}

function validateEnumFilter(
  value: string | undefined,
  schema: EnumSchema,
  fieldName: string
): { valid: true; value: string } | { valid: false; error: string } | null {
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
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 100;

  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number.parseInt(offsetParam ?? "", 10) || 0);

  return { limit, offset };
}

const app = new Hono<{ Bindings: ExploreEnv }>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

app.use("/api/*", requireAuth());

app.use("/api/*", async (c, next) => {
  if (c.env.RATE_LIMITER) {
    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    try {
      const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
    } catch (error) {
      console.error("Rate limiter error:", error);
      // Fail open if rate limiter errors
    }
  }
  await next();
});

app.get("/", (c) => {
  const docs = `
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
  return c.html(docs);
});

app.post(
  "/api/explore",
  zValidator("json", ExploreRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    const webhookUrl = body.webhook_url || c.env.IDEA_EXPLORER_WEBHOOK_URL;
    const job = await createJob(c.env.IDEA_EXPLORER_JOBS, {
      ...body,
      webhook_url: webhookUrl,
    });

    logJobCreated(job.id, job.idea, job.mode);

    try {
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
    } catch (error) {
      await updateJob(c.env.IDEA_EXPLORER_JOBS, job.id, {
        status: "failed",
        error: "Workflow creation failed",
      });
      logError("workflow_creation_failed", error, undefined, job.id);
      return c.json({ error: "Failed to start exploration" }, 500);
    }

    return c.json({ job_id: job.id, status: "pending" }, 202);
  }
);

interface JobMetadata {
  created_at: number;
  status: Job["status"];
  mode: Job["mode"];
}

app.get("/api/jobs", async (c) => {
  // Optimization: use KV metadata for filtering and sorting
  // to avoid fetching all job bodies.
  // We fetch bodies only for keys with missing metadata (legacy)
  // and for the final page of results.

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

  try {
    const { keys } = await c.env.IDEA_EXPLORER_JOBS.list<JobMetadata>();

    // Split keys into those with metadata (fast path) and those without (slow path)
    const keysWithMetadata = keys.filter((k) => k.metadata);
    const keysWithoutMetadata = keys.filter((k) => !k.metadata);

    // 1. Filter keys with metadata
    const filteredMetadataKeys = keysWithMetadata.filter((k) => {
      if (
        statusValidation?.valid &&
        k.metadata?.status !== statusValidation.value
      ) {
        return false;
      }
      if (modeValidation?.valid && k.metadata?.mode !== modeValidation.value) {
        return false;
      }
      return true;
    });

    // 2. Fetch and filter keys without metadata (legacy fallback)
    let fetchedLegacyJobs: Job[] = [];
    if (keysWithoutMetadata.length > 0) {
      const results = await Promise.allSettled(
        keysWithoutMetadata.map(
          (k) =>
            c.env.IDEA_EXPLORER_JOBS.get(k.name, "json") as Promise<Job | null>
        )
      );
      fetchedLegacyJobs = results
        .filter(
          (r): r is PromiseFulfilledResult<Job> =>
            r.status === "fulfilled" && r.value !== null
        )
        .map((r) => r.value)
        .filter((j) => {
          if (statusValidation?.valid && j.status !== statusValidation.value) {
            return false;
          }
          if (modeValidation?.valid && j.mode !== modeValidation.value) {
            return false;
          }
          return true;
        });
    }

    // 3. Combine and sort
    // We represent everything as a "Job item" which has the sorting key (created_at)
    // and potentially the full job if we already fetched it.
    type JobItem =
      | { type: "metadata"; key: string; created_at: number }
      | { type: "full"; job: Job; created_at: number };

    const items: JobItem[] = [
      ...filteredMetadataKeys.map((k) => ({
        type: "metadata" as const,
        key: k.name,
        created_at: k.metadata?.created_at ?? 0,
      })),
      ...fetchedLegacyJobs.map((j) => ({
        type: "full" as const,
        job: j,
        created_at: j.created_at,
      })),
    ];

    items.sort((a, b) => b.created_at - a.created_at);

    const paginatedItems = items.slice(offset, offset + limit);

    // 4. Fetch missing bodies for the current page
    const finalJobs = await Promise.all(
      paginatedItems.map(async (item) => {
        if (item.type === "full") {
          return item.job;
        }
        return (await c.env.IDEA_EXPLORER_JOBS.get(
          item.key,
          "json"
        )) as Job | null;
      })
    );

    const validFinalJobs = finalJobs.filter((j): j is Job => j !== null);

    return c.json({
      jobs: validFinalJobs,
      total: items.length,
      limit,
      offset,
    });
  } catch (error) {
    logError(
      "jobs_list_failed",
      error instanceof Error ? error : new Error(String(error))
    );
    return c.json({ error: "Failed to retrieve jobs from storage" }, 500);
  }
});

app.get("/api/status/:id", async (c) => {
  const jobId = c.req.param("id");
  const job = await getJob(c.env.IDEA_EXPLORER_JOBS, jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

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

  if (job.status === "running") {
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

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/test-webhook", requireAuth(), async (c) => {
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
    { "X-Test-Webhook": "true" }
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

// biome-ignore lint/performance/noBarrelFile: neededed for cloudflare
export { ExplorationWorkflow } from "./workflows/exploration";
