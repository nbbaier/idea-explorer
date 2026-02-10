export type StreamStatus = "streaming" | "complete" | "error";

export interface StreamBuffer {
  content: string;
  status: StreamStatus;
  version: number;
  updatedAt: number;
  error?: string;
}

const STREAM_TTL_SECONDS = 60 * 60;
const STREAM_KEY_PREFIX = "stream:";

function getStreamKey(jobId: string): string {
  return `${STREAM_KEY_PREFIX}${jobId}`;
}

export async function initStream(
  kv: KVNamespace,
  jobId: string
): Promise<void> {
  const key = getStreamKey(jobId);
  const payload: StreamBuffer = {
    content: "",
    status: "streaming",
    version: 0,
    updatedAt: Date.now(),
  };

  await kv.put(key, JSON.stringify(payload), {
    expirationTtl: STREAM_TTL_SECONDS,
  });
}

export async function getStream(
  kv: KVNamespace,
  jobId: string
): Promise<StreamBuffer | null> {
  const key = getStreamKey(jobId);
  const result = await kv.get<StreamBuffer>(key, "json");
  return result ?? null;
}

export async function appendStream(
  kv: KVNamespace,
  jobId: string,
  chunk: string
): Promise<StreamBuffer> {
  const key = getStreamKey(jobId);
  const current = (await kv.get<StreamBuffer>(key, "json")) ?? {
    content: "",
    status: "streaming",
    version: 0,
    updatedAt: Date.now(),
  };

  const next: StreamBuffer = {
    content: `${current.content}${chunk}`,
    status: "streaming",
    version: current.version + 1,
    updatedAt: Date.now(),
  };

  await kv.put(key, JSON.stringify(next), {
    expirationTtl: STREAM_TTL_SECONDS,
  });

  return next;
}

export async function completeStream(
  kv: KVNamespace,
  jobId: string,
  content: string
): Promise<void> {
  const key = getStreamKey(jobId);
  const current = await kv.get<StreamBuffer>(key, "json");
  const next: StreamBuffer = {
    content,
    status: "complete",
    version: (current?.version ?? 0) + 1,
    updatedAt: Date.now(),
  };

  await kv.put(key, JSON.stringify(next), {
    expirationTtl: STREAM_TTL_SECONDS,
  });
}

export async function errorStream(
  kv: KVNamespace,
  jobId: string,
  message: string
): Promise<void> {
  const key = getStreamKey(jobId);
  const current = await kv.get<StreamBuffer>(key, "json");
  if (!current) {
    return;
  }

  const next: StreamBuffer = {
    content: current.content,
    status: "error",
    version: current.version + 1,
    updatedAt: Date.now(),
    error: message,
  };

  await kv.put(key, JSON.stringify(next), {
    expirationTtl: STREAM_TTL_SECONDS,
  });
}
