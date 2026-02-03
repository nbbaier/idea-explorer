# Streaming Output via KV Buffer

## Overview

Add real-time streaming of Claude's research output to the demo page using KV as a buffer. The workflow writes text chunks to KV as they stream from the API, and the frontend polls for new content.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Anthropic API  │────▶│  Workflow Step   │────▶│   KV Namespace  │
│  (streamText)   │     │  (writes chunks) │     │  (stream:{id})  │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Demo Page     │◀────│  /api/stream/:id │◀────│   Read chunks   │
│  (polls + renders)    │  (returns delta) │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## KV Schema

### Key: `stream:{jobId}`

```typescript
interface StreamBuffer {
  // Full accumulated text so far
  content: string;
  
  // Current state
  status: "streaming" | "complete" | "error";
  
  // For delta calculation - client sends this back
  version: number;
  
  // Timestamp of last update
  updatedAt: number;
  
  // Error message if status is "error"
  error?: string;
}
```

### TTL

- Set TTL of 1 hour on stream keys (cleanup after job completes)
- Can be shorter since it's only needed during active streaming

## API Changes

### New Endpoint: `GET /api/stream/:jobId`

Returns the current stream state, with optional delta support.

**Query Parameters:**
- `since` (optional): Version number. If provided, response indicates if there's new content.

**Response:**

```typescript
interface StreamResponse {
  status: "streaming" | "complete" | "error" | "not_found";
  content: string;        // Full content (or delta if optimizing later)
  version: number;        // Current version
  error?: string;         // If status is "error"
}
```

**Example:**
```
GET /api/stream/abc123
GET /api/stream/abc123?since=5
```

## Workflow Changes

### `src/clients/anthropic.ts`

Add a new method `generateResearchStreaming()` that:

1. Uses `streamText()` instead of `generateText()`
2. Accepts a callback `onChunk: (text: string) => Promise<void>`
3. Calls the callback for each text delta

```typescript
async generateResearchStreaming(
  params: GenerateResearchParams,
  onChunk: (text: string) => Promise<void>
): Promise<Result<GenerateResearchResult, AnthropicApiError>> {
  // ...
  const result = streamText({
    model: provider(MODEL_MAP[this.config.model]),
    system: params.systemPrompt,
    prompt: params.userPrompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    await onChunk(chunk);
  }
  // ...
}
```

### `src/workflows/exploration.ts`

In the `generate_research` step:

1. Initialize stream buffer in KV before starting
2. Pass chunk callback that appends to KV
3. Mark complete/error when done

```typescript
// Initialize stream
await this.env.JOBS.put(
  `stream:${jobId}`,
  JSON.stringify({ content: "", status: "streaming", version: 0, updatedAt: Date.now() }),
  { expirationTtl: 3600 }
);

// Generate with streaming
let version = 0;
await anthropic.generateResearchStreaming(params, async (chunk) => {
  const current = await this.env.JOBS.get(`stream:${jobId}`, "json");
  version++;
  await this.env.JOBS.put(
    `stream:${jobId}`,
    JSON.stringify({
      content: current.content + chunk,
      status: "streaming",
      version,
      updatedAt: Date.now(),
    }),
    { expirationTtl: 3600 }
  );
});

// Mark complete
await this.env.JOBS.put(
  `stream:${jobId}`,
  JSON.stringify({ content: fullText, status: "complete", version: version + 1, updatedAt: Date.now() }),
  { expirationTtl: 3600 }
);
```

### Optimization: Batched Writes

To reduce KV write frequency (and costs), batch chunks:

```typescript
let buffer = "";
let lastWrite = Date.now();
const BATCH_INTERVAL = 200; // ms
const BATCH_SIZE = 100;     // chars

async function flushBuffer() {
  if (!buffer) return;
  // Write accumulated buffer to KV
  buffer = "";
  lastWrite = Date.now();
}

for await (const chunk of result.textStream) {
  buffer += chunk;
  fullText += chunk;
  
  if (buffer.length >= BATCH_SIZE || Date.now() - lastWrite >= BATCH_INTERVAL) {
    await flushBuffer();
  }
}
await flushBuffer(); // Final flush
```

