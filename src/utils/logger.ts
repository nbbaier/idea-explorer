export interface LogData {
  [key: string]: unknown;
}

function log(level: 'info' | 'error', jobId: string, event: string, data?: LogData): void {
  console.log(JSON.stringify({
    level,
    job_id: jobId,
    event,
    ...data,
    timestamp: new Date().toISOString(),
  }));
}

export function logJobCreated(jobId: string, idea: string, mode: string): void {
  log('info', jobId, 'job_created', { idea, mode });
}

export function logContainerStarted(jobId: string): void {
  log('info', jobId, 'container_started');
}

export function logCloneComplete(jobId: string, durationMs: number): void {
  log('info', jobId, 'clone_complete', { duration_ms: durationMs });
}

export function logClaudeStarted(jobId: string, model: string): void {
  log('info', jobId, 'claude_started', { model });
}

export function logCommitPushed(jobId: string): void {
  log('info', jobId, 'commit_pushed');
}

export function logWebhookSent(jobId: string, statusCode: number, attempt: number): void {
  log('info', jobId, 'webhook_sent', { status_code: statusCode, attempt });
}

export function logJobComplete(jobId: string, status: string, totalDurationMs: number): void {
  log('info', jobId, 'job_complete', { status, total_duration_ms: totalDurationMs });
}

export function logError(jobId: string, operation: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  log('error', jobId, operation, { error: errorMessage });
}

export function logInfo(jobId: string, event: string, data?: LogData): void {
  log('info', jobId, event, data);
}
