import { z } from "zod";

export const ModeSchema = z.enum(["business", "exploration"]);
export const ModelSchema = z.enum(["sonnet", "opus"]);
export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const ExploreRequestSchema = z
  .object({
    idea: z.string(),
    mode: ModeSchema.optional(),
    model: ModelSchema.optional(),
    context: z.string().optional(),
    update: z.boolean().optional(),
    collect_tool_stats: z.boolean().optional(),
    continue_from: z.string().optional(),
  })
  .refine(
    (data) => !(data.update === true && data.continue_from !== undefined),
    {
      message:
        "Cannot use both 'update' and 'continue_from' together. Use 'update' to append to existing research of the same idea, or 'continue_from' to build upon a previous exploration.",
    }
  );

export const JobStatusResponseSchema = z.object({
  status: JobStatusSchema,
  idea: z.string(),
  mode: ModeSchema,
  github_url: z.string().optional(),
  error: z.string().optional(),
  current_step: z.string().optional(),
  current_step_label: z.string().optional(),
  steps_completed: z.number().optional(),
  steps_total: z.number().optional(),
  step_started_at: z.number().optional(),
  step_durations: z.record(z.string(), z.number()).optional(),
  continue_from: z.string().optional(),
});

export const ExploreResponseSchema = z.object({
  job_id: z.string(),
  status: z.literal("pending"),
});

export type Mode = z.infer<typeof ModeSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ExploreRequest = z.infer<typeof ExploreRequestSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type ExploreResponse = z.infer<typeof ExploreResponseSchema>;
