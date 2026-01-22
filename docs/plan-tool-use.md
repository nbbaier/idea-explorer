# Plan: Add Tool Use to Idea Explorer

## Overview

Add agentic capabilities to the Claude integration by implementing a tool-use loop with two tools:
1. **Web Search** - Anthropic's built-in server tool for market research, competitors, etc.
2. **Read Research** - Custom tool to read existing research files from the GitHub repo

## Files to Modify

| File | Changes |
|------|---------|
| `src/clients/anthropic.ts` | Implement tool loop, add tool definitions, new types |
| `src/clients/tool-executor.ts` | **New file** - Tool executor for read_research |
| `src/errors.ts` | Add `ToolLoopTimeoutError` |
| `src/prompts/index.ts` | Add tool usage instructions to system prompts |
| `src/workflows/exploration.ts` | Create and pass tool executor to AnthropicClient |

## Implementation Steps

### 1. Add Error Type (`src/errors.ts`)

Add `ToolLoopTimeoutError` for when tool loop exceeds max iterations.

### 2. Create Tool Executor (`src/clients/tool-executor.ts`)

```typescript
export interface ToolExecutor {
  readResearch(path: string): Promise<Result<string | null, Error>>;
}

export function createToolExecutor(github: GitHubClient): ToolExecutor
```

- Validates path (no `..` or absolute paths)
- Uses `github.getFile()` to read `ideas/{path}`
- Returns file content or null if not found

### 3. Update Anthropic Client (`src/clients/anthropic.ts`)

**New types:**
- `ReadResearchInput` - input schema for read_research tool
- Extend `AnthropicConfig` with optional `toolExecutor`

**Tool definitions:**
```typescript
// Server tool (Anthropic handles execution)
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 }

// Custom tool
const READ_RESEARCH_TOOL = { name: "read_research", description: "...", input_schema: {...} }
```

**Replace single-shot with tool loop in `generateResearch()`:**
1. Switch from `messages.stream()` to `messages.create()` (simpler for tool loops)
2. Add `tools` and `tool_choice: { type: "auto" }` to request
3. Loop while `stop_reason === "tool_use"`:
   - Extract tool_use blocks from response
   - Execute read_research via toolExecutor (web_search handled server-side)
   - Append assistant message + tool results to conversation
   - Continue until `end_turn` or `max_tokens`
4. Track cumulative token usage across turns
5. Limit to 10 iterations / 100k tokens for safety

### 4. Update Prompts (`src/prompts/index.ts`)

Add tool instructions to `buildSystemPrompt()`:

```markdown
## Available Tools

### Web Search
Use web search to find current market data, competitor information, recent news...

### Read Research
Use this to read existing research documents from the repository...

## Tool Usage Guidelines
- Use web search when you need current, factual information
- Read related research when provided to build upon previous work
- Synthesize tool results into your analysis
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

- **Non-streaming**: The current streaming only uses `finalMessage()` anyway; non-streaming is simpler for tool loops
- **Server-side web search**: Anthropic's `web_search_20250305` tool avoids needing external search APIs
- **Graceful tool errors**: Return `is_error: true` tool results so Claude can handle failures
- **Safety limits**: 10 iteration max, 100k token budget to prevent runaway loops
- **Both modes get tools**: Business mode benefits from market research; exploration mode from reading prior research

## Verification

1. Run `bun run typecheck` - ensure no type errors
2. Run `bun run check` - ensure Biome passes
3. Run `bun run test:run` - ensure existing tests pass
4. Manual test via `bun run dev`:
   - Submit an exploration with existing related research
   - Verify Claude uses read_research tool to reference prior work
   - Submit a business analysis
   - Verify Claude uses web_search for market data
5. Check exploration-log.json includes tool usage stats
