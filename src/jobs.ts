import { Result } from "better-result";
import { z } from "zod";
import {
  ExploreRequestBaseSchema,
  JobStatusSchema,
  ModelSchema,
  ModeSchema,
} from "@/types/api";
import { JobNotFoundError, JsonParseError, StorageError } from "./errors";

const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home.arpa",
  ".lan",
  ".test",
  ".example",
  ".invalid",
];

const IPV4_BLOCKS: [string, string][] = [
  ["0.0.0.0", "0.255.255.255"],
  ["10.0.0.0", "10.255.255.255"],
  ["100.64.0.0", "100.127.255.255"],
  ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"],
  ["172.16.0.0", "172.31.255.255"],
  ["192.0.0.0", "192.0.0.255"],
  ["192.0.2.0", "192.0.2.255"],
  ["192.168.0.0", "192.168.255.255"],
  ["198.18.0.0", "198.19.255.255"],
  ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"],
];

const IPV6_UNIQUE_LOCAL_PREFIXES = ["fc", "fd"];
const IPV6_LINK_LOCAL_PREFIXES = ["fe8", "fe9", "fea", "feb"];
const IPV6_SITE_LOCAL_PREFIXES = ["fec", "fed", "fee", "fef"];
const IPV6_DOCUMENTATION_PREFIX = "2001:db8";

