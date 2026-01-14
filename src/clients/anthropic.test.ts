import { describe, expect, it, vi } from "vitest";
import { AnthropicClient } from "./anthropic";

function createMockAnthropicClient(overrides: {
  stream?: ReturnType<typeof vi.fn>;
}) {
  return {
    messages: {
      stream: overrides.stream ?? vi.fn(),
    },
  };
}

function createMockStream(text: string, inputTokens = 100, outputTokens = 500) {
  return {
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: "text", text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
  };
}

describe("AnthropicClient", () => {
  const defaultParams = {
    idea: "Test idea",
    mode: "business" as const,
    datePrefix: "2025-01-12",
    jobId: "test-job-123",
    systemPrompt: "You are analyzing an idea",
    userPrompt: "Analyze this: Test idea",
  };

  it("should initialize with sonnet model", async () => {
    const mockStream = createMockStream("Response");
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue(mockStream),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "sonnet" },
      mockClient
    );
    await client.generateResearch(defaultParams);

    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250929",
      })
    );
  });

  it("should initialize with opus model", async () => {
    const mockStream = createMockStream("Response");
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue(mockStream),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "opus" },
      mockClient
    );
    await client.generateResearch(defaultParams);

    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-5-20251101",
      })
    );
  });

  it("should pass system and user prompts correctly", async () => {
    const mockStream = createMockStream("Response");
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue(mockStream),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "sonnet" },
      mockClient
    );
    await client.generateResearch({
      ...defaultParams,
      systemPrompt: "Custom system",
      userPrompt: "Custom user",
    });

    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "Custom system",
        messages: [{ role: "user", content: "Custom user" }],
      })
    );
  });

  it("should set max_tokens to 16384", async () => {
    const mockStream = createMockStream("Response");
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue(mockStream),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "sonnet" },
      mockClient
    );
    await client.generateResearch(defaultParams);

    expect(mockClient.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 16_384,
      })
    );
  });

  it("should return content and token counts", async () => {
    const mockStream = createMockStream("# Research\n\nContent", 150, 800);
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue(mockStream),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "sonnet" },
      mockClient
    );
    const result = await client.generateResearch(defaultParams);

    expect(result.content).toBe("# Research\n\nContent");
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(800);
  });

  it("should handle empty content blocks", async () => {
    const mockClient = createMockAnthropicClient({
      stream: vi.fn().mockReturnValue({
        finalMessage: vi.fn().mockResolvedValue({
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
      }),
    });

    const client = new AnthropicClient(
      { apiKey: "key", model: "sonnet" },
      mockClient
    );
    const result = await client.generateResearch(defaultParams);

    expect(result.content).toBe("");
  });
});
