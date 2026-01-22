import type { FileContent, GitHubClient, NonFileContent } from "./github";

type ReadResearchResult =
  | { ok: true; content: string; bytes: number }
  | {
      ok: false;
      error_type:
        | "file_not_found"
        | "path_validation"
        | "file_too_large"
        | "api_error";
      message: string;
    };

export interface ToolExecutor {
  readResearch(path: string): Promise<ReadResearchResult>;
}

const ALLOWLIST_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,199}$/;
const IDEAS_PREFIX = "ideas/";
const MAX_FILE_BYTES = 50 * 1024;

type PathValidationResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export function createToolExecutor(github: GitHubClient): ToolExecutor {
  return {
    async readResearch(path: string): Promise<ReadResearchResult> {
      const validation = validatePath(path);
      if (!validation.ok) {
        return {
          ok: false,
          error_type: "path_validation",
          message: validation.message,
        };
      }

      const normalizedPath = validation.path;
      const fullPath = `${IDEAS_PREFIX}${normalizedPath}`;
      const fileResult = await github.getFile(fullPath, { includeMeta: true });

      if (fileResult.status === "error") {
        return {
          ok: false,
          error_type: "api_error",
          message: `Failed to read file: ${fileResult.error.message}`,
        };
      }

      const file = fileResult.value;
      if (!file) {
        return {
          ok: false,
          error_type: "file_not_found",
          message: `File not found: ${normalizedPath}`,
        };
      }

      if (isNonFileContent(file)) {
        return {
          ok: false,
          error_type: "api_error",
          message: `Path is not a file: ${normalizedPath}`,
        };
      }

      if (typeof file.size !== "number") {
        return {
          ok: false,
          error_type: "api_error",
          message: `Failed to read file: Missing size for ${normalizedPath}`,
        };
      }

      if (file.size > MAX_FILE_BYTES) {
        return {
          ok: false,
          error_type: "file_too_large",
          message:
            "File exceeds 50KB limit. Try a more specific path or request a summary.",
        };
      }

      return {
        ok: true,
        content: file.content,
        bytes: file.size,
      };
    },
  };
}

function validatePath(rawPath: string): PathValidationResult {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { ok: false, message: "Path cannot be empty." };
  }
  if (hasControlCharacters(trimmed)) {
    return { ok: false, message: "Path contains control characters." };
  }
  if (trimmed.includes("%")) {
    return { ok: false, message: "Path cannot include percent-encoding." };
  }
  if (trimmed.startsWith("/")) {
    return { ok: false, message: "Path cannot be absolute." };
  }
  if (trimmed.includes("..")) {
    return { ok: false, message: "Path cannot include '..' segments." };
  }
  if (trimmed.includes("\\")) {
    return { ok: false, message: "Path cannot include backslashes." };
  }
  if (trimmed.startsWith(IDEAS_PREFIX)) {
    return { ok: false, message: "Path must be relative to ideas/." };
  }
  if (trimmed.endsWith("/")) {
    return {
      ok: false,
      message: "Path must reference a file, not a directory.",
    };
  }
  if (trimmed.includes("//")) {
    return { ok: false, message: "Path cannot include empty segments." };
  }
  if (trimmed.length > 200) {
    return { ok: false, message: "Path exceeds 200 characters." };
  }
  if (!ALLOWLIST_REGEX.test(trimmed)) {
    return { ok: false, message: "Path contains invalid characters." };
  }

  return { ok: true, path: trimmed };
}

function isNonFileContent(
  file: FileContent | NonFileContent
): file is NonFileContent {
  return file.type !== "file";
}

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 32) {
      return true;
    }
  }
  return false;
}
