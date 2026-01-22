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

function createClient(mockOctokit: ReturnType<typeof createMockOctokit>) {
  const result = GitHubClient.create(
    { pat: "test-token", repo: "owner/repo", branch: "main" },
    mockOctokit
  );
  if (result.status !== "ok") {
    throw new Error("Client creation failed");
  }
  return result.value;
}

describe("GitHubClient", () => {
  describe("getFile", () => {
    it("should return file content and sha", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: encodeToBase64("Hello, World!"),
            sha: "abc123",
            path: "test.txt",
            size: 13,
          },
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.getFile("test.txt");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("getFile failed");
      }
      expect(result.value).toEqual({
        content: "Hello, World!",
        sha: "abc123",
        path: "test.txt",
        size: 13,
        type: "file",
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

      const client = createClient(mockOctokit);
      const result = await client.getFile("nonexistent.txt");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("getFile failed");
      }
      expect(result.value).toBeNull();
    });

    it("should return null for directory type", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: { type: "dir", sha: "abc123", path: "folder" },
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.getFile("folder");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("getFile failed");
      }
      expect(result.value).toBeNull();
    });

    it("should return metadata for directories when includeMeta is true", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: [{ name: "file.txt", path: "folder/file.txt", type: "file" }],
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.getFile("folder", { includeMeta: true });

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("getFile failed");
      }
      expect(result.value).toEqual({ path: "folder", type: "dir" });
    });

    it("should decode base64 content with embedded newlines", async () => {
      const encoded = encodeToBase64("Hello, multiline!");
      const withNewlines = encoded.match(/.{1,40}/g)?.join("\n") ?? encoded;
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: withNewlines,
            sha: "abc123",
            path: "test.txt",
          },
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.getFile("test.txt");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("getFile failed");
      }
      expect(result.value?.content).toBe("Hello, multiline!");
    });

    it("should return error on other errors", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 500 }),
      });

      const client = createClient(mockOctokit);
      const result = await client.getFile("test.txt");

      expect(result.status).toBe("error");
      if (result.status !== "error") {
        throw new Error("Expected error");
      }
      expect(result.error.status).toBe(500);
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

      const client = createClient(mockOctokit);
      const result = await client.createFile(
        "new.txt",
        "New content",
        "Create new.txt"
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("createFile failed");
      }
      expect(result.value).toBe(
        "https://github.com/owner/repo/blob/main/new.txt"
      );
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

      const client = createClient(mockOctokit);
      const result = await client.createFile(
        "existing.txt",
        "New content",
        "Update existing.txt"
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("createFile failed");
      }
      expect(result.value).toBe(
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

    it("should encode large content without stack overflow", async () => {
      const largeContent = "A".repeat(200_000);
      const expected = encodeToBase64(largeContent);
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({
          data: {
            content: {
              html_url: "https://github.com/owner/repo/blob/main/large.txt",
            },
          },
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.createFile(
        "large.txt",
        largeContent,
        "Add large file"
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("createFile failed");
      }
      expect(result.value).toBe(
        "https://github.com/owner/repo/blob/main/large.txt"
      );
      expect(
        mockOctokit.rest.repos.createOrUpdateFileContents
      ).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        path: "large.txt",
        message: "Add large file",
        content: expected,
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

      const client = createClient(mockOctokit);
      const result = await client.updateFile(
        "test.txt",
        "Updated",
        "sha123",
        "Update test.txt"
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("updateFile failed");
      }
      expect(result.value).toBe(
        "https://github.com/owner/repo/blob/main/test.txt"
      );
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

      const client = createClient(mockOctokit);
      const result = await client.listDirectory("folder");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("listDirectory failed");
      }
      expect(result.value).toEqual([
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

      const client = createClient(mockOctokit);
      const result = await client.listDirectory("nonexistent");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("listDirectory failed");
      }
      expect(result.value).toEqual([]);
    });

    it("should return empty array if response is not array", async () => {
      const mockOctokit = createMockOctokit({
        getContent: vi.fn().mockResolvedValue({
          data: { type: "file", sha: "sha1" },
        }),
      });

      const client = createClient(mockOctokit);
      const result = await client.listDirectory("file.txt");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("listDirectory failed");
      }
      expect(result.value).toEqual([]);
    });
  });
});
