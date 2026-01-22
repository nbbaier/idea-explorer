import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient } from "./anthropic";
import type { ToolExecutor } from "./tool-executor";

const {
  mockCreateAnthropic,
  mockGenerateText,
  mockProvider,
  mockStepCountIs,
  mockTool,
  mockWebSearch,
} = vi.hoisted(() => {
  const webSearch = vi.fn();
  const provider = Object.assign(vi.fn(), {
    tools: { webSearch_20250305: webSearch },
  });
  return {
    mockCreateAnthropic: vi.fn(),
    mockGenerateText: vi.fn(),
    mockProvider: provider,
    mockStepCountIs: vi.fn(),
    mockTool: vi.fn(),
    mockWebSearch: webSearch,
  };
});

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  stepCountIs: mockStepCountIs,
  tool: mockTool,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mockCreateAnthropic,
}));

describe("AnthropicClient", () => {
  const defaultParams = {
    idea: "Test idea",
    mode: "business" as const,
    datePrefix: "2025-01-12",
    jobId: "test-job-123",
    systemPrompt: "You are analyzing an idea",
    userPrompt: "Analyze this: Test idea",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSearch.mockReturnValue("web_search_tool");
    mockTool.mockImplementation((config) => config);
    mockStepCountIs.mockImplementation((steps) => ({ type: "steps", steps }));
    mockProvider.mockReturnValue("anthropic_model");
    mockCreateAnthropic.mockReturnValue(mockProvider);
    mockGenerateText.mockResolvedValue({
      text: "Result",
      totalUsage: { inputTokens: 10, outputTokens: 20 },
      steps: [],
    });
  });

  it("registers web_search tool always", async () => {
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    await client.generateResearch(defaultParams);

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "key" });
    expect(mockProvider).toHaveBeenCalledWith("claude-sonnet-4-5");
    const options = mockGenerateText.mock.calls[0]?.[0];
    expect(options.tools.web_search).toBe("web_search_tool");
    expect(options.tools.read_research).toBeUndefined();
  });

  it("uses the opus model when configured", async () => {
    const client = new AnthropicClient({ apiKey: "key", model: "opus" });

    await client.generateResearch(defaultParams);

    expect(mockProvider).toHaveBeenCalledWith("claude-opus-4-5");
  });

  it("registers read_research only when toolExecutor provided", async () => {
    const toolExecutor: ToolExecutor = {
      readResearch: vi.fn().mockResolvedValue({
        ok: true,
        content: "Content",
        bytes: 7,
      }),
    };
    const client = new AnthropicClient({
      apiKey: "key",
      model: "sonnet",
      toolExecutor,
    });

    await client.generateResearch(defaultParams);

    const options = mockGenerateText.mock.calls[0]?.[0];
    expect(options.tools.read_research).toBeDefined();
  });

  it("passes system and user prompts correctly", async () => {
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    await client.generateResearch({
      ...defaultParams,
      systemPrompt: "Custom system",
      userPrompt: "Custom user",
    });

    const options = mockGenerateText.mock.calls[0]?.[0];
    expect(options.system).toBe("Custom system");
    expect(options.prompt).toBe("Custom user");
  });

  it("uses stepCountIs(5) as stop condition", async () => {
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    await client.generateResearch(defaultParams);

    expect(mockStepCountIs).toHaveBeenCalledWith(5);
    const options = mockGenerateText.mock.calls[0]?.[0];
    expect(options.stopWhen).toEqual({ type: "steps", steps: 5 });
  });

  it("maps totalUsage to inputTokens/outputTokens", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Content",
      totalUsage: { inputTokens: 5, outputTokens: 9 },
      steps: [{}, {}],
    });
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    const result = await client.generateResearch(defaultParams);

    expect(Result.isOk(result)).toBe(true);
    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.inputTokens).toBe(5);
    expect(result.value.outputTokens).toBe(9);
    expect(result.value.steps).toBe(2);
  });

  it("returns result.text as content", async () => {
    mockGenerateText.mockResolvedValue({
      text: "# Research\n\nContent",
      totalUsage: { inputTokens: 1, outputTokens: 2 },
      steps: [],
    });
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    const result = await client.generateResearch(defaultParams);

    expect(Result.isOk(result)).toBe(true);
    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.content).toBe("# Research\n\nContent");
  });

  it("read_research tool returns structured payload", async () => {
    const toolExecutor: ToolExecutor = {
      readResearch: vi.fn().mockResolvedValue({
        ok: true,
        content: "Doc",
        bytes: 3,
      }),
    };
    const client = new AnthropicClient({
      apiKey: "key",
      model: "sonnet",
      toolExecutor,
    });

    await client.generateResearch(defaultParams);

    const options = mockGenerateText.mock.calls[0]?.[0];
    const toolConfig = options.tools.read_research;
    const toolResult = await toolConfig.execute({ path: "doc.md" });

    expect(toolResult).toEqual({ ok: true, content: "Doc", bytes: 3 });
  });

  it("collects tool calls when collectToolStats is enabled", async () => {
    const toolExecutor: ToolExecutor = {
      readResearch: vi.fn().mockResolvedValue({
        ok: true,
        content: "Doc",
        bytes: 3,
      }),
    };
    mockGenerateText.mockImplementation(async (options) => {
      await options.tools.read_research.execute({ path: "doc.md" });
      return {
        text: "Result",
        totalUsage: { inputTokens: 1, outputTokens: 1 },
        steps: [],
      };
    });

    const client = new AnthropicClient({
      apiKey: "key",
      model: "sonnet",
      toolExecutor,
      collectToolStats: true,
    });

    const result = await client.generateResearch(defaultParams);

    expect(Result.isOk(result)).toBe(true);
    if (!Result.isOk(result)) {
      throw new Error("Expected ok result");
    }
    expect(result.value.toolCalls).toEqual([
      {
        name: "read_research",
        path: "doc.md",
        durationMs: expect.any(Number),
        ok: true,
        bytes: 3,
        errorType: undefined,
      },
    ]);
  });

  it("returns error result on API failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("API error"));
    const client = new AnthropicClient({ apiKey: "key", model: "sonnet" });

    const result = await client.generateResearch(defaultParams);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.name).toBe("AnthropicApiError");
    }
  });
});
