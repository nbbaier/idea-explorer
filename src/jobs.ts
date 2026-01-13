import { z } from "zod";

export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const ModeSchema = z.enum(["business", "exploration"]);
const ModelSchema = z.enum(["sonnet", "opus"]);

export const ExploreRequestSchema = z.object({
  idea: z.string(),
  webhook_url: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          const blockedHosts = [
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "169.254.169.254",
          ];
          const blockedPatterns = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
          ];

          if (blockedHosts.includes(parsed.hostname)) return false;
          if (blockedPatterns.some((p) => p.test(parsed.hostname)))
            return false;
          if (!["http:", "https:"].includes(parsed.protocol)) return false;
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid webhook URL" }
    )
    .optional(),
  mode: ModeSchema.optional(),
  model: ModelSchema.optional(),
  callback_secret: z.string().optional(),
  context: z.string().optional(),
  update: z.boolean().optional(),
});

const JobSchema = z.object({
  id: z.string(),
  idea: z.string(),
  mode: ModeSchema,
  model: ModelSchema,
  status: JobStatusSchema,
  webhook_url: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          const blockedHosts = [
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "169.254.169.254",
          ];
          const blockedPatterns = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
          ];

          if (blockedHosts.includes(parsed.hostname)) return false;
          if (blockedPatterns.some((p) => p.test(parsed.hostname)))
            return false;
          if (!["http:", "https:"].includes(parsed.protocol)) return false;
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid webhook URL" }
    )
    .optional(),
  callback_secret: z.string().optional(),
  context: z.string().optional(),
  update: z.boolean().optional(),
  github_url: z.string().optional(),
  error: z.string().optional(),
  created_at: z.number(),
  webhook_sent_at: z.number().optional(),
  current_step: z.string().optional(),
  current_step_label: z.string().optional(),
  steps_completed: z.number().optional(),
  steps_total: z.number().optional(),
  step_started_at: z.number().optional(),
  step_durations: z.record(z.string(), z.number()).optional(),
});

export type Mode = z.infer<typeof ModeSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ExploreRequest = z.infer<typeof ExploreRequestSchema>;
export type Job = z.infer<typeof JobSchema>;

export async function createJob(
  kv: KVNamespace,
  request: ExploreRequest
): Promise<Job> {
  const id = crypto.randomUUID().slice(0, 8);
  const job: Job = {
    id,
    idea: request.idea,
    mode: request.mode ?? "business",
    model: request.model ?? "sonnet",
    status: "pending",
    webhook_url: request.webhook_url,
    callback_secret: request.callback_secret,
    context: request.context,
    update: request.update ?? false,
    created_at: Date.now(),
  };
  await kv.put(id, JSON.stringify(job));
  return job;
}

export async function getJob(
  kv: KVNamespace,
  id: string
): Promise<Job | undefined> {
  const data = await kv.get(id);
  if (!data) {
    return;
  }
  try {
    const parsed = JSON.parse(data);
    return JobSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export async function updateJob(
  kv: KVNamespace,
  id: string,
  updates: Partial<Omit<Job, "id" | "created_at">>,
  existingJob?: Job
): Promise<Job | undefined> {
  const job = existingJob ?? (await getJob(kv, id));
  if (!job) {
    return;
  }
  const updated = { ...job, ...updates };
  await kv.put(id, JSON.stringify(updated));
  return updated;
}
