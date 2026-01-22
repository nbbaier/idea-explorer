import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { FileContent, GitHubClient, NonFileContent } from "./github";
import { createToolExecutor } from "./tool-executor";

function createExecutor(file: FileContent | NonFileContent | null) {
  const github = {
    getFile: vi.fn().mockResolvedValue(Result.ok(file)),
  } as unknown as GitHubClient;

  return {
    executor: createToolExecutor(github),
    github,
  };
}

function createExecutorWithError(message = "Boom") {
  const github = {
    getFile: vi
      .fn()
      .mockResolvedValue(Result.err({ message } as { message: string })),
  } as unknown as GitHubClient;

  return {
    executor: createToolExecutor(github),
    github,
  };
}

describe("ToolExecutor", () => {
  it("returns file content for valid path", async () => {
    const file: FileContent = {
      content: "Hello world",
      sha: "sha",
      path: "ideas/market/2024-06.md",
      size: 11,
      type: "file",
    };
    const { executor, github } = createExecutor(file);

    const result = await executor.readResearch("market/2024-06.md");

    expect(result).toEqual({ ok: true, content: "Hello world", bytes: 11 });
    expect(github.getFile).toHaveBeenCalledWith("ideas/market/2024-06.md", {
      includeMeta: true,
    });
  });

  it("returns error for file not found", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("missing.md");

    expect(result).toEqual({
      ok: false,
      error_type: "file_not_found",
      message: "File not found: missing.md",
    });
  });

  it("returns error for path traversal attempt", async () => {
    const { executor, github } = createExecutor(null);

    const result = await executor.readResearch("../secrets");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path cannot include '..' segments.",
    });
    expect(github.getFile).not.toHaveBeenCalled();
  });

  it("returns error for absolute path", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("/etc/passwd");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path cannot be absolute.",
    });
  });

  it("returns error for path containing percent sign", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("%2e%2e/secrets");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path cannot include percent-encoding.",
    });
  });

  it("returns error for path starting with ideas/", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("ideas/market.md");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path must be relative to ideas/.",
    });
  });

  it("returns error for trailing slash", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("market/");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path must reference a file, not a directory.",
    });
  });

  it("returns error for double slash", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("market//file.md");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path cannot include empty segments.",
    });
  });

  it("returns error for file exceeding 50KB", async () => {
    const file: FileContent = {
      content: "large",
      sha: "sha",
      path: "ideas/large.md",
      size: 50 * 1024 + 1,
      type: "file",
    };
    const { executor } = createExecutor(file);

    const result = await executor.readResearch("large.md");

    expect(result).toEqual({
      ok: false,
      error_type: "file_too_large",
      message:
        "File exceeds 50KB limit. Try a more specific path or request a summary.",
    });
  });

  it("returns error for path longer than 200 chars", async () => {
    const { executor } = createExecutor(null);
    const longPath = "a".repeat(201);

    const result = await executor.readResearch(longPath);

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path exceeds 200 characters.",
    });
  });

  it("returns error for control characters in path", async () => {
    const { executor } = createExecutor(null);

    const result = await executor.readResearch("bad\u0001path.md");

    expect(result).toEqual({
      ok: false,
      error_type: "path_validation",
      message: "Path contains control characters.",
    });
  });

  it("returns error for directory response", async () => {
    const dir: NonFileContent = {
      path: "ideas/dir",
      type: "dir",
    };
    const { executor } = createExecutor(dir);

    const result = await executor.readResearch("dir");

    expect(result).toEqual({
      ok: false,
      error_type: "api_error",
      message: "Path is not a file: dir",
    });
  });

  it("returns error for missing size field", async () => {
    const file: FileContent = {
      content: "Hello",
      sha: "sha",
      path: "ideas/missing-size.md",
      type: "file",
    };
    const { executor } = createExecutor(file);

    const result = await executor.readResearch("missing-size.md");

    expect(result).toEqual({
      ok: false,
      error_type: "api_error",
      message: "Failed to read file: Missing size for missing-size.md",
    });
  });

  it("returns empty string for empty file", async () => {
    const file: FileContent = {
      content: "",
      sha: "sha",
      path: "ideas/empty.md",
      size: 0,
      type: "file",
    };
    const { executor } = createExecutor(file);

    const result = await executor.readResearch("empty.md");

    expect(result).toEqual({ ok: true, content: "", bytes: 0 });
  });

  it("returns bytes count in successful result", async () => {
    const file: FileContent = {
      content: "data",
      sha: "sha",
      path: "ideas/data.md",
      size: 4,
      type: "file",
    };
    const { executor } = createExecutor(file);

    const result = await executor.readResearch("data.md");

    expect(result).toEqual({ ok: true, content: "data", bytes: 4 });
  });

  it("returns api error when GitHub read fails", async () => {
    const { executor } = createExecutorWithError("API down");

    const result = await executor.readResearch("market/2024-06.md");

    expect(result).toEqual({
      ok: false,
      error_type: "api_error",
      message: "Failed to read file: API down",
    });
  });
});
