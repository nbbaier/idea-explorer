import { z } from "zod";

export const JobStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);
export const ExploreModeSchema = z.enum(["business", "exploration"]);
export const ModelTypeSchema = z.enum(["sonnet", "opus"]);

export const ExploreRequestSchema = z.object({
	idea: z.string(),
	webhook_url: z.string().optional(),
	mode: ExploreModeSchema.optional(),
	model: ModelTypeSchema.optional(),
	callback_secret: z.string().optional(),
	context: z.string().optional(),
	update: z.boolean().optional(),
});

export const JobSchema = z.object({
	id: z.string(),
	idea: z.string(),
	mode: ExploreModeSchema,
	model: ModelTypeSchema,
	status: JobStatusSchema,
	webhook_url: z.string().optional(),
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

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type ExploreMode = z.infer<typeof ExploreModeSchema>;
export type ModelType = z.infer<typeof ModelTypeSchema>;

export type ExploreRequest = z.infer<typeof ExploreRequestSchema>;
export type Job = z.infer<typeof JobSchema>;

export async function createJob(
	kv: KVNamespace,
	request: ExploreRequest,
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
	id: string,
): Promise<Job | undefined> {
	const data = await kv.get(id);
	if (!data) return undefined;
	return JSON.parse(data) as Job;
}

export async function updateJob(
	kv: KVNamespace,
	id: string,
	updates: Partial<Omit<Job, "id" | "created_at">>,
): Promise<Job | undefined> {
	const job = await getJob(kv, id);
	if (!job) return undefined;
	const updated = { ...job, ...updates };
	await kv.put(id, JSON.stringify(updated));
	return updated;
}
