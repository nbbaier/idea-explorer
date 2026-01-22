import { cancel, outro } from "@clack/prompts";
import { ApiError, AuthError, NetworkError, ValidationError } from "./api.js";

export type OutputMode = "default" | "json" | "quiet";

export interface OutputOptions {
  mode: OutputMode;
  verbose: boolean;
}

function formatStatusBadge(status: string): string {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

export function outputSubmitSuccess(
  jobId: string,
  options: OutputOptions
): void {
  if (options.mode === "quiet") {
    console.log(jobId);
    return;
  }

  if (options.mode === "json") {
    console.log(JSON.stringify({ job_id: jobId, status: "pending" }));
    return;
  }

  outro(`Job submitted successfully!\n   Job ID: ${jobId}`);
}

export function outputJobStatus(
  status: {
    status: string;
    idea: string;
    mode: string;
    github_url?: string;
    error?: string;
    current_step?: string;
    current_step_label?: string;
    steps_completed?: number;
    steps_total?: number;
  },
  options: OutputOptions
): void {
  if (options.mode === "json") {
    console.log(JSON.stringify(status));
    return;
  }

  const lines: string[] = [
    `Status: ${formatStatusBadge(status.status)}`,
    `Idea: ${status.idea}`,
    `Mode: ${status.mode}`,
  ];

  if (status.status === "running") {
    if (status.current_step_label) {
      lines.push(`Current step: ${status.current_step_label}`);
    }
    if (
      status.steps_completed !== undefined &&
      status.steps_total !== undefined
    ) {
      lines.push(`Progress: ${status.steps_completed}/${status.steps_total}`);
    }
  }

  if (status.status === "completed" && status.github_url) {
    lines.push(`GitHub: ${status.github_url}`);
  }

  if (status.status === "failed" && status.error) {
    lines.push(`Error: ${status.error}`);
  }

  console.log(lines.join("\n"));
}

export function outputError(error: unknown, options: OutputOptions): void {
  const errorInfo = formatError(error, options.verbose);

  if (options.mode === "json") {
    console.error(
      JSON.stringify({ error: errorInfo.message, details: errorInfo.details })
    );
    return;
  }

  cancel(errorInfo.message);
  if (errorInfo.details && options.verbose) {
    console.error(`\nDetails: ${errorInfo.details}`);
  }
}

function formatError(
  error: unknown,
  verbose: boolean
): { message: string; details?: string } {
  if (error instanceof AuthError) {
    return {
      message:
        "Authentication failed. Set the IDEA_EXPLORER_API_KEY environment variable.",
      details: verbose ? error.message : undefined,
    };
  }

  if (error instanceof NetworkError) {
    return {
      message: "Network error. Check your internet connection and try again.",
      details: verbose ? String(error.cause) : undefined,
    };
  }

  if (error instanceof ValidationError) {
    return {
      message: `Validation error: ${error.message}`,
      details: error.field ? `Field: ${error.field}` : undefined,
    };
  }

  if (error instanceof ApiError) {
    return {
      message: `API error: ${error.message}`,
      details: verbose
        ? `Status: ${error.statusCode}, Body: ${error.responseBody}`
        : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      details: verbose ? error.stack : undefined,
    };
  }

  return {
    message: String(error),
  };
}

export function outputConfigList(config: Record<string, unknown>): void {
  const entries = Object.entries(config);
  if (entries.length === 0) {
    console.log("No configuration values set.");
    return;
  }

  for (const [key, value] of entries) {
    console.log(`${key}=${value}`);
  }
}

export function outputConfigValue(
  key: string,
  value: string | undefined
): void {
  if (value === undefined) {
    console.log(`${key} is not set`);
  } else {
    console.log(value);
  }
}
