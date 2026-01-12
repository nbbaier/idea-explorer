# PRD: Real-Time Stream Capture for Sandbox Execution

## Introduction

Add real-time streaming infrastructure to capture and expose Claude CLI output as it runs inside Cloudflare Sandbox containers. This enables live debugging/monitoring during development and provides a structured audit trail of execution events for completed jobs.

Currently, Claude's output is only available after execution completes. This feature streams parsed events and step progress in real-time via a Durable Object relay, allowing clients to subscribe and receive updates as they happen.

## Goals

- Stream Claude CLI output in real-time from sandbox containers
- Parse `stream-json` output into structured events (tool calls, content blocks, errors)
- Provide high-level step progress summaries alongside raw events
- Persist streamed events for post-execution audit/debugging
- Expose a WebSocket endpoint for clients to subscribe to job streams
- Maintain backward compatibility with existing polling-based status API

## User Stories

### US-001: Enable streaming exec in sandbox
**Description:** As a developer, I need the sandbox.exec() call to use streaming mode so output is captured in real-time rather than after completion.

**Acceptance Criteria:**
- [ ] Update `sandbox.exec()` call in exploration workflow to use `stream: true`
- [ ] Add `onOutput` callback that receives stdout/stderr chunks
- [ ] Existing workflow behavior unchanged (still waits for completion)
- [ ] Typecheck passes

### US-002: Create StreamRelay Durable Object
**Description:** As a developer, I need a Durable Object that accepts streamed chunks and broadcasts them to connected WebSocket clients.

**Acceptance Criteria:**
- [ ] New `StreamRelay` Durable Object class
- [ ] Accepts WebSocket connections keyed by job ID
- [ ] `push(jobId, event)` method to broadcast events to subscribers
- [ ] Handles client connect/disconnect gracefully
- [ ] Buffers recent events for late-joining clients (last N events)
- [ ] Typecheck passes

### US-003: Parse Claude stream-json events
**Description:** As a developer, I need raw stdout parsed into structured Claude events so clients receive meaningful data.

**Acceptance Criteria:**
- [ ] Parser handles Claude `stream-json` format (newline-delimited JSON)
- [ ] Extracts event types: `content_block_delta`, `tool_use`, `tool_result`, `message_start`, `message_stop`, `error`
- [ ] Emits structured event objects with timestamp, type, and payload
- [ ] Handles malformed/partial JSON gracefully (buffer incomplete lines)
- [ ] Unit tests for parser with sample Claude output
- [ ] Typecheck passes

### US-004: Generate high-level step summaries
**Description:** As a developer, I want high-level progress events alongside raw events so clients can show simplified status.

**Acceptance Criteria:**
- [ ] Emit `step:start` and `step:complete` events for workflow steps
- [ ] Emit `tool:start` and `tool:complete` events when Claude invokes tools
- [ ] Emit `file:write` events when Claude writes to files
- [ ] Include human-readable labels (e.g., "Writing research.md")
- [ ] Typecheck passes

### US-005: Add WebSocket stream endpoint
**Description:** As a developer, I need an API endpoint to subscribe to a job's event stream via WebSocket.

**Acceptance Criteria:**
- [ ] `GET /api/stream/:jobId` upgrades to WebSocket connection
- [ ] Connects client to StreamRelay Durable Object for that job
- [ ] Sends buffered recent events on connect (catch-up)
- [ ] Sends `{ type: "connected", jobId }` on successful connection
- [ ] Sends `{ type: "complete" }` when job finishes
- [ ] Returns 404 if job doesn't exist
- [ ] Requires auth (same as other API endpoints)
- [ ] Typecheck passes

### US-006: Persist stream events for audit trail
**Description:** As a developer, I need streamed events persisted so I can review execution after completion.

**Acceptance Criteria:**
- [ ] Store events in StreamRelay Durable Object SQLite storage
- [ ] Events queryable by job ID after completion
- [ ] Add `GET /api/stream/:jobId/events` to retrieve persisted events
- [ ] Include timestamp, event type, and payload for each event
- [ ] Typecheck passes

