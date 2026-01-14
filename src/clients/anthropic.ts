import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicConfig {
  apiKey: string;
  model: "sonnet" | "opus";
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

export interface GenerateResearchResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

const MODEL_MAP = {
  sonnet: "claude-sonnet-4-5-20250929",
  opus: "claude-opus-4-5-20251101",
} as const;

const MAX_OUTPUT_TOKENS = 16_384;

type AnthropicInstance = InstanceType<typeof Anthropic>;

export class AnthropicClient {
  private readonly client: AnthropicInstance;
  private readonly model: string;

  constructor(config: AnthropicConfig, client?: unknown) {
    this.client =
      (client as AnthropicInstance) ?? new Anthropic({ apiKey: config.apiKey });
    this.model = MODEL_MAP[config.model];
  }

  async generateResearch(
    params: GenerateResearchParams
  ): Promise<GenerateResearchResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
    });

    const message = await stream.finalMessage();

    const textBlock = message.content.find((block) => block.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    return {
      content,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }
}
