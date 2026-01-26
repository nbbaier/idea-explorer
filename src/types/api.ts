import { z } from "zod";

export const ModeSchema = z.enum(["business", "exploration"]);
export const ModelSchema = z.enum(["sonnet", "opus"]);
export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

// Request schema for explore endpoint
// Validation: 'update' and 'continue_from' are mutually exclusive
// - 'update': Appends to existing research for the same idea (same slug)
// - 'continue_from': Builds upon a previous exploration (different idea)
// When both are set, there's a conflict:
//   - Prompt shows only previousResearchContent (continue_from) due to else-if
//   - File write still appends to existingContent (update)
// This creates a mismatch where Claude doesn't see what it's appending to
export const ExploreRequestBaseSchema = z.object({
  idea: z.string(),
  mode: ModeSchema.optional(),
  model: ModelSchema.optional(),
  context: z.string().optional(),
  update: z.boolean().optional(),
  collect_tool_stats: z.boolean().optional(),
  continue_from: z.string().optional(),
});

export const ExploreRequestSchema = ExploreRequestBaseSchema.refine(
  (data) => !(data.update && data.continue_from != null),
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
