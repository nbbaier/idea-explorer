# Spec: Tool Use for Idea Explorer

## Goal
Add agentic tool use to Claude explorations with two tools:
- `web_search` (Anthropic server tool)
- `read_research` (custom GitHub repo reader under `ideas/`)

Replace the manual streaming/tool loop with Vercel AI SDK `generateText()` for managed tool execution, usage aggregation, and stop conditions.

## Non-goals
- No new UI or API endpoints
- No repository reads outside `ideas/`
- No token-budget stop conditions beyond step count (can be added later)

## Functional Requirements

### Tool Registration
- Always register `web_search`
- Register `read_research` when a `ToolExecutor` is provided

### read_research Tool
Input: `{ path: string }` (1-200 chars)

Output (structured):
- Success: `{ ok: true; content: string; bytes: number }`
- Failure: `{ ok: false; error_type: "file_not_found" | "path_validation" | "file_too_large" | "api_error"; message: string }`

### Path Validation (Allowlist)
Canonicalization steps:
1. `path.trim()`
2. Reject control chars or null bytes (`/[\x00-\x1f]/`)
3. Reject any `%`
4. Reject `..` or `\`
5. Reject if starts with `ideas/`
6. Reject if ends with `/`
7. Reject if contains `//`
8. Must match `^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,199}$`
9. Prefix with `ideas/` for GitHub read

On rejection: `error_type: "path_validation"` with rule-specific message.

### File Size Enforcement
- Use GitHub `size` field (decoded bytes)
- Hard limit: 50KB (no truncation)
- Error message: `File exceeds 50KB limit. Try a more specific path or request a summary.`
- Missing `size` is an error (`api_error`)

### Non-file Responses
If GitHub response `type !== "file"`: `api_error` with `Path is not a file: {path}`

### Error Handling
- 404 -> `file_not_found` with `File not found: {path}`
- Empty file -> success with `content: ""`
- Other API errors -> `api_error` with `Failed to read file: {error.message}`

## Architecture and Data Flow

**Exploration Workflow**
- Create `toolExecutor = createToolExecutor(github)`
- Pass into `new AnthropicClient({ apiKey, model, toolExecutor, collectToolStats })`

**Tool Executor**
- Implements validation + GitHub read + size enforcement
- Returns structured result

**Anthropic Client**
- Uses `generateText()` from `ai` + `@ai-sdk/anthropic`
- `stopWhen: stepCountIs(5)`
- Returns `{ content, inputTokens, outputTokens, steps }`
- Always registers `web_search`
- Conditionally registers `read_research`

**Prompts**
Add tool instructions + guidelines to system prompt:
- when to use each tool
- avoid redundant reads
- synthesize results
- handle tool errors gracefully

## Configurable Tool-Call Aggregation

Add per-run flag:
```ts
collectToolStats?: boolean // default false
```

Behavior:
- `false`: only per-call `console.log("tool_call", ...)`
- `true`: collect `ToolCallLog[]` during generation and return in exploration stats

## Limits
- Max output tokens: 16,384
- Max steps: 5
- Max file size: 50KB

## Observability
- Log each `read_research` tool call:
  - name, path, durationMs, ok, bytes, errorType
- SDK provides:
  - `result.steps`
  - `result.totalUsage`
  - per-step usage

## Tests

### Tool Executor
- valid file
- file not found
- traversal (`..`)
- absolute path (`/etc/passwd`)
- percent sign
- starts with `ideas/`
- trailing slash
- double slash
- >50KB
- >200 chars
- control chars
- directory response
- missing size field
- empty file
- bytes in success

### Anthropic Client
- registers `web_search` always
- registers `read_research` only with executor
- correct prompts
- stepCountIs(5)
- maps `totalUsage` to tokens
- returns `result.text` as content
- structured tool payloads

## Verification
1. `bun run typecheck`
2. `bun run check`
3. `bun run test:run`
4. Manual `bun run dev`:
   - exploration with related research -> use `read_research`
   - business analysis -> use `web_search`
5. Check logs for tool usage stats
