# Plan: Add Tool Use to Idea Explorer

## Overview

Add agentic capabilities to the Claude integration by implementing tool use with two tools:
1. **Web Search** - Anthropic's built-in server tool for market research, competitors, etc.
2. **Read Research** - Custom tool to read existing research files from the GitHub repo

Uses the **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) for automatic tool loop management, eliminating manual message array handling, pause_turn logic, and iteration tracking.

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `ai` and `@ai-sdk/anthropic` dependencies |
| `src/clients/anthropic.ts` | Replace streaming with `generateText()` + tools |
| `src/clients/tool-executor.ts` | **New file** - Tool executor for read_research |
| `src/prompts/index.ts` | Add tool usage instructions to system prompts |
| `src/workflows/exploration.ts` | Create and pass tool executor to AnthropicClient |

## Implementation Steps

### 1. Add Dependencies

```bash
bun add ai @ai-sdk/anthropic
```

### 2. Create Tool Executor (`src/clients/tool-executor.ts`)

```typescript
type ReadResearchResult =
  | { ok: true; content: string; bytes: number }
  | {
      ok: false;
      error_type: "file_not_found" | "path_validation" | "file_too_large" | "api_error";
      message: string;
    }

export interface ToolExecutor {
  readResearch(path: string): Promise<ReadResearchResult>;
}

export function createToolExecutor(github: GitHubClient): ToolExecutor
```

**Path validation (allowlist approach):**

Canonicalization steps in order:
1. `path.trim()` — remove leading/trailing whitespace
2. Reject if contains control chars (`/[\x00-\x1f]/`) or null bytes
3. Reject if contains `%` (block all URL-encoding to prevent mixed-case traversal like `%2E%2e`)
4. Reject if contains `..` or backslashes
5. Reject if starts with `ideas/` (we always prefix, avoid `ideas/ideas/...`)
6. Reject if ends with `/` (directory path)
7. Reject if contains `//` (empty path segment)
8. Validate against allowlist regex: `^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,199}$`
9. Prefix with `ideas/` to form final GitHub path
- On any rejection, return `error_type: "path_validation"` with a short message describing the rule

**Valid/invalid examples:**
| Input | Result |
|-------|--------|
| `market/2024-06.md` | ✅ `ideas/market/2024-06.md` |
| `competitor-analysis.md` | ✅ `ideas/competitor-analysis.md` |
| `../secrets` | ❌ Rejected (path traversal) |
| `/etc/passwd` | ❌ Rejected (absolute path) |
| `foo\bar.md` | ❌ Rejected (backslash) |
| `%2e%2e/secrets` | ❌ Rejected (contains %) |
| `ideas/market.md` | ❌ Rejected (starts with ideas/) |
| `market/` | ❌ Rejected (trailing slash) |
| `market//file.md` | ❌ Rejected (double slash) |

**File size limits:**
- GitHub Contents API returns JSON with a `size` field (decoded byte count) — use this for enforcement
- Hard limit of 50KB — return error if exceeded (no truncation)
- Error message: `"File exceeds 50KB limit. Try a more specific path or request a summary."`
- Include `bytes` in successful results from the GitHub `size` field

**Handling missing/empty files:**
- File not found (404): return `error_type: "file_not_found"` with `"File not found: {path}"`
- Empty file: return empty string `""` (not an error — Claude can handle)
- GitHub API error: return `error_type: "api_error"` with `"Failed to read file: {error.message}"`

**Handling non-file responses:**
- GitHub Contents API may return directory listings (array), symlinks, or submodules
- Validate response has `type: "file"` before processing
- If not a file: return `error_type: "api_error"` with `"Path is not a file: {path}"`
- If `size` field is missing: treat as error rather than proceeding without size check

Uses `github.getFile()` to read `ideas/{path}`.

### 3. Update Anthropic Client (`src/clients/anthropic.ts`)

Replace streaming implementation with Vercel AI SDK's `generateText()`:

```typescript
import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ToolExecutor } from "./tool-executor";

const MODEL_MAP = {
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
} as const;

const MAX_OUTPUT_TOKENS = 16_384;
const MAX_STEPS = 5;

export interface AnthropicConfig {
  apiKey: string;
  model: "sonnet" | "opus";
  toolExecutor?: ToolExecutor;
}

function buildTools(apiKey: string, toolExecutor?: ToolExecutor) {
  const tools: Record<string, unknown> = {
    web_search: anthropic.tools.webSearch({ maxUses: 5 }),
  };

  if (toolExecutor) {
    tools.read_research = tool({
      description:
        "Read an existing research document from the repository. Path is relative to ideas/ directory.",
      parameters: z.object({
        path: z.string().min(1).max(200),
      }),
      execute: async ({ path }) => {
        const startTime = Date.now();
        const result = await toolExecutor.readResearch(path);
        const durationMs = Date.now() - startTime;
        
        // Log tool execution for observability
        console.log("tool_call", { 
          name: "read_research", 
          path, 
          durationMs,
          ok: result.ok,
          bytes: result.ok ? result.bytes : undefined,
          errorType: result.ok ? undefined : result.error_type,
        });
        
        return result;
      },
    });
  }

  return tools;
}

export class AnthropicClient {
  constructor(private readonly config: AnthropicConfig) {}

  async generateResearch(params: GenerateResearchParams) {
    const tools = buildTools(this.config.apiKey, this.config.toolExecutor);

    const result = await generateText({
      model: anthropic(MODEL_MAP[this.config.model], {
        apiKey: this.config.apiKey,
      }),
      system: params.systemPrompt,
      prompt: params.userPrompt,
      maxTokens: MAX_OUTPUT_TOKENS,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    return {
      content: result.text,
      inputTokens: result.totalUsage?.inputTokens ?? 0,
      outputTokens: result.totalUsage?.outputTokens ?? 0,
      steps: result.steps.length,
    };
  }
}
```