### US-007: Wire streaming into exploration workflow
**Description:** As a developer, I need the exploration workflow to push events to the StreamRelay as Claude executes.

**Acceptance Criteria:**
- [ ] Get StreamRelay stub in workflow using job ID
- [ ] Forward parsed events from `onOutput` callback to relay
- [ ] Forward step progress events (existing step tracking) to relay
- [ ] Signal completion/failure to relay when workflow ends
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Use `sandbox.exec()` with `stream: true` and `onOutput` callback for Claude execution
- FR-2: Create `StreamRelay` Durable Object bound as `STREAM_RELAY` in wrangler config
- FR-3: Parse Claude `stream-json` output into typed event objects
- FR-4: Buffer last 100 events per job for late-joining clients
- FR-5: Expose `/api/stream/:jobId` WebSocket endpoint for real-time subscription
- FR-6: Expose `/api/stream/:jobId/events` GET endpoint for historical events
- FR-7: Persist all events to Durable Object SQLite storage
- FR-8: Broadcast events to all connected clients within 100ms of receipt
- FR-9: Clean up old event data after 7 days (configurable)

## Non-Goals

- No client-side UI for viewing streams (backend infrastructure only)
- No filtering/querying of events beyond job ID
- No authentication per-stream (uses existing API auth)
- No rate limiting on WebSocket connections (rely on Cloudflare defaults)
- No compression of WebSocket messages
- No support for streaming to external services (webhooks remain batch)

## Technical Considerations

### Transport: WebSocket via Durable Objects

**Recommendation:** WebSocket over SSE for this use case.

| Factor | WebSocket | SSE |
|--------|-----------|-----|
| Cloudflare DO support | Native | Requires workarounds |
| Reconnection | Manual, but full control | Built-in, but limited |
| Bidirectional | Yes (future: pause/cancel) | No |
| Browser support | Universal | Universal |

Durable Objects have first-class WebSocket support via `acceptWebSocket()`. SSE would require a different architecture.

### Event Schema

```typescript
interface StreamEvent {
  id: string;           // Unique event ID
  jobId: string;        // Job this event belongs to
  timestamp: number;    // Unix ms
  type: StreamEventType;
  payload: unknown;     // Type-specific data
}

type StreamEventType =
  // High-level progress
  | "job:start"
  | "job:complete"
  | "job:failed"
  | "step:start"
  | "step:complete"
  // Claude events (parsed from stream-json)
  | "claude:message_start"
  | "claude:content_block_delta"
  | "claude:tool_use"
  | "claude:tool_result"
  | "claude:message_stop"
  | "claude:error"
  // File operations
  | "file:write"
  | "file:read";
```

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Exploration    │     │   StreamRelay    │     │    Clients      │
│   Workflow      │────▶│  Durable Object  │────▶│   (WebSocket)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│    Sandbox      │     │  SQLite Storage  │
│  (Claude CLI)   │     │  (Event Log)     │
└─────────────────┘     └──────────────────┘
```

### Durable Object Binding

Add to `wrangler.jsonc`:
```jsonc
{
  "durable_objects": {
    "bindings": [
      { "class_name": "StreamRelay", "name": "STREAM_RELAY" }
    ]
  }
}
```

### File Structure

```
src/
├── streaming/
│   ├── relay.ts          # StreamRelay Durable Object
│   ├── parser.ts         # Claude stream-json parser
│   ├── events.ts         # Event types and schemas
│   └── relay.test.ts     # Unit tests
├── index.ts              # Add WebSocket route
└── workflows/
    └── exploration.ts    # Wire up streaming
```

## Success Metrics

- Events delivered to connected clients within 100ms of generation
- Zero impact on existing job completion times
- All Claude tool calls visible in event stream
- Events persisted and queryable after job completion
- Graceful handling of client disconnects (no workflow failures)

## Open Questions

- Should we support multiple StreamRelay instances (sharding by job ID prefix)?
- What's the retention policy for persisted events? (Proposed: 7 days)
- Should late-joining clients receive all historical events or just recent buffer?
- Do we need backpressure handling if clients can't keep up?
