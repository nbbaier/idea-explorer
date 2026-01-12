interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  content_block?: {
    type: string;
    name?: string;
    input?: unknown;
    text?: string;
  };
  delta?: {
    type?: string;
    partial_json?: string;
  };
  result?: {
    duration_ms?: number;
    num_turns?: number;
    session_id?: string;
    total_cost_usd?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface ToolCall {
  name: string;
  input: unknown;
  timestamp: string;
}

export interface ExplorationLogEntry {
  type:
    | "session_start"
    | "tool_call"
    | "text_output"
    | "session_end"
    | "error"
    | "raw";
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ExplorationLogSummary {
  job_id: string;
  model: string;
  idea: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_cost_usd?: number;
  };
  num_turns: number;
  tools_used: string[];
  tool_calls: { name: string; count: number }[];
}

export function parseClaudeStreamOutput(
  rawOutput: string
): ExplorationLogEntry[] {
  const entries: ExplorationLogEntry[] = [];
  const lines = rawOutput.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as ClaudeStreamEvent;
      const timestamp = new Date().toISOString();

      if (event.type === "message" && event.subtype === "start") {
        entries.push({
          type: "session_start",
          timestamp,
          data: {
            message_id: event.message?.id,
            model: event.message?.model,
          },
        });
      } else if (event.type === "content_block" && event.subtype === "start") {
        if (event.content_block?.type === "tool_use") {
          entries.push({
            type: "tool_call",
            timestamp,
            data: {
              name: event.content_block.name,
            },
          });
        }
      } else if (event.type === "result") {
        entries.push({
          type: "session_end",
          timestamp,
          data: {
            duration_ms: event.result?.duration_ms,
            num_turns: event.result?.num_turns,
            session_id: event.result?.session_id,
            total_cost_usd: event.result?.total_cost_usd,
            usage: event.result?.usage,
          },
        });
      }
    } catch {
      entries.push({
        type: "raw",
        timestamp: new Date().toISOString(),
        data: { line },
      });
    }
  }

  return entries;
}

export function createExplorationLog(
  rawOutput: string,
  params: {
    jobId: string;
    model: string;
    idea: string;
    startTime: number;
  }
): { entries: ExplorationLogEntry[]; summary: ExplorationLogSummary } {
  const entries = parseClaudeStreamOutput(rawOutput);
  const endTime = Date.now();

  const toolCalls = entries.filter((e) => e.type === "tool_call");
  const toolCounts = new Map<string, number>();
  for (const call of toolCalls) {
    const name = call.data.name as string;
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }

  const sessionEnd = entries.find((e) => e.type === "session_end");
  const usage = (sessionEnd?.data.usage as ExplorationLogSummary["usage"]) ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

  const summary: ExplorationLogSummary = {
    job_id: params.jobId,
    model: params.model,
    idea: params.idea,
    started_at: new Date(params.startTime).toISOString(),
    ended_at: new Date(endTime).toISOString(),
    duration_ms:
      (sessionEnd?.data.duration_ms as number) ?? endTime - params.startTime,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      total_cost_usd: sessionEnd?.data.total_cost_usd as number | undefined,
    },
    num_turns: (sessionEnd?.data.num_turns as number) ?? 0,
    tools_used: [...toolCounts.keys()],
    tool_calls: [...toolCounts.entries()].map(([name, count]) => ({
      name,
      count,
    })),
  };

  return { entries, summary };
}

export function formatAsJsonl(
  entries: ExplorationLogEntry[],
  summary: ExplorationLogSummary
): string {
  const lines: string[] = [];

  lines.push(JSON.stringify({ type: "summary", ...summary }));

  for (const entry of entries) {
    if (entry.type !== "raw") {
      lines.push(JSON.stringify(entry));
    }
  }

  return `${lines.join("\n")}\n`;
}
