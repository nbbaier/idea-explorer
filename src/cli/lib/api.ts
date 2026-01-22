import {
  type ExploreRequest,
  type ExploreResponse,
  ExploreResponseSchema,
  type JobStatusResponse,
  JobStatusResponseSchema,
} from "@/types/api";

const TRAILING_SLASH_REGEX = /\/$/;

export class ApiError extends Error {
  statusCode?: number;
  responseBody?: string;

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NetworkError";
  }
}

export class ValidationError extends Error {
  field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(TRAILING_SLASH_REGEX, "");
    this.apiKey = options.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        "Failed to connect to API. Check your network connection.",
        error
      );
    }

    if (response.status === 401) {
      throw new AuthError("Invalid or missing API key");
    }

    if (response.status === 400) {
      const data = await response.json().catch(() => ({}));
      const errorMessage =
        (data as { error?: string }).error ?? "Validation error";
      throw new ValidationError(errorMessage);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new ApiError(
        `API request failed: ${response.statusText}`,
        response.status,
        responseBody
      );
    }

    return response.json() as Promise<T>;
  }

  async submitIdea(request: ExploreRequest): Promise<ExploreResponse> {
    const data = await this.request<unknown>("POST", "/api/explore", request);
    return ExploreResponseSchema.parse(data);
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const data = await this.request<unknown>("GET", `/api/status/${jobId}`);
    return JobStatusResponseSchema.parse(data);
  }
}