**What the SDK handles automatically:**
- Message array management across turns
- Tool loop iteration and stop conditions
- Anthropic server tool `pause_turn` behavior (no backoff needed)
- Token usage aggregation (`totalUsage`)
- Tool result message formatting

### 4. Update Prompts (`src/prompts/index.ts`)

Add tool instructions to `buildSystemPrompt()`:

```markdown
## Available Tools

### Web Search
Use web search to find current market data, competitor information, recent news, industry trends, and factual information about companies or technologies.

### Read Research
Use this to read existing research documents from the repository. Available when exploring ideas that relate to previous work. Returns a JSON object with `ok: true` and content on success, or `ok: false` with error details on failure.

## Tool Usage Guidelines
- **Prefer web_search** when you need current, factual, or external information (market data, competitors, news)
- **Prefer read_research** when building on previous explorations or referencing internal analysis
- **Avoid redundancy**: Do not re-read the same file multiple times in a single exploration
- **Synthesize, don't dump**: Integrate tool results into your analysis rather than quoting them verbatim
- **Fail gracefully**: If a tool returns an error, acknowledge it and proceed with available information
```

### 5. Integrate in Workflow (`src/workflows/exploration.ts`)

```typescript
import { createToolExecutor } from "../clients/tool-executor";

// In run() method:
const toolExecutor = createToolExecutor(github);
const anthropic = new AnthropicClient({
  apiKey: this.env.ANTHROPIC_API_KEY,
  model,
  toolExecutor,
});
```

## Key Design Decisions

- **Vercel AI SDK**: Eliminates ~150 lines of manual tool loop logic
- **Server-side web search**: Anthropic's `web_search` tool handled transparently by SDK
- **Zod schemas**: Type-safe tool parameters with runtime validation
- **Structured tool results**: `read_research` returns `{ ok, content/error }` for graceful error handling
- **Step-based limits**: `stepCountIs(5)` prevents runaway loops
- **Wall-clock deadline**: Rely on Cloudflare Workflow step timeout (2 min) rather than custom logic

## Observability

**Available from SDK:**
- `result.steps` - Array of all steps (tool calls, text generation)
- `result.totalUsage` - Aggregated token usage across all steps
- `result.steps[i].usage` - Per-step token usage

**Custom logging in tool executor:**
```typescript
interface ToolCallLog {
  name: "read_research";
  path: string;
  durationMs: number;
  ok: boolean;
  bytes?: number;
  errorType?: string;
}
```

**Exploration log output:**
```typescript
interface ExplorationStats {
  steps: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCallLog[];
}
```

Note: Web search timing is not available (server-side execution), but step count reflects total API calls.

## Risks and Guardrails

| Risk | Guardrail |
|------|-----------|
| Runaway tool loops | `stopWhen: stepCountIs(5)` limits total steps |
| Timeout from slow web search | Cloudflare Workflow step timeout (2 min) |
| Large file blowing up context | 50KB hard limit in tool-executor |
| Path traversal attacks | Strict allowlist validation before GitHub read |

## Verification

1. Run `bun run typecheck` - ensure no type errors
2. Run `bun run check` - ensure Biome passes
3. Run `bun run test:run` - ensure existing tests pass
4. Manual test via `bun run dev`:
   - Submit an exploration with existing related research
   - Verify Claude uses read_research tool to reference prior work
   - Submit a business analysis
   - Verify Claude uses web_search for market data
5. Check logs include tool usage stats

## Test Cases

### Tool Executor (`src/clients/tool-executor.test.ts`)
- `returns file content for valid path`
- `returns error for file not found`
- `returns error for path traversal attempt (../)`
- `returns error for absolute path (/etc/passwd)`
- `returns error for path containing percent sign`
- `returns error for path starting with ideas/`
- `returns error for trailing slash`
- `returns error for double slash`
- `returns error for file exceeding 50KB`
- `returns error for path longer than 200 chars`
- `returns error for control characters in path`
- `returns error for directory response`
- `returns error for missing size field`
- `returns empty string for empty file`
- `returns bytes count in successful result`

### Anthropic Client (`src/clients/anthropic.test.ts`)
- `registers web_search tool always`
- `registers read_research only when toolExecutor provided`
- `passes system and user prompts correctly`
- `uses stepCountIs(5) as stop condition`
- `maps totalUsage to inputTokens/outputTokens`
- `returns result.text as content`
- `read_research tool returns structured ok/error payload`

## Future Considerations

### Two-Phase Prompt
If tool loops cause frequent timeouts, consider splitting into two phases:
1. **Gather phase**: "Plan and gather sources" (web search + selective read_research)
2. **Write phase**: "Write final markdown" (no tools, strictly generate)

### Parallel Tool Execution
If the model issues multiple `read_research` calls per step and latency becomes a problem, consider batching GitHub reads. Not needed initially—SDK handles tools sequentially which is simpler.

### Custom Stop Conditions
The SDK supports advanced stop conditions beyond step count:
```typescript
const budgetExceeded: StopCondition = ({ steps }) => {
  const totalTokens = steps.reduce((acc, s) => 
    acc + (s.usage?.totalTokens ?? 0), 0);
  return totalTokens > 80_000;
};

stopWhen: [stepCountIs(5), budgetExceeded]
```

Add if token budget enforcement becomes necessary.
