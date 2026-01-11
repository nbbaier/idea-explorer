export interface LogData {
	[key: string]: unknown;
}

function log(
	level: "info" | "error" | "warn",
	event: string,
	data?: LogData,
	jobId?: string,
): void {
	const logEntry: Record<string, unknown> = {
		level,
		event,
		...data,
		timestamp: new Date().toISOString(),
	};
	if (jobId) {
		logEntry.job_id = jobId;
	}
	console.log(JSON.stringify(logEntry));
}

export function logJobCreated(jobId: string, idea: string, mode: string): void {
	log("info", "job_created", { idea, mode }, jobId);
}

export function logContainerStarted(jobId: string): void {
	log("info", "container_started", undefined, jobId);
}

export function logCloneComplete(jobId: string, durationMs: number): void {
	log("info", "clone_complete", { duration_ms: durationMs }, jobId);
}

export function logClaudeStarted(jobId: string, model: string): void {
	log("info", "claude_started", { model }, jobId);
}

export function logCommitPushed(jobId: string): void {
	log("info", "commit_pushed", undefined, jobId);
}

export function logWebhookSent(
	jobId: string,
	statusCode: number,
	attempt: number,
): void {
	log("info", "webhook_sent", { status_code: statusCode, attempt }, jobId);
}

export function logJobComplete(
	jobId: string,
	status: string,
	totalDurationMs: number,
): void {
	log(
		"info",
		"job_complete",
		{
			status,
			total_duration_ms: totalDurationMs,
		},
		jobId,
	);
}

export function logError(
	operation: string,
	error: unknown,
	data?: LogData,
	jobId?: string,
): void {
	const errorMessage = error instanceof Error ? error.message : String(error);
	log("error", operation, { error: errorMessage, ...data }, jobId);
}

export function logInfo(event: string, data?: LogData, jobId?: string): void {
	log("info", event, data, jobId);
}

export function logWarn(event: string, data?: LogData, jobId?: string): void {
	log("warn", event, data, jobId);
}
