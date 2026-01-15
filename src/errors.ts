import { TaggedError } from "better-result";

// ============================================================================
// GitHub Errors
// ============================================================================

export class GitHubNotFoundError extends TaggedError("GitHubNotFoundError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `GitHub resource not found: ${args.path}` });
  }
}

export class GitHubConflictError extends TaggedError("GitHubConflictError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `GitHub conflict on path: ${args.path}` });
  }
}

export class GitHubApiError extends TaggedError("GitHubApiError")<{
  operation: string;
  status?: number;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { operation: string; status?: number; cause: unknown }) {
    const statusInfo = args.status ? ` (status: ${args.status})` : "";
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `GitHub ${args.operation} failed${statusInfo}: ${causeMsg}`,
    });
  }
}

export class GitHubConfigError extends TaggedError("GitHubConfigError")<{
  repo: string;
  message: string;
}>() {
  constructor(args: { repo: string }) {
    super({
      ...args,
      message: `Invalid repo format: "${args.repo}". Expected "owner/repo"`,
    });
  }
}

// ============================================================================
// Anthropic Errors
// ============================================================================

export class AnthropicApiError extends TaggedError("AnthropicApiError")<{
  operation: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { operation: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Anthropic ${args.operation} failed: ${causeMsg}`,
    });
  }
}

// ============================================================================
// Storage/KV Errors
// ============================================================================

export class StorageError extends TaggedError("StorageError")<{
  operation: string;
  key?: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { operation: string; key?: string; cause: unknown }) {
    const keyInfo = args.key ? ` (key: ${args.key})` : "";
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Storage ${args.operation} failed${keyInfo}: ${causeMsg}`,
    });
  }
}

export class JobNotFoundError extends TaggedError("JobNotFoundError")<{
  jobId: string;
  message: string;
}>() {
  constructor(args: { jobId: string }) {
    super({ ...args, message: `Job not found: ${args.jobId}` });
  }
}

export class JsonParseError extends TaggedError("JsonParseError")<{
  context: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { context: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `JSON parse failed (${args.context}): ${causeMsg}`,
    });
  }
}

// ============================================================================
// Webhook Errors
// ============================================================================

export class WebhookDeliveryError extends TaggedError("WebhookDeliveryError")<{
  url: string;
  attempts: number;
  lastStatus?: number;
  message: string;
}>() {
  constructor(args: { url: string; attempts: number; lastStatus?: number }) {
    const statusInfo = args.lastStatus
      ? ` (last status: ${args.lastStatus})`
      : "";
    super({
      ...args,
      message: `Webhook delivery failed after ${args.attempts} attempts${statusInfo}`,
    });
  }
}

// ============================================================================
// Workflow Errors
// ============================================================================

export class WorkflowCreationError extends TaggedError(
  "WorkflowCreationError"
)<{
  jobId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { jobId: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Workflow creation failed for job ${args.jobId}: ${causeMsg}`,
    });
  }
}

export class WorkflowNotFoundError extends TaggedError(
  "WorkflowNotFoundError"
)<{
  jobId: string;
  message: string;
}>() {
  constructor(args: { jobId: string }) {
    super({ ...args, message: `Workflow instance not found: ${args.jobId}` });
  }
}

// ============================================================================
// Error Unions
// ============================================================================

export type GitHubError =
  | GitHubNotFoundError
  | GitHubConflictError
  | GitHubApiError
  | GitHubConfigError;

export type StorageErrorType = StorageError | JobNotFoundError | JsonParseError;

export class WorkflowStepError extends TaggedError("WorkflowStepError")<{
  step: string;
  message: string;
  cause?: unknown;
}>() {
  constructor(args: { step: string; message: string; cause?: unknown }) {
    let causeMsg = "";
    if (args.cause !== undefined) {
      causeMsg =
        args.cause instanceof Error ? args.cause.message : String(args.cause);
    }
    const causeInfo = causeMsg ? `: ${causeMsg}` : "";
    super({ ...args, message: `${args.message}${causeInfo}` });
  }
}

export class ExplorationLogParseError extends TaggedError(
  "ExplorationLogParseError"
)<{
  jobId: string;
  logPath: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { jobId: string; logPath: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Failed to parse exploration log at ${args.logPath}: ${causeMsg}`,
    });
  }
}

export class ExplorationLogUpdateError extends TaggedError(
  "ExplorationLogUpdateError"
)<{
  jobId: string;
  logPath: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { jobId: string; logPath: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Failed to update exploration log at ${args.logPath}: ${causeMsg}`,
    });
  }
}

export class WorkflowFailureError extends TaggedError("WorkflowFailureError")<{
  jobId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { jobId: string; cause: unknown }) {
    const causeMsg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Workflow failed for job ${args.jobId}: ${causeMsg}`,
    });
  }
}

export type ApiError =
  | GitHubError
  | AnthropicApiError
  | StorageErrorType
  | WebhookDeliveryError
  | WorkflowCreationError
  | WorkflowStepError
  | ExplorationLogParseError
  | ExplorationLogUpdateError
  | WorkflowFailureError;
