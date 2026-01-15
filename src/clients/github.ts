import { Result } from "better-result";
import { Octokit } from "octokit";
import {
  GitHubApiError,
  GitHubConfigError,
  GitHubConflictError,
  type GitHubError,
} from "../errors";

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

  private constructor(
    octokit: OctokitInstance,
    owner: string,
    repo: string,
    branch: string
  ) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  static create(
    config: GitHubConfig,
    octokit?: unknown
  ): Result<GitHubClient, GitHubConfigError> {
    const parts = config.repo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return Result.err(new GitHubConfigError({ repo: config.repo }));
    }
    const [owner, repo] = parts;

    const oktokitInstance =
      (octokit as OctokitInstance) ?? new Octokit({ auth: config.pat });

    return Result.ok(
      new GitHubClient(oktokitInstance, owner, repo, config.branch)
    );
  }

  async getFile(
    path: string
  ): Promise<Result<FileContent | null, GitHubApiError>> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });

      const file = data as FileResponse;

      if (file.type !== "file" || !file.content) {
        return Result.ok(null);
      }

      return Result.ok({
        content: decodeBase64(file.content),
        sha: file.sha,
        path: file.path,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return Result.ok(null);
      }
      return Result.err(
        new GitHubApiError({
          operation: "getFile",
          status: getErrorStatus(error),
          cause: error,
        })
      );
    }
  }

  async createFile(
    path: string,
    content: string,
    message: string
  ): Promise<Result<string, GitHubError>> {
    return Result.gen(
      async function* (this: GitHubClient) {
        const createResult = await Result.tryPromise({
          try: async () => {
            const { data } =
              await this.octokit.rest.repos.createOrUpdateFileContents({
                owner: this.owner,
                repo: this.repo,
                path,
                message,
                content: encodeBase64(content),
                branch: this.branch,
              });

            return data.content?.html_url ?? "";
          },
          catch: (error) => {
            if (isConflictError(error)) {
              return new GitHubConflictError({ path });
            }
            return new GitHubApiError({
              operation: "createFile",
              status: getErrorStatus(error),
              cause: error,
            });
          },
        });

        // If conflict, try to update instead
        if (
          createResult.status === "error" &&
          GitHubConflictError.is(createResult.error)
        ) {
          const existingFile = yield* Result.await(this.getFile(path));
          if (existingFile) {
            const url = yield* Result.await(
              this.updateFile(path, content, existingFile.sha, message)
            );
            return Result.ok(url);
          }
        }

        // Propagate the original result
        if (createResult.status === "error") {
          return Result.err(createResult.error);
        }
        return Result.ok(createResult.value);
      }.bind(this)
    );
  }

  async updateFile(
    path: string,
    content: string,
    sha: string,
    message: string
  ): Promise<Result<string, GitHubApiError>> {
    return Result.tryPromise({
      try: async () => {
        const { data } =
          await this.octokit.rest.repos.createOrUpdateFileContents({
            owner: this.owner,
            repo: this.repo,
            path,
            message,
            content: encodeBase64(content),
            sha,
            branch: this.branch,
          });

        return data.content?.html_url ?? "";
      },
      catch: (error) =>
        new GitHubApiError({
          operation: "updateFile",
          status: getErrorStatus(error),
          cause: error,
        }),
    });
  }

  async listDirectory(
    path: string
  ): Promise<Result<DirectoryEntry[], GitHubApiError>> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });

      if (!Array.isArray(data)) {
        return Result.ok([]);
      }

      return Result.ok(
        data.map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type === "dir" ? ("dir" as const) : ("file" as const),
          sha: entry.sha,
        }))
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return Result.ok([]);
      }
      return Result.err(
        new GitHubApiError({
          operation: "listDirectory",
          status: getErrorStatus(error),
          cause: error,
        })
      );
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

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(str: string): string {
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
  return decoder.decode(bytes);
}