## Frontend Changes

### `public/demo.html`

Add a new section for streaming content:

```html
<div class="stream-section" id="streamSection">
  <div class="stream-header">
    <span class="stream-title">Research Output</span>
    <span class="stream-status" id="streamStatus">Streaming...</span>
  </div>
  <div class="stream-content" id="streamContent"></div>
</div>
```

### Polling Logic

Add stream polling alongside status polling:

```javascript
let streamVersion = 0;

async function pollStream(jobId, token) {
  try {
    const response = await fetch(`/api/stream/${jobId}?since=${streamVersion}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!response.ok) return;
    
    const data = await response.json();
    
    if (data.status === "not_found") return;
    
    if (data.version > streamVersion) {
      streamContent.textContent = data.content;
      streamVersion = data.version;
      
      // Auto-scroll
      streamContent.scrollTop = streamContent.scrollHeight;
    }
    
    if (data.status === "complete") {
      streamStatus.textContent = "Complete";
      clearInterval(streamPollInterval);
    } else if (data.status === "error") {
      streamStatus.textContent = "Error";
      clearInterval(streamPollInterval);
    }
  } catch (error) {
    console.error("Stream poll error:", error);
  }
}

// Start polling when job starts
streamPollInterval = setInterval(() => pollStream(jobId, token), 500);
```

### Styling

```css
.stream-section {
  margin-top: 1.5rem;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  display: none;
}

.stream-section.visible {
  display: block;
}

.stream-header {
  padding: 0.75rem 1rem;
  background: #2a2a2a;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stream-title {
  color: #fff;
  font-weight: 500;
}

.stream-status {
  color: #888;
  font-size: 0.875rem;
}

.stream-content {
  padding: 1rem;
  color: #e0e0e0;
  font-family: ui-monospace, monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
```

### Optional: Typing Effect

For extra polish, render with a typing animation:

```javascript
let displayedLength = 0;

function renderWithTyping(fullContent) {
  const charsToAdd = fullContent.length - displayedLength;
  if (charsToAdd <= 0) return;
  
  // Add characters gradually
  const chunk = fullContent.slice(displayedLength, displayedLength + 5);
  streamContent.textContent += chunk;
  displayedLength += chunk.length;
  
  if (displayedLength < fullContent.length) {
    requestAnimationFrame(() => renderWithTyping(fullContent));
  }
}
```

## Implementation Order

1. **Add stream KV operations** (`src/utils/stream-buffer.ts`)
   - `initStream(jobId)`
   - `appendStream(jobId, chunk)`
   - `completeStream(jobId)`
   - `getStream(jobId)`

2. **Add `/api/stream/:jobId` endpoint** (`src/index.ts`)

3. **Add `generateResearchStreaming()` method** (`src/clients/anthropic.ts`)

4. **Update workflow** to use streaming and write to KV (`src/workflows/exploration.ts`)

5. **Update demo UI** with stream section and polling (`public/demo.html`)

6. **Test end-to-end**

## Estimated Effort

| Task | Time |
|------|------|
| Stream buffer utilities | 30 min |
| API endpoint | 30 min |
| Anthropic client streaming | 45 min |
| Workflow integration | 45 min |
| Demo UI + polling | 1 hour |
| Testing + polish | 30 min |
| **Total** | **~4 hours** |

## Future Improvements

- **WebSocket upgrade**: Replace polling with Durable Objects + WebSocket for true real-time
- **Delta compression**: Only send new content since last poll instead of full content
- **Markdown rendering**: Render streamed content as formatted markdown in real-time
- **Cursor indicator**: Show blinking cursor at end of streaming content
