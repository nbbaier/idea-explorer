// biome-ignore lint/style/noExportedImports: needed for cloudflare
import { Sandbox } from "@cloudflare/sandbox";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createJob,
  ExploreModeSchema,
  ExploreRequestSchema,
  getJob,
  type Job,
  type JobMetadata,
  JobStatusSchema,
} from "./jobs";
import { requireAuth } from "./middleware/auth";
import { logJobCreated } from "./utils/logger";
import { sendWebhook } from "./utils/webhook";

type ExploreEnv = Env & {
  WEBHOOK_URL?: string;
  IDEA_EXPLORER_JOBS: KVNamespace;
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
  }
);

app.get("/api/jobs", async (c) => {
  // Optimization: Use KV metadata for filtering and sorting to avoid fetching full job bodies
  // for every item. Falls back to fetching body if metadata is missing (backward compatibility).

  try {
    const { keys } = await c.env.IDEA_EXPLORER_JOBS.list<{
      metadata: JobMetadata;
    }>();

    // Map keys to an intermediate structure containing metadata (or fetched body if needed)
    const allItems = await Promise.all(
      keys.map(async (k) => {
        // If we have metadata, use it
        if (k.metadata) {
          return {
            id: k.name,
            status: (k.metadata as JobMetadata).status,
            mode: (k.metadata as JobMetadata).mode,
            created_at: (k.metadata as JobMetadata).created_at,
            _fullJob: null as Job | null,
          };
        }

        // Fallback: fetch the full job to get metadata fields
        const job = (await c.env.IDEA_EXPLORER_JOBS.get(
          k.name,
          "json"
        )) as Job | null;
        if (!job) {
          return null;
        }

        return {
          id: job.id,
          status: job.status,
          mode: job.mode,
          created_at: job.created_at,
          _fullJob: job,
        };
      })
    );

    // Filter out any nulls (failed fetches)
    let items = allItems.filter(
      (item): item is NonNullable<typeof item> => item !== null
    );

    // Apply filtering on the metadata/extracted data
    const statusValidation = validateEnumFilter(
      c.req.query("status"),
      JobStatusSchema,
      "status"
    );
    if (statusValidation?.valid === false) {
      return c.json({ error: statusValidation.error }, 400);
    }
    if (statusValidation?.valid) {
      items = items.filter((i) => i.status === statusValidation.value);
    }

    const modeValidation = validateEnumFilter(
      c.req.query("mode"),
      ExploreModeSchema,
      "mode"
    );
    if (modeValidation?.valid === false) {
      return c.json({ error: modeValidation.error }, 400);
    }
    if (modeValidation?.valid) {
      items = items.filter((i) => i.mode === modeValidation.value);
    }

    // Sort in memory (using metadata fields)
    items.sort((a, b) => b.created_at - a.created_at);

    // Pagination
    const { limit, offset } = parsePaginationParams(
      c.req.query("limit"),
      c.req.query("offset")
    );

    const slicedItems = items.slice(offset, offset + limit);

    // Hydrate: Fetch full job bodies for the sliced results (if not already fetched)
    const jobs = await Promise.all(
      slicedItems.map(async (item) => {
        if (item._fullJob) {
          return item._fullJob;
        }
        return (await c.env.IDEA_EXPLORER_JOBS.get(
          item.id,
          "json"
        )) as Job | null;
      })
    );

    // Final filter for validity
    const finalJobs = jobs.filter((j): j is Job => j !== null);

    return c.json({
      jobs: finalJobs,
      total: items.length,
      limit,
      offset,
    });
  } catch (e) {
    console.error("Error retrieving jobs:", e);
    return c.json({ error: "Failed to retrieve jobs from storage" }, 500);
  }
});

app.get("/api/status/:id", async (c) => {
  const jobId = c.req.param("id");
  const job = await getJob(c.env.IDEA_EXPLORER_JOBS, jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const baseResponse = {
    status: job.status,
    idea: job.idea,
    mode: job.mode,
  };

  if (job.status === "completed") {
    return c.json({
      ...baseResponse,
      ...(job.github_url && { github_url: job.github_url }),
    });
  }

  if (job.status === "failed") {
    return c.json({
      ...baseResponse,
      ...(job.error && { error: job.error }),
    });
  }

  if (job.status === "running") {
    return c.json({
      ...baseResponse,
      ...(job.current_step && { current_step: job.current_step }),
      ...(job.current_step_label && {
        current_step_label: job.current_step_label,
      }),
      ...(job.steps_completed !== undefined && {
        steps_completed: job.steps_completed,
      }),
      ...(job.steps_total !== undefined && { steps_total: job.steps_total }),
      ...(job.step_started_at !== undefined && {
        step_started_at: job.step_started_at,
      }),
      ...(job.step_durations && { step_durations: job.step_durations }),
    });
  }

  return c.json(baseResponse);
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

app.get("/", (c) => {
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

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/test-webhook", async (c) => {
  const webhookUrl = c.req.query("webhook_url") || c.env.WEBHOOK_URL;
  const status = c.req.query("status") === "failed" ? "failed" : "completed";
  const callbackSecret = c.req.query("callback_secret");

  if (!webhookUrl) {
    return c.json(
      { error: "webhook_url query parameter or WEBHOOK_URL env var required" },
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
export { Sandbox };
// biome-ignore lint/performance/noBarrelFile: needed for cloudflare
export { ExplorationWorkflow } from "./workflows/exploration";
