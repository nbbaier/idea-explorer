import { type AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, type ToolSet, tool } from "ai";
import { Result } from "better-result";
import { z } from "zod";
import { AnthropicApiError } from "../errors";
import type { ToolExecutor } from "./tool-executor";

export interface AnthropicConfig {
  apiKey: string;
  model: "sonnet" | "opus";
  toolExecutor?: ToolExecutor;
  collectToolStats?: boolean;
}

export interface GenerateResearchParams {
  idea: string;
  mode: "business" | "exploration";
  context?: string;
  existingContent?: string;
  datePrefix: string;
  jobId: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface ToolCallLog {
  name: "read_research";
  path: string;
  durationMs: number;
  ok: boolean;
  bytes?: number;
  errorType?: string;
}

export interface GenerateResearchResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  toolCalls?: ToolCallLog[];
}

const MODEL_MAP = {
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-5",
} as const;

const MAX_OUTPUT_TOKENS = 16_384;
const MAX_STEPS = 5;

function buildTools(
  provider: AnthropicProvider,
  toolExecutor?: ToolExecutor,
  onToolCall?: (log: ToolCallLog) => void
): ToolSet {
  const tools: ToolSet = {
    web_search: provider.tools.webSearch_20250305({ maxUses: 5 }),
  };

  if (toolExecutor) {
    tools.read_research = tool({
      description:
        "Read an existing research document from the repository. Path is relative to ideas/ directory.",
      inputSchema: z.object({
        path: z.string().min(1).max(200),
      }),
      execute: async ({ path }: { path: string }) => {
        const startTime = Date.now();
        const result = await toolExecutor.readResearch(path);
        const durationMs = Date.now() - startTime;

        const logEntry: ToolCallLog = {
          name: "read_research",
          path,
          durationMs,
          ok: result.ok,
          bytes: result.ok ? result.bytes : undefined,
          errorType: result.ok ? undefined : result.error_type,
        };

        console.log("tool_call", logEntry);
        onToolCall?.(logEntry);

        return result;
      },
    });
  }

  return tools;
}

export class AnthropicClient {
  private readonly config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = config;
  }

  generateResearch(
    params: GenerateResearchParams
  ): Promise<Result<GenerateResearchResult, AnthropicApiError>> {
    return Result.tryPromise({
      try: async () => {
        const toolCalls: ToolCallLog[] | undefined = this.config
          .collectToolStats
          ? []
          : undefined;
        const provider = createAnthropic({ apiKey: this.config.apiKey });
        const tools = buildTools(provider, this.config.toolExecutor, (log) => {
          if (toolCalls) {
            toolCalls.push(log);
          }
        });
        const result = await generateText({
          model: provider(MODEL_MAP[this.config.model]),
          system: params.systemPrompt,
          prompt: params.userPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
        });

        return {
          content: result.text,
          inputTokens: result.totalUsage.inputTokens ?? 0,
          outputTokens: result.totalUsage.outputTokens ?? 0,
          steps: result.steps.length,
          toolCalls,
        };
      },
      catch: (error) =>
        new AnthropicApiError({ operation: "generateResearch", cause: error }),
    });
  }
}