function isValidIpv4Bytes(
  bytes: number[]
): bytes is [number, number, number, number] {
  return (
    bytes.length === 4 &&
    bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

function hexPairToIpv4(hexHigh: string, hexLow: string): string {
  const high = Number.parseInt(hexHigh, 16);
  const low = Number.parseInt(hexLow, 16);
  const b1 = Math.floor(high / 256);
  const b2 = high % 256;
  const b3 = Math.floor(low / 256);
  const b4 = low % 256;
  return `${b1}.${b2}.${b3}.${b4}`;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((p) => Number.parseInt(p, 10));
  if (!isValidIpv4Bytes(bytes)) {
    return null;
  }
  const value =
    bytes[0] * 256 ** 3 + bytes[1] * 256 ** 2 + bytes[2] * 256 + bytes[3];
  return Number.isSafeInteger(value) ? value : null;
}

function isPrivateOrReservedIpv4(hostname: string): boolean {
  const ipInt = ipv4ToInt(hostname);
  if (ipInt === null) {
    return false;
  }
  return IPV4_BLOCKS.some(([start, end]) => {
    const startInt = ipv4ToInt(start);
    const endInt = ipv4ToInt(end);
    if (startInt === null || endInt === null) {
      return false;
    }
    return ipInt >= startInt && ipInt <= endInt;
  });
}

function isIpv6(hostname: string): boolean {
  return hostname.includes(":");
}

function hasIpv6Prefix(hostname: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (hostname.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function isPrivateOrReservedIpv6(hostname: string): boolean {
  const normalized =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  const lower = normalized.toLowerCase();

  if (!isIpv6(lower)) {
    return false;
  }
  if (lower === "::1" || lower === "::") {
    return true;
  }
  if (lower.startsWith("::ffff:")) {
    const suffix = lower.slice(7);
    let mappedIpv4 = suffix;
    if (suffix.includes(":")) {
      const parts = suffix.split(":");
      const hexHigh = parts[0];
      const hexLow = parts[1];
      if (parts.length === 2 && hexHigh && hexLow) {
        mappedIpv4 = hexPairToIpv4(hexHigh, hexLow);
      }
    }
    return isPrivateOrReservedIpv4(mappedIpv4);
  }
  if (hasIpv6Prefix(lower, IPV6_UNIQUE_LOCAL_PREFIXES)) {
    return true;
  }
  if (hasIpv6Prefix(lower, IPV6_LINK_LOCAL_PREFIXES)) {
    return true;
  }
  if (hasIpv6Prefix(lower, IPV6_SITE_LOCAL_PREFIXES)) {
    return true;
  }
  if (lower.startsWith(IPV6_DOCUMENTATION_PREFIX)) {
    return true;
  }
  return false;
}

function hasBlockedHostnameSuffix(hostname: string, isIp: boolean): boolean {
  const lower = hostname.toLowerCase();
  if (!(isIp || lower.includes("."))) {
    return true;
  }
  return BLOCKED_HOST_SUFFIXES.some((suffix) => {
    const trimmedSuffix = suffix.startsWith(".") ? suffix.slice(1) : suffix;
    return lower === trimmedSuffix || lower.endsWith(suffix);
  });
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const ipv4Int = ipv4ToInt(hostname);
    const isIpv4 = ipv4Int !== null;
    const isIpv4Private = isIpv4 && isPrivateOrReservedIpv4(hostname);
    const isIpv6Literal = isIpv6(hostname);

    if (parsed.protocol !== "https:") {
      return false;
    }
    if (isIpv4Private) {
      return false;
    }
    if (isPrivateOrReservedIpv6(hostname)) {
      return false;
    }
    if (hasBlockedHostnameSuffix(hostname, isIpv4 || isIpv6Literal)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const webhookUrlSchema = z
  .string()
  .url()
  .refine(isValidWebhookUrl, { message: "Invalid webhook URL" })
  .optional();

export const ExploreRequestSchema = ExploreRequestBaseSchema.merge(
  z.object({
    webhook_url: webhookUrlSchema,
    callback_secret: z.string().optional(),
  })
).refine((data) => !(data.update && data.continue_from != null), {
  message:
    "Cannot use both 'update' and 'continue_from' together. Use 'update' to append to existing research of the same idea, or 'continue_from' to build upon a previous exploration.",
});

const JobSchema = z.object({
  id: z.string(),
  idea: z.string(),
  mode: ModeSchema,
  model: ModelSchema,
  status: JobStatusSchema,
  webhook_url: webhookUrlSchema,
  callback_secret: z.string().optional(),
  context: z.string().optional(),
  update: z.boolean().optional(),
  collect_tool_stats: z.boolean().optional(),
  continue_from: z.string().optional(),
  github_url: z.string().optional(),
  error: z.string().optional(),
  created_at: z.number(),
  webhook_sent_at: z.number().optional(),
  current_step: z.string().optional(),
  current_step_label: z.string().optional(),
  steps_completed: z.number().optional(),
  steps_total: z.number().optional(),
  step_started_at: z.number().optional(),
  step_durations: z.record(z.string(), z.number()).optional(),
});

export type ExploreRequest = z.infer<typeof ExploreRequestSchema>;
export type Job = z.infer<typeof JobSchema>;

export type JobError = StorageError | JsonParseError | JobNotFoundError;

export interface JobMetadata {
  created_at: number;
  status: Job["status"];
  mode: Job["mode"];
}

function buildMetadata(job: Job): JobMetadata {
  return {
    created_at: job.created_at,
    status: job.status,
    mode: job.mode,
  };
}

export function createJob(
  kv: KVNamespace,
  request: ExploreRequest
): Promise<Result<Job, StorageError>> {
  const id = crypto.randomUUID().slice(0, 8);
  const job: Job = {
    id,
    idea: request.idea,
    mode: request.mode ?? "business",
    model: request.model ?? "sonnet",
    status: "pending",
    webhook_url: request.webhook_url,
    callback_secret: request.callback_secret,
    context: request.context,
    update: request.update ?? false,
    collect_tool_stats: request.collect_tool_stats,
    continue_from: request.continue_from,
    created_at: Date.now(),
  };

  return Result.tryPromise({
    try: async () => {
      await kv.put(id, JSON.stringify(job), {
        metadata: buildMetadata(job),
      });
      return job;
    },
    catch: (error) =>
      new StorageError({ operation: "put", key: id, cause: error }),
  });
}

export function getJob(
  kv: KVNamespace,
  id: string
): Promise<Result<Job | null, StorageError | JsonParseError>> {
  return Result.tryPromise({
    try: async () => {
      const data = await kv.get(id);
      if (!data) {
        return null;
      }
      const parsed = JSON.parse(data);
      return JobSchema.parse(parsed);
    },
    catch: (error) => {
      if (error instanceof SyntaxError) {
        return new JsonParseError({ context: `job ${id}`, cause: error });
      }
      return new StorageError({ operation: "get", key: id, cause: error });
    },
  });
}

export function updateJob(
  kv: KVNamespace,
  id: string,
  updates: Partial<Omit<Job, "id" | "created_at">>,
  existingJob?: Job
): Promise<Result<Job, JobError>> {
  return Result.gen(
    // biome-ignore lint/suspicious/useAwait: async generator needed for Result.await with Promises
    async function* () {
      let job = existingJob;
      if (!job) {
        const jobResult = yield* Result.await(getJob(kv, id));
        if (!jobResult) {
          return Result.err(new JobNotFoundError({ jobId: id }));
        }
        job = jobResult;
      }

      const updated = { ...job, ...updates };

      yield* Result.await(
        Result.tryPromise({
          try: async () => {
            await kv.put(id, JSON.stringify(updated), {
              metadata: buildMetadata(updated),
            });
          },
          catch: (error) =>
            new StorageError({ operation: "put", key: id, cause: error }),
        })
      );

      return Result.ok(updated);
    }
  );
}

export interface ListJobsOptions {
  limit?: number;
  offset?: number;
  status?: Job["status"];
  mode?: Job["mode"];
}

export interface ListJobsResult {
  jobs: Job[];
  total: number;
}

export function listJobs(
  kv: KVNamespace,
  options: ListJobsOptions = {}
): Promise<Result<ListJobsResult, StorageError>> {
  return Result.tryPromise({
    try: async () => {
      const { limit = 20, offset = 0, status, mode } = options;
      let keys: KVNamespaceListKey<JobMetadata, string>[] = [];
      let cursor: string | undefined;
      let iterations = 0;
      const MAX_SCAN_ITERATIONS = 10; // Max 10,000 keys

      // Fetch all keys (up to a reasonable safety limit if needed,
      // but loop ensures we see everything for sorting)
      do {
        const list = await kv.list<JobMetadata>({ cursor, limit: 1000 });
        keys = keys.concat(list.keys);
        cursor = list.list_complete ? undefined : list.cursor;
        iterations++;
      } while (cursor && iterations < MAX_SCAN_ITERATIONS);

      // Filter keys by metadata
      const filteredKeys = keys.filter((key) => {
        if (!key.metadata) {
          return !(status || mode); // Only include if no filters are active
        }
        if (status && key.metadata.status !== status) {
          return false;
        }
        if (mode && key.metadata.mode !== mode) {
          return false;
        }
        return true;
      });

      const total = filteredKeys.length;

      // Sort by created_at desc
      filteredKeys.sort((a, b) => {
        const timeA = a.metadata?.created_at ?? 0;
        const timeB = b.metadata?.created_at ?? 0;
        return timeB - timeA;
      });

      // Paginate keys
      const pagedKeys = filteredKeys.slice(offset, offset + limit);

      // Fetch bodies for the page
      const results = await Promise.allSettled(
        pagedKeys.map(async (key) => {
          const data = await kv.get(key.name, "json");
          return data as Job | null;
        })
      );

      const jobs = results
        .filter(
          (result): result is PromiseFulfilledResult<Job | null> =>
            result.status === "fulfilled"
        )
        .map((result) => result.value)
        .filter((job): job is Job => job !== null);

      return { jobs, total };
    },
    catch: (error) => new StorageError({ operation: "list", cause: error }),
  });
}
