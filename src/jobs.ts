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
	update?: boolean;
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
	update?: boolean;
	github_url?: string;
	error?: string;
	created_at: number;
}

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
