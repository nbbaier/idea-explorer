import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "./github";

function encodeToBase64(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function createMockOctokit(overrides: {
  getContent?: ReturnType<typeof vi.fn>;
  createOrUpdateFileContents?: ReturnType<typeof vi.fn>;
}) {
  return {
    rest: {
      repos: {
        getContent: overrides.getContent ?? vi.fn(),
        createOrUpdateFileContents:
          overrides.createOrUpdateFileContents ?? vi.fn(),
      },
    },
  };
}

describe("GitHubClient", () => {
  const defaultConfig = {
    pat: "test-token",
    repo: "owner/repo",
    branch: "main",
  };

  describe("getFile", () => {
    it("should return file content and sha", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: encodeToBase64("Hello, World!"),
            sha: "abc123",
            path: "test.txt",
          },
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.getFile("test.txt");

      expect(result).toEqual({
        content: "Hello, World!",
        sha: "abc123",
        path: "test.txt",
      });

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        path: "test.txt",
        ref: "main",
      });
    });

    it("should return null for 404 errors", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.getFile("nonexistent.txt");

      expect(result).toBeNull();
    });

    it("should return null for directory type", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: { type: "dir", sha: "abc123", path: "folder" },
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.getFile("folder");

      expect(result).toBeNull();
    });

    it("should throw on other errors", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 500 }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);

      await expect(client.getFile("test.txt")).rejects.toEqual({ status: 500 });
    });
  });

  describe("createFile", () => {
    it("should create a new file", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({
          data: {
            content: {
              html_url: "https://github.com/owner/repo/blob/main/new.txt",
            },
          },
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.createFile(
        "new.txt",
        "New content",
        "Create new.txt"
      );

      expect(result).toBe("https://github.com/owner/repo/blob/main/new.txt");
      expect(
        mockOctokit.rest.repos.createOrUpdateFileContents
      ).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        path: "new.txt",
        message: "Create new.txt",
        content: encodeToBase64("New content"),
        branch: "main",
      });
    });

    it("should update existing file if it exists", async () => {
      const mockCreateOrUpdate = vi
        .fn()
        .mockRejectedValueOnce({ status: 409 })
        .mockResolvedValue({
          data: {
            content: {
              html_url: "https://github.com/owner/repo/blob/main/existing.txt",
            },
          },
        });

      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: encodeToBase64("Old content"),
            sha: "existing-sha",
            path: "existing.txt",
          },
        }),
        createOrUpdateFileContents: mockCreateOrUpdate,
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.createFile(
        "existing.txt",
        "New content",
        "Update existing.txt"
      );

      expect(result).toBe(
        "https://github.com/owner/repo/blob/main/existing.txt"
      );
      
      // First call fails (no sha)
      expect(mockCreateOrUpdate).toHaveBeenNthCalledWith(1, {
        owner: "owner",
        repo: "repo",
        path: "existing.txt",
        message: "Update existing.txt",
        content: encodeToBase64("New content"),
        branch: "main",
      });

      // Second call succeeds (with sha)
      expect(mockCreateOrUpdate).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        path: "existing.txt",
        message: "Update existing.txt",
        content: encodeToBase64("New content"),
        sha: "existing-sha",
        branch: "main",
      });
    });
  });

  describe("updateFile", () => {
    it("should update a file with sha", async () => {
      const mockOctokit = createMockOctokit({
        createOrUpdateFileContents: vi.fn().mockResolvedValue({
          data: {
            content: {
              html_url: "https://github.com/owner/repo/blob/main/test.txt",
            },
          },
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.updateFile(
        "test.txt",
        "Updated",
        "sha123",
        "Update test.txt"
      );

      expect(result).toBe("https://github.com/owner/repo/blob/main/test.txt");
      expect(
        mockOctokit.rest.repos.createOrUpdateFileContents
      ).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        path: "test.txt",
        message: "Update test.txt",
        content: encodeToBase64("Updated"),
        sha: "sha123",
        branch: "main",
      });
    });
  });

  describe("listDirectory", () => {
    it("should list directory contents", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: [
            {
              name: "file.txt",
              path: "folder/file.txt",
              type: "file",
              sha: "sha1",
            },
            {
              name: "subfolder",
              path: "folder/subfolder",
              type: "dir",
              sha: "sha2",
            },
          ],
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.listDirectory("folder");

      expect(result).toEqual([
        {
          name: "file.txt",
          path: "folder/file.txt",
          type: "file",
          sha: "sha1",
        },
        {
          name: "subfolder",
          path: "folder/subfolder",
          type: "dir",
          sha: "sha2",
        },
      ]);
    });

    it("should return empty array for 404", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.listDirectory("nonexistent");

      expect(result).toEqual([]);
    });

    it("should return empty array if response is not array", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: { type: "file", sha: "sha1" },
        }),
      });

      const client = new GitHubClient(defaultConfig, mockOctokit);
      const result = await client.listDirectory("file.txt");

      expect(result).toEqual([]);
    });
  });
});
