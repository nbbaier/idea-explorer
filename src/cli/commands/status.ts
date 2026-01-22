import { Command } from "commander";
import { ApiClient, AuthError } from "../lib/api.js";
import { getApiKey, getApiUrl } from "../lib/config.js";
import {
  type OutputMode,
  outputError,
  outputJobStatus,
} from "../lib/output.js";

interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
}

function getOutputMode(options: StatusOptions): OutputMode {
  if (options.json) {
    return "json";
  }
  return "default";
}

async function statusAction(
  jobId: string,
  options: StatusOptions
): Promise<void> {
  const outputMode = getOutputMode(options);
  const verbose = options.verbose ?? false;

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new AuthError(
        "IDEA_EXPLORER_API_KEY environment variable is not set"
      );
    }

    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error(
        "API URL not configured. Run 'idea init' or set IDEA_EXPLORER_URL"
      );
    }

    const client = new ApiClient({ baseUrl: apiUrl, apiKey });
    const status = await client.getJobStatus(jobId);

    outputJobStatus(status, { mode: outputMode, verbose });
  } catch (error) {
    outputError(error, { mode: outputMode, verbose });
    process.exit(1);
  }
}

export function createStatusCommand(): Command {
  return new Command("status")
    .description("Check job status")
    .argument("<job-id>", "The job ID to check")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show detailed errors")
    .action(statusAction);
}
