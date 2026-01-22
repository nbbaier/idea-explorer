import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import { type ExploreRequest, ModelSchema, ModeSchema } from "@/types/api";
import { ApiClient, AuthError } from "../lib/api.js";
import {
  getApiKey,
  getApiUrl,
  getDefaultMode,
  getDefaultModel,
} from "../lib/config.js";
import {
  type OutputMode,
  outputError,
  outputSubmitSuccess,
} from "../lib/output.js";
import { runSubmitWizard } from "../prompts/submit.js";

interface SubmitOptions {
  mode?: string;
  model?: string;
  context?: string;
  update?: boolean;
  debug?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

function getOutputMode(options: SubmitOptions): OutputMode {
  if (options.quiet) {
    return "quiet";
  }
  if (options.json) {
    return "json";
  }
  return "default";
}

function hasStdin(): boolean {
  return !process.stdin.isTTY;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    process.stdin.on("error", reject);
  });
}

function readContextFile(contextArg: string): string {
  if (existsSync(contextArg)) {
    return readFileSync(contextArg, "utf-8");
  }
  return contextArg;
}

function validateMode(
  mode: string | undefined
): "business" | "exploration" | undefined {
  if (!mode) {
    return undefined;
  }
  const result = ModeSchema.safeParse(mode);
  if (!result.success) {
    throw new Error(
      `Invalid mode: ${mode}. Must be 'business' or 'exploration'`
    );
  }
  return result.data;
}

function validateModel(
  model: string | undefined
): "sonnet" | "opus" | undefined {
  if (!model) {
    return undefined;
  }
  const result = ModelSchema.safeParse(model);
  if (!result.success) {
    throw new Error(`Invalid model: ${model}. Must be 'sonnet' or 'opus'`);
  }
  return result.data;
}

async function submitAction(options: SubmitOptions): Promise<void> {
  const outputMode = getOutputMode(options);
  const verbose = options.verbose ?? options.debug ?? false;

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

    const validatedMode = validateMode(options.mode);
    const validatedModel = validateModel(options.model);

    let idea: string | undefined;
    let mode = validatedMode;
    let model = validatedModel;
    let context = options.context
      ? readContextFile(options.context)
      : undefined;

    if (hasStdin()) {
      idea = await readStdin();
      if (!idea) {
        throw new Error("No idea provided via stdin");
      }
    } else {
      const defaultMode = getDefaultMode() as
        | "business"
        | "exploration"
        | undefined;
      const defaultModel = getDefaultModel() as "sonnet" | "opus" | undefined;

      const result = await runSubmitWizard({
        skipIdea: false,
        skipMode: !!mode,
        skipModel: !!model,
        defaultMode,
        defaultModel,
      });

      if (!result) {
        process.exit(1);
      }

      idea = result.idea;
      mode = mode ?? result.mode;
      model = model ?? result.model;
      context = context ?? result.context;
    }

    const request: ExploreRequest = {
      idea,
      mode,
      model,
      context,
      update: options.update,
      collect_tool_stats: options.debug,
    };

    const client = new ApiClient({ baseUrl: apiUrl, apiKey });
    const response = await client.submitIdea(request);

    outputSubmitSuccess(response.job_id, { mode: outputMode, verbose });
  } catch (error) {
    outputError(error, { mode: outputMode, verbose });
    process.exit(1);
  }
}

export function createSubmitCommand(): Command {
  return new Command("submit")
    .description("Submit an idea for exploration")
    .option("--mode <mode>", "Exploration mode (business, exploration)")
    .option("--model <model>", "Model to use (sonnet, opus)")
    .option("--context <text>", "Additional context (string or file path)")
    .option("--update", "Update an existing idea rather than create new")
    .option(
      "--debug",
      "Enable debug mode (collect_tool_stats + verbose errors)"
    )
    .option("--json", "Output as JSON")
    .option("--quiet", "Only output job ID")
    .option("--verbose", "Show detailed errors")
    .action(submitAction);
}
