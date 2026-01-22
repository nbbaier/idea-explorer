import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import { Command } from "commander";
import {
  type Config,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "../lib/config.js";
import type { Mode, Model } from "../types.js";

const DEFAULT_API_URL = "https://idea-explorer.example.workers.dev";

async function initAction(): Promise<void> {
  intro("Welcome to Idea Explorer CLI setup");

  const existingConfig = loadConfig();

  const apiUrl = await text({
    message: "API URL",
    placeholder: DEFAULT_API_URL,
    initialValue: existingConfig.api_url ?? DEFAULT_API_URL,
    validate: (value) => {
      if (!value.trim()) {
        return "API URL is required";
      }
      try {
        new URL(value);
      } catch {
        return "Invalid URL format";
      }
    },
  });

  if (isCancel(apiUrl)) {
    cancel("Setup cancelled");
    process.exit(1);
  }

  const modeResult = await select({
    message: "Default exploration mode",
    options: [
      {
        value: "business" as const,
        label: "Business",
        hint: "Focus on practical business applications",
      },
      {
        value: "exploration" as const,
        label: "Exploration",
        hint: "Deep dive into the idea's possibilities",
      },
      {
        value: "none" as const,
        label: "No default",
        hint: "Always ask or use API default",
      },
    ],
  });

  if (isCancel(modeResult)) {
    cancel("Setup cancelled");
    process.exit(1);
  }

  const modelResult = await select({
    message: "Default model",
    options: [
      {
        value: "sonnet" as const,
        label: "Sonnet",
        hint: "Balanced speed and quality",
      },
      {
        value: "opus" as const,
        label: "Opus",
        hint: "Highest quality, slower",
      },
      {
        value: "none" as const,
        label: "No default",
        hint: "Always ask or use API default",
      },
    ],
  });

  if (isCancel(modelResult)) {
    cancel("Setup cancelled");
    process.exit(1);
  }

  const defaultMode: Mode | undefined =
    modeResult === "none" ? undefined : modeResult;
  const defaultModel: Model | undefined =
    modelResult === "none" ? undefined : modelResult;

  const config: Config = {
    api_url: apiUrl,
    default_mode: defaultMode,
    default_model: defaultModel,
  };

  try {
    saveConfig(config);
  } catch (error) {
    cancel(
      `Failed to save config: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  note(
    "Set the IDEA_EXPLORER_API_KEY environment variable:\n\n  export IDEA_EXPLORER_API_KEY=your-api-key",
    "Authentication"
  );

  outro(`Config saved to ${getConfigPath()}`);
}

export function createInitCommand(): Command {
  return new Command("init").description("Setup wizard").action(initAction);
}
