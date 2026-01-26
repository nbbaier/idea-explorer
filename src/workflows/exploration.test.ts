import { Result } from "better-result";
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
  GitHubClient: {
    create: vi.fn(),
  },
}));
vi.mock("../clients/anthropic", () => ({
  AnthropicClient: vi.fn(),
}));
vi.mock("../jobs", () => ({
  updateJob: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock("../utils/logger");
vi.mock("../utils/webhook", () => ({
  sendWebhook: vi
    .fn()
    .mockResolvedValue(
      Result.ok({ success: true, statusCode: 200, attempts: 1 })
    ),
}));
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
    do: vi.fn(async (_name, _config, fn) => await fn()),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run the full workflow successfully", async () => {
    // Mock GitHubClient methods
    const mockGithub = {
      listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
      getFile: vi.fn().mockResolvedValue(Result.ok(null)),
      createFile: vi
        .fn()
        .mockResolvedValue(Result.ok("https://github.com/url")),
      updateFile: vi
        .fn()
        .mockResolvedValue(Result.ok("https://github.com/url")),
    };
    vi.mocked(GitHubClient.create).mockReturnValue(
      Result.ok(mockGithub) as any
    );

    // Mock AnthropicClient
    const mockAnthropic = {
      generateResearch: vi.fn().mockResolvedValue(
        Result.ok({
          content: "Research content",
          inputTokens: 100,
          outputTokens: 200,
          steps: 1,
        })
      ),
    };
    // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
    vi.mocked(AnthropicClient).mockImplementation(function () {
      return mockAnthropic;
    } as unknown as typeof AnthropicClient);

    // Mock jobs
    vi.mocked(getJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "running",
        created_at: Date.now(),
      }) as any
    );
    vi.mocked(updateJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "running",
        created_at: Date.now(),
      }) as any
    );

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

  it("uses the latest matching directory when updating", async () => {
    const mockGithub = {
      listDirectory: vi.fn().mockResolvedValue(
        Result.ok([
          {
            name: "2026-01-01-test-slug",
            path: "ideas/2026-01-01-test-slug",
            type: "dir",
            sha: "old-sha",
          },
          {
            name: "2026-01-05-test-slug",
            path: "ideas/2026-01-05-test-slug",
            type: "dir",
            sha: "new-sha",
          },
        ])
      ),
      getFile: vi.fn((path: string) => {
        if (path.endsWith("research.md")) {
          return Promise.resolve(
            Result.ok({ content: "Existing content", sha: "latest-sha", path })
          );
        }
        return Promise.resolve(Result.ok(null));
      }),
      createFile: vi
        .fn()
        .mockResolvedValue(Result.ok("https://github.com/url")),
      updateFile: vi
        .fn()
        .mockResolvedValue(Result.ok("https://github.com/url")),
    };
    vi.mocked(GitHubClient.create).mockReturnValue(
      Result.ok(mockGithub) as any
    );

    const mockAnthropic = {
      generateResearch: vi.fn().mockResolvedValue(
        Result.ok({
          content: "New research content",
          inputTokens: 10,
          outputTokens: 20,
          steps: 1,
        })
      ),
    };
    // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
    vi.mocked(AnthropicClient).mockImplementation(function () {
      return mockAnthropic;
    } as unknown as typeof AnthropicClient);

    vi.mocked(getJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "running",
        created_at: Date.now(),
      }) as any
    );
    vi.mocked(updateJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "running",
        created_at: Date.now(),
      }) as any
    );

    const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

    await workflow.run(
      { payload: { ...mockPayload, update: true } } as any,
      mockStep as any
    );

    expect(mockGithub.getFile).toHaveBeenCalledWith(
      "ideas/2026-01-05-test-slug/research.md"
    );
    expect(mockGithub.updateFile).toHaveBeenCalledWith(
      "ideas/2026-01-05-test-slug/research.md",
      expect.stringContaining("Existing content"),
      "latest-sha",
      expect.stringContaining("updated")
    );
  });

  it("should handle failures and update job status", async () => {
    const mockGithub = {
      listDirectory: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    vi.mocked(GitHubClient.create).mockReturnValue(
      Result.ok(mockGithub) as any
    );
    vi.mocked(getJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "running",
        created_at: Date.now(),
      }) as any
    );
    vi.mocked(updateJob).mockResolvedValue(
      Result.ok({
        id: "test-job",
        idea: "Test Idea",
        mode: "exploration",
        model: "sonnet",
        status: "failed",
        created_at: Date.now(),
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

  describe("continue_from functionality", () => {
    it("should load previous research when continue_from references a completed job", async () => {
      const previousJobId = "prev-job-123";
      const previousResearchContent =
        "# Previous Research\n\nDetailed analysis here";
      const previousJobIdea = "Original Idea";

      // Mock the previous job as completed
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.ok({
            id: previousJobId,
            idea: previousJobIdea,
            mode: "exploration",
            model: "sonnet",
            status: "completed",
            github_url:
              "https://github.com/owner/repo/blob/main/ideas/2026-01-01-original/research.md",
            created_at: Date.now(),
          }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn((path: string) => {
          if (path === "ideas/2026-01-01-original/research.md") {
            return Promise.resolve(
              Result.ok({
                content: previousResearchContent,
                sha: "prev-sha",
                path,
              })
            );
          }
          return Promise.resolve(Result.ok(null));
        }),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify previous research was loaded
      expect(mockGithub.getFile).toHaveBeenCalledWith(
        "ideas/2026-01-01-original/research.md"
      );

      // Verify buildUserPrompt was called with previous research content
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent,
          previousJobIdea,
        })
      );

      // Verify the workflow completed successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
      expect(mockGithub.createFile).toHaveBeenCalled();
    });

    it("should handle missing job gracefully", async () => {
      const previousJobId = "non-existent-job";

      // Mock getJob to return job not found
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.err({ message: "Job not found" }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn().mockResolvedValue(Result.ok(null)),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify no attempt to fetch previous research file (only exploration-log.json should be fetched)
      const getFileCalls = mockGithub.getFile.mock.calls.map((call) => call[0]);
      const previousResearchCalls = getFileCalls.filter(
        (path: string) =>
          path.includes("ideas/") && path.endsWith("research.md")
      );
      expect(previousResearchCalls).toHaveLength(0);

      // Verify buildUserPrompt was called without previous research
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent: undefined,
          previousJobIdea: undefined,
        })
      );

      // Workflow should still complete successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    });

    it("should handle incomplete job (status not completed)", async () => {
      const previousJobId = "incomplete-job";

      // Mock the previous job as running (not completed)
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.ok({
            id: previousJobId,
            idea: "Previous Idea",
            mode: "exploration",
            model: "sonnet",
            status: "running",
            github_url:
              "https://github.com/owner/repo/blob/main/ideas/2026-01-01-previous/research.md",
            created_at: Date.now(),
          }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn().mockResolvedValue(Result.ok(null)),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify no attempt to fetch previous research file (job not completed)
      expect(mockGithub.getFile).not.toHaveBeenCalledWith(
        expect.stringContaining("ideas/2026-01-01-previous")
      );

      // Verify buildUserPrompt was called without previous research
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent: undefined,
          previousJobIdea: undefined,
        })
      );

      // Workflow should still complete successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    });

    it("should handle malformed GitHub URL", async () => {
      const previousJobId = "malformed-url-job";

      // Mock the previous job with a malformed URL
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.ok({
            id: previousJobId,
            idea: "Previous Idea",
            mode: "exploration",
            model: "sonnet",
            status: "completed",
            github_url: "https://github.com/owner/repo/tree/main/ideas", // Missing /blob/ path
            created_at: Date.now(),
          }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn().mockResolvedValue(Result.ok(null)),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify no attempt to fetch previous research file due to malformed URL (only exploration-log.json should be fetched)
      const getFileCalls = mockGithub.getFile.mock.calls.map((call) => call[0]);
      const previousResearchCalls = getFileCalls.filter(
        (path: string) =>
          path.includes("ideas/") && path.endsWith("research.md")
      );
      expect(previousResearchCalls).toHaveLength(0);

      // Verify buildUserPrompt was called without previous research
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent: undefined,
          previousJobIdea: undefined,
        })
      );

      // Workflow should still complete successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    });

    it("should handle getFile errors gracefully", async () => {
      const previousJobId = "getfile-error-job";

      // Mock the previous job as completed
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.ok({
            id: previousJobId,
            idea: "Previous Idea",
            mode: "exploration",
            model: "sonnet",
            status: "completed",
            github_url:
              "https://github.com/owner/repo/blob/main/ideas/2026-01-01-previous/research.md",
            created_at: Date.now(),
          }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn((path: string) => {
          if (path === "ideas/2026-01-01-previous/research.md") {
            // Return an error result
            return Promise.resolve(Result.err({ message: "File not found" }));
          }
          return Promise.resolve(Result.ok(null));
        }),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify attempt to fetch file was made
      expect(mockGithub.getFile).toHaveBeenCalledWith(
        "ideas/2026-01-01-previous/research.md"
      );

      // Verify buildUserPrompt was called without previous research (error handled gracefully)
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent: undefined,
          previousJobIdea: undefined,
        })
      );

      // Workflow should still complete successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    });

    it("should handle getFile returning null content", async () => {
      const previousJobId = "null-content-job";

      // Mock the previous job as completed
      vi.mocked(getJob).mockImplementation(async (_kv, jobId) => {
        await Promise.resolve();
        if (jobId === previousJobId) {
          return Result.ok({
            id: previousJobId,
            idea: "Previous Idea",
            mode: "exploration",
            model: "sonnet",
            status: "completed",
            github_url:
              "https://github.com/owner/repo/blob/main/ideas/2026-01-01-previous/research.md",
            created_at: Date.now(),
          }) as any;
        }
        return Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any;
      });

      const mockGithub = {
        listDirectory: vi.fn().mockResolvedValue(Result.ok([])),
        getFile: vi.fn((path: string) => {
          if (path === "ideas/2026-01-01-previous/research.md") {
            // Return ok but with empty content
            return Promise.resolve(
              Result.ok({ content: "", sha: "sha", path })
            );
          }
          return Promise.resolve(Result.ok(null));
        }),
        createFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
        updateFile: vi
          .fn()
          .mockResolvedValue(Result.ok("https://github.com/url")),
      };
      vi.mocked(GitHubClient.create).mockReturnValue(
        Result.ok(mockGithub) as any
      );

      const mockAnthropic = {
        generateResearch: vi.fn().mockResolvedValue(
          Result.ok({
            content: "New research content",
            inputTokens: 100,
            outputTokens: 200,
            steps: 1,
          })
        ),
      };
      // biome-ignore lint/complexity/useArrowFunction: must use function for constructor mock
      vi.mocked(AnthropicClient).mockImplementation(function () {
        return mockAnthropic;
      } as unknown as typeof AnthropicClient);

      vi.mocked(updateJob).mockResolvedValue(
        Result.ok({
          id: "test-job",
          idea: "Test Idea",
          mode: "exploration",
          model: "sonnet",
          status: "running",
          created_at: Date.now(),
        }) as any
      );

      const { buildUserPrompt } = await import("../prompts");

      const workflow = new ExplorationWorkflow({} as any, mockEnv as any);

      await workflow.run(
        { payload: { ...mockPayload, continue_from: previousJobId } } as any,
        mockStep as any
      );

      // Verify attempt to fetch file was made
      expect(mockGithub.getFile).toHaveBeenCalledWith(
        "ideas/2026-01-01-previous/research.md"
      );

      // Verify buildUserPrompt was called without previous research (empty content treated as no content)
      expect(buildUserPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResearchContent: undefined,
          previousJobIdea: undefined,
        })
      );

      // Workflow should still complete successfully
      expect(mockAnthropic.generateResearch).toHaveBeenCalled();
    });
  });
});
