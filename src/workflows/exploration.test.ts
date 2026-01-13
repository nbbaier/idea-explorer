import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock cloudflare:workers
vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    constructor(ctx: any, env: any) {
      (this as any).ctx = ctx;
      (this as any).env = env;
    }
  },
}));

import { AnthropicClient } from "../clients/anthropic";
import { GitHubClient } from "../clients/github";
import { getJob, updateJob } from "../jobs";
import { ExplorationWorkflow } from "./exploration";

// Mock dependencies
vi.mock("../clients/github", () => ({
  GitHubClient: vi.fn(),
}));
vi.mock("../clients/anthropic", () => ({
  AnthropicClient: vi.fn(),
}));
vi.mock("../jobs", () => ({
  updateJob: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock("../utils/logger");
vi.mock("../utils/webhook");
vi.mock("../prompts", () => ({
  buildSystemPrompt: vi.fn(),
  buildUserPrompt: vi.fn(),
}));
vi.mock("../utils/slug", () => ({
  generateSlug: vi.fn(() => "test-slug"),
}));

describe("ExplorationWorkflow", () => {
  const mockEnv = {
    IDEA_EXPLORER_JOBS: {} as KVNamespace,
    GITHUB_PAT: "test-pat",
    GITHUB_REPO: "owner/repo",
    GITHUB_BRANCH: "main",
    ANTHROPIC_API_KEY: "test-key",
  };

  const mockPayload = {
    jobId: "test-job",
    idea: "Test Idea",
    mode: "exploration" as const,
    model: "sonnet" as const,
  };

  const mockStep = {
    do: vi.fn(async (name, config, fn) => await fn()),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run the full workflow successfully", async () => {
    // Mock GitHubClient methods
    const mockGithub = {
      listDirectory: vi.fn().mockResolvedValue([]),
      getFile: vi.fn().mockResolvedValue(null),
      createFile: vi.fn().mockResolvedValue("https://github.com/url"),
      updateFile: vi.fn().mockResolvedValue("https://github.com/url"),
    };
    vi.mocked(GitHubClient).mockImplementation(() => mockGithub as any);

    // Mock AnthropicClient
    const mockAnthropic = {
      generateResearch: vi.fn().mockResolvedValue({
        content: "Research content",
        inputTokens: 100,
        outputTokens: 200,
      }),
    };
    vi.mocked(AnthropicClient).mockImplementation(() => mockAnthropic as any);

    // Mock jobs
    vi.mocked(getJob).mockResolvedValue({
      id: "test-job",
      idea: "Test Idea",
      mode: "exploration",
      model: "sonnet",
      status: "running",
      created_at: Date.now(),
    } as any);

    const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

    await workflow.run({ payload: mockPayload } as any, mockStep as any);

    expect(mockStep.do).toHaveBeenCalledWith(
      "initialize",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockStep.do).toHaveBeenCalledWith(
      "check-existing",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockStep.do).toHaveBeenCalledWith(
      "generate-research",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockStep.do).toHaveBeenCalledWith(
      "write-github",
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockStep.do).toHaveBeenCalledWith(
      "notify",
      expect.any(Object),
      expect.any(Function)
    );

    expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    expect(mockGithub.createFile).toHaveBeenCalled();

    const updateJobCalls = vi.mocked(updateJob).mock.calls;
    const completedCall = updateJobCalls.find(
      (call) => call[2] && (call[2] as any).status === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall?.[1]).toBe("test-job");
  });

  it("should handle failures and update job status", async () => {
    // Mock GitHubClient to fail at some point
    vi.mocked(GitHubClient).mockImplementation(
      () =>
        ({
          listDirectory: vi.fn().mockRejectedValue(new Error("Network error")),
        }) as any
    );

    const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

    await expect(
      workflow.run({ payload: mockPayload } as any, mockStep as any)
    ).rejects.toThrow("Network error");

    const updateJobCalls = vi.mocked(updateJob).mock.calls;
    const failedCall = updateJobCalls.find(
      (call) =>
        call[2] &&
        (call[2] as any).status === "failed" &&
        (call[2] as any).error === "Network error"
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[1]).toBe("test-job");
  });
});
