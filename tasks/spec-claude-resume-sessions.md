# Spec: Claude Session Persistence & Resume

## Problem

When a workflow times out or fails during Claude execution, we lose the ability to continue from where Claude left off. Currently, any retry would start Claude from scratch, potentially producing different results and wasting API costs.

## Goal

Enable interrupted Claude sessions to be resumed, preserving work-in-progress and allowing the workflow to continue from where it stopped.

## Background

Claude CLI supports session resumption via the `--resume` flag, which requires a session ID from a previous run. When Claude runs with `--output-format stream-json`, each output line includes a `session_id` field that can be captured and stored.

## Proposed Implementation

### 1. Capture Session ID During Execution

Modify the Claude execution to parse the streaming JSON output and extract the `session_id`:

```typescript
interface ClaudeStreamEvent {
  type: string;
  session_id?: string;
  // ... other fields
}

let sessionId: string | undefined;

// Parse each line of stream-json output
for (const line of claudeOutput.split("\n")) {
  try {
    const event: ClaudeStreamEvent = JSON.parse(line);
    if (event.session_id) {
      sessionId = event.session_id;
      break; // Session ID is consistent across all events
    }
  } catch {
    // Skip non-JSON lines
  }
}
```

### 2. Persist Session ID in Job Metadata

Store the session ID in KV alongside the job data:

```typescript
await updateJob(kv, jobId, {
  claude_session_id: sessionId,
  claude_session_saved_at: Date.now(),
});
```

### 3. Add Resume Support to Workflow

When a job is retried (either manually or automatically), check for an existing session:

```typescript
const job = await getJob(kv, jobId);
const claudeCmd = job?.claude_session_id
  ? `claude --resume ${job.claude_session_id} --output-format stream-json`
  : `claude --model ${model} -p "${escapeShell(prompt)}" --permission-mode acceptEdits --output-format stream-json`;
```

### 4. Session Expiry Handling

Claude sessions may expire after some time. Handle this gracefully:

```typescript
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const sessionAge = Date.now() - (job?.claude_session_saved_at ?? 0);
const canResume = job?.claude_session_id && sessionAge < SESSION_MAX_AGE_MS;
```

### 5. API Changes

Add a new endpoint or parameter to retry a failed job with resume:

```typescript
// POST /jobs/:id/retry?resume=true
```

Or automatically attempt resume on any retry of a timed-out job.

## Data Model Changes

Add to job schema:

| Field                    | Type             | Description                          |
| ------------------------ | ---------------- | ------------------------------------ |
| `claude_session_id`      | `string \| null` | Session ID from Claude CLI           |
| `claude_session_saved_at`| `number \| null` | Timestamp when session ID was saved  |

## Edge Cases

1. **Session expired**: Fall back to fresh start with original prompt
2. **Session corrupted**: Detect via Claude error response, fall back to fresh start
3. **Partial file conflicts**: Git conflicts from checkpoint commits need resolution before resume
4. **Multiple resume attempts**: Track resume count to prevent infinite retry loops

## Testing Strategy

1. **Unit tests**: Mock Claude output parsing for session ID extraction
2. **Integration tests**: Simulate timeout, verify session ID persisted, verify resume command construction
3. **Manual tests**: Force timeout on real job, retry with resume, verify continuation

## Future Enhancements

- **Automatic retry with resume**: On timeout, automatically queue a retry job that resumes
- **Session checkpoints**: Periodically save session progress markers for finer-grained resume points
- **Resume from checkpoint commits**: Combine with existing checkpoint feature to resume from last committed state

## Open Questions

1. How long do Claude sessions remain valid? Need to test and document.
2. Does `--resume` work if the sandbox environment has changed (different container)?
3. Should we expose resume as a user-facing feature or keep it internal?
