export type JobStatus = "pending" | "running" | "completed" | "failed";
export type ExploreMode = "business" | "exploration";
export type ModelType = "sonnet" | "opus";

export interface ExploreRequest {
	idea: string;
	webhook_url?: string;
	mode?: ExploreMode;
	model?: ModelType;
	callback_secret?: string;
	context?: string;
}

export interface Job {
	id: string;
	idea: string;
	mode: ExploreMode;
	model: ModelType;
	status: JobStatus;
	webhook_url?: string;
	callback_secret?: string;
	context?: string;
	github_url?: string;
	error?: string;
	created_at: number;
}

const jobs = new Map<string, Job>();

export function createJob(request: ExploreRequest): Job {
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
		created_at: Date.now(),
	};
	jobs.set(id, job);
	return job;
}

export function getJob(id: string): Job | undefined {
	return jobs.get(id);
}

export function updateJob(
	id: string,
	updates: Partial<Omit<Job, "id" | "created_at">>,
): Job | undefined {
	const job = jobs.get(id);
	if (!job) return undefined;
	const updated = { ...job, ...updates };
	jobs.set(id, updated);
	return updated;
}
