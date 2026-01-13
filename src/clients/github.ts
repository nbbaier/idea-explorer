import { Octokit } from "octokit";

export interface GitHubConfig {
  pat: string;
  repo: string;
  branch: string;
}

export interface FileContent {
  content: string;
  sha: string;
  path: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
}

interface FileResponse {
  content?: string;
  sha: string;
  path: string;
  encoding?: string;
  type: string;
}

type OctokitInstance = InstanceType<typeof Octokit>;

export class GitHubClient {
  private readonly octokit: OctokitInstance;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;

  constructor(config: GitHubConfig, octokit?: unknown) {
    this.octokit =
      (octokit as OctokitInstance) ?? new Octokit({ auth: config.pat });

    const parts = config.repo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid repo format: "${config.repo}". Expected "owner/repo"`
      );
    }
    const [owner, repo] = parts;

    this.owner = owner;
    this.repo = repo;
    this.branch = config.branch;
  }

  async getFile(path: string): Promise<FileContent | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });

      const file = data as FileResponse;

      if (file.type !== "file" || !file.content) {
        return null;
      }

      return {
        content: decodeBase64(file.content),
        sha: file.sha,
        path: file.path,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createFile(
    path: string,
    content: string,
    message: string
  ): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.createOrUpdateFileContents(
        {
          owner: this.owner,
          repo: this.repo,
          path,
          message,
          content: encodeBase64(content),
          branch: this.branch,
        }
      );

      return data.content?.html_url ?? "";
    } catch (error) {
      if (isConflictError(error)) {
        const existingFile = await this.getFile(path);
        if (existingFile) {
          return this.updateFile(path, content, existingFile.sha, message);
        }
      }
      throw error;
    }
  }

  async updateFile(
    path: string,
    content: string,
    sha: string,
    message: string
  ): Promise<string> {
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: encodeBase64(content),
      sha,
      branch: this.branch,
    });

    return data.content?.html_url ?? "";
  }

  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === "dir" ? "dir" : "file",
        sha: entry.sha,
      }));
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return isHttpError(error, 404);
}

function isConflictError(error: unknown): boolean {
  return isHttpError(error, 409);
}

function isHttpError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}

function encodeBase64(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(base64: string): string {
  const cleanedBase64 = base64.replace(/\n/g, "");
  const binary = atob(cleanedBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}
