import { cancel, confirm, intro, isCancel, select, text } from "@clack/prompts";
import type { Mode, Model } from "../types.js";

export interface SubmitPromptResult {
  idea: string;
  mode?: Mode;
  model?: Model;
  context?: string;
}

export interface SubmitPromptOptions {
  skipIdea?: boolean;
  skipMode?: boolean;
  skipModel?: boolean;
  defaultMode?: Mode;
  defaultModel?: Model;
}

function handleCancel(): null {
  cancel("Operation cancelled");
  return null;
}

async function promptForIdea(): Promise<string | null> {
  const idea = await text({
    message: "What's your idea?",
    placeholder: "Describe your idea...",
    validate: (value) => {
      if (!value.trim()) {
        return "Idea is required";
      }
    },
  });

  if (isCancel(idea)) {
    return handleCancel();
  }

  return idea;
}

async function promptForMode(
  defaultMode?: Mode
): Promise<Mode | "skip" | null> {
  const mode = await select({
    message: "Select exploration mode",
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
        value: "skip" as const,
        label: "Skip",
        hint: defaultMode ? `Use default (${defaultMode})` : "Use API default",
      },
    ],
  });

  if (isCancel(mode)) {
    return handleCancel();
  }

  return mode;
}

async function promptForModel(
  defaultModel?: Model
): Promise<Model | "skip" | null> {
  const model = await select({
    message: "Select model",
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
        value: "skip" as const,
        label: "Skip",
        hint: defaultModel
          ? `Use default (${defaultModel})`
          : "Use API default",
      },
    ],
  });

  if (isCancel(model)) {
    return handleCancel();
  }

  return model;
}

async function promptForContext(): Promise<string | null | undefined> {
  const addContext = await confirm({
    message: "Add additional context?",
    initialValue: false,
  });

  if (isCancel(addContext)) {
    return handleCancel();
  }

  if (!addContext) {
    return undefined;
  }

  const context = await text({
    message: "Enter additional context",
    placeholder: "Background information, constraints, etc...",
  });

  if (isCancel(context)) {
    return handleCancel();
  }

  return context.trim() || undefined;
}

export async function runSubmitWizard(
  options: SubmitPromptOptions = {}
): Promise<SubmitPromptResult | null> {
  intro("Submit an idea for exploration");

  const result: SubmitPromptResult = {
    idea: "",
  };

  if (!options.skipIdea) {
    const idea = await promptForIdea();
    if (idea === null) {
      return null;
    }
    result.idea = idea;
  }

  if (!options.skipMode) {
    const mode = await promptForMode(options.defaultMode);
    if (mode === null) {
      return null;
    }
    if (mode !== "skip") {
      result.mode = mode;
    }
  }

  if (!options.skipModel) {
    const model = await promptForModel(options.defaultModel);
    if (model === null) {
      return null;
    }
    if (model !== "skip") {
      result.model = model;
    }
  }

  const context = await promptForContext();
  if (context === null) {
    return null;
  }
  if (context) {
    result.context = context;
  }

  return result;
}
