# Idea Explorer - API Specification

A Cloudflare Worker that explores and analyzes ideas using Claude, committing research results to a GitHub repository.

## Overview

The service accepts ideas via API, calls the Anthropic Messages API to generate research using one of two frameworks (business or exploration), and commits the output to a GitHub repository via the GitHub Contents API. Results are delivered via webhook with HMAC signature verification.

---

## Architecture

The service uses **Cloudflare Workflows** for durable execution of exploration jobs. Workflows provide automatic retries, state persistence between steps, and survive IoContext timeouts.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Cloudflare Worker                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  POST /api/explore ──► Validate ──► Create Job (KV) ──► Trigger Workflow     │
│                                                              │               │
│                                                              ▼               │
│  GET /api/status/{id} ◄────────────────────────── Reads from KV             │
│  GET /api/workflow-status/{id} ◄───────────────── Reads Workflow state      │
│  GET /api/health                                                             │
│  GET /api/test-webhook                                                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Workflow                                  │
│                      (ExplorationWorkflow)                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: initialize ────────► Update job status to "running"                 │
│              │                                                               │
│              ▼                                                               │
│  Step 2: check-existing ────► Check for existing idea via GitHub API         │
│              │                  ├─ exists & update=false → use existing      │
│              │                  └─ exists & update=true → load content       │
│              ▼                                                               │
│  Step 3: generate-research ─► Call Anthropic Messages API (streaming)        │
│              │                                                               │
│              ▼                                                               │
│  Step 4: write-github ──────► Write files via GitHub Contents API            │
│              │                                                               │
│              ▼                                                               │
│  Step 5: notify ────────────► Update KV status, send webhook                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
               Anthropic Messages API          GitHub Contents API
                   (fetch call)                    (fetch call)
```

### Workflow Benefits

- **Durable execution**: Steps survive IoContext timeouts and Worker restarts
- **Automatic retries**: Each step configured with retry policies
- **State persistence**: Data returned from each step is persisted automatically
- **Observability**: Native workflow status tracking via dashboard and API
- **No containers**: Direct HTTP calls eliminate cold starts and Docker image management

---

## API Specification

All `/api/*` endpoints require Bearer token authentication.

### POST /api/explore

Start an idea exploration job.

**Authentication:** Bearer token in `Authorization` header

**Request Body:**

```typescript
{
  idea: string;           // Required: The idea to explore
  webhook_url?: string;   // Optional: URL to receive completion callback (falls back to WEBHOOK_URL env var)
  mode?: 'business' | 'exploration';  // Default: 'business'
  model?: 'sonnet' | 'opus';          // Default: 'sonnet'
  callback_secret?: string;           // Optional: Secret for HMAC-SHA256 webhook signature verification
  context?: string;                   // Optional additional context
  update?: boolean;                   // Optional: Force re-run and append update section to existing research
}
```

**Success Response (202 Accepted):**

```json
{
   "job_id": "abc123",
   "status": "pending"
}
```

Note: Duplicate detection happens asynchronously. If an existing idea is found:

-  With `update: false` (default): Job completes quickly with the existing `github_url`
-  With `update: true`: A new `## Update - YYYY-MM-DD` section is appended to the existing research

**Error Responses:**

-  `400 Bad Request` - Missing or invalid fields (e.g., `{"error": "Bad Request: idea is required"}`)
-  `401 Unauthorized` - Invalid or missing bearer token

---

### GET /api/status/{job_id}

Check the status of an exploration job.

**Authentication:** Bearer token in `Authorization` header

**Success Response (200 OK):**

```json
{
  "status": "pending" | "running" | "completed" | "failed",
  "idea": "AI calendar assistant",
  "mode": "business",
  "github_url": "https://github.com/...",  // Present when completed
  "error": "Error message"                  // Present when failed
}
```

**When status is "running", additional step progress fields are included:**

```json
{
  "status": "running",
  "idea": "AI calendar assistant",
  "mode": "business",
  "current_step": "generate_research",
  "current_step_label": "Generating research with Claude...",
  "steps_completed": 2,
  "steps_total": 5,
  "step_started_at": 1704816000000,
  "step_durations": {
    "initialize": 245,
    "check_existing": 312
  }
}
```

**Step Progress Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `current_step` | string | Name of the current workflow step |
| `current_step_label` | string | Human-readable description of current step |
| `steps_completed` | number | Number of steps completed so far (0 = no steps completed yet) |
| `steps_total` | number | Total number of steps in the workflow (5) |
| `step_started_at` | number | Unix timestamp (ms) when current step started |
| `step_durations` | object | Map of completed step names to duration (ms) |

**Workflow Steps:**

1. `initialize` - Initializing job...
2. `check_existing` - Checking for existing research...
3. `generate_research` - Generating research with Claude...
4. `write_github` - Writing results to GitHub...
5. `notify` - Sending completion notification...

**Error Response (404 Not Found):**

```json
{
   "error": "Job not found"
}
```

---

### GET /api/workflow-status/{job_id}

Check the native Cloudflare Workflow execution status for a job. Provides more granular status information than the job status endpoint.

**Authentication:** Bearer token in `Authorization` header

**Success Response (200 OK):**

```json
{
  "workflow_status": "running",
  "output": null,
  "error": null
}
```

**Workflow Status Values:**

| Status | Description |
|--------|-------------|
| `queued` | Workflow is queued but not yet started |
| `running` | Workflow is currently executing |
| `paused` | Workflow is paused (e.g., during `step.sleep()`) |
| `waiting` | Workflow is waiting for external input |
| `complete` | Workflow finished successfully |
| `errored` | Workflow failed with an error |
| `terminated` | Workflow was manually terminated |

**Error Response (404 Not Found):**

```json
{
   "error": "Workflow instance not found"
}
```

---

### GET /api/jobs

List exploration jobs with optional filtering and pagination.

**Authentication:** Bearer token in `Authorization` header

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `pending` \| `running` \| `completed` \| `failed` | Filter by job status |
| `mode` | `business` \| `exploration` | Filter by analysis mode |
| `limit` | number | Max results (1-100, default 20) |
| `offset` | number | Pagination offset (default 0) |

**Success Response (200 OK):**

```json
{
  "jobs": [...],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/health

Simple health check endpoint.

**Authentication:** Bearer token in `Authorization` header

**Response (200 OK):**

```json
{
   "status": "ok"
}
```

---

### GET /api/test-webhook

Test webhook delivery without running an exploration.

**Authentication:** Bearer token in `Authorization` header

**Query Parameters:**

| Parameter         | Required | Description                                           |
| ----------------- | -------- | ----------------------------------------------------- |
| `webhook_url`     | No       | Target URL (falls back to `WEBHOOK_URL` env var)      |
| `status`          | No       | `completed` or `failed` (default: `completed`)        |
| `callback_secret` | No       | Secret for HMAC signature                             |

**Response (200 OK):**

```json
{
   "message": "Mock webhook sent",
   "webhook_url": "https://...",
   "status": "completed",
   "result": { ... }
}
```

---

## Webhook Specification

When an exploration job completes (success or failure), the service delivers a webhook to the configured URL.

### Payload

```typescript
{
  event: 'idea_explored';
  job_id: string;
  idea: string;
  mode: 'business' | 'exploration';
  status: 'completed' | 'failed';
  github_url?: string;    // Present on success
  error?: string;         // Present on failure
  repo: string;           // e.g., 'user/ideas'
  branch: string;         // e.g., 'main'
  timestamp: string;      // ISO 8601 format
}
```

### Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Idea-Explorer-Event` | `idea_explored` |
| `X-Idea-Explorer-Signature` | HMAC-SHA256 signature (if `callback_secret` provided) |

### Signature Verification

If `callback_secret` was provided in the original request:

```
X-Idea-Explorer-Signature: sha256=<hex-encoded-hmac>
```

**Verification (Node.js example):**

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Delivery

- **Retries**: 3 attempts with exponential backoff (1s, 2s, 4s delays)
- **Timeout**: 10 seconds per attempt
- **Success**: HTTP 2xx response
- **Failure**: Logged, job status remains queryable via API

---

## Analysis Frameworks

### Business Mode

Structured analysis for evaluating commercial viability:

1. **Problem Analysis** - Pain points, frequency, current solutions
2. **Market Assessment** - TAM/SAM/SOM, competitors, differentiation
3. **Use Cases & Personas** - Primary users and value propositions
4. **Technical Feasibility** - Requirements, MVP scope, risks
5. **Verdict** - STRONG YES / CONDITIONAL YES / PIVOT / PASS with reasoning

### Exploration Mode

Creative divergent thinking:

1. **Core Insight Deconstruction** - First principles breakdown
2. **Directions to Explore** - 5-10 distinct paths with pros/cons
3. **Unexpected Connections** - Adjacent ideas and combinations
4. **Questions Worth Answering** - Key unknowns to investigate

### Update Mode

When `update: true` is set and an existing idea folder is found, a new section is appended:

```markdown
## Update - YYYY-MM-DD

[New insights, revised analysis, or additional exploration]
```

---

## GitHub Integration

### Repository Structure

```
ideas/
├── 2025-01-07-ai-calendar/
│   ├── research.md
│   └── exploration-log.json
├── 2025-01-08-code-review-bot/
│   ├── research.md
│   └── exploration-log.json
└── ...
```

**Naming Convention:** `ideas/YYYY-MM-DD-<slug>/research.md`

### Exploration Log

Each exploration creates a JSON log file alongside the research:

```json
{
  "jobId": "abc123",
  "idea": "AI calendar assistant",
  "mode": "business",
  "model": "sonnet",
  "context": "Optional context provided",
  "isUpdate": false,
  "startedAt": "2025-01-07T10:00:00.000Z",
  "completedAt": "2025-01-07T10:02:30.000Z",
  "durationMs": 150000,
  "tokens": {
    "input": 1500,
    "output": 4200,
    "total": 5700
  },
  "outputPath": "ideas/2025-01-07-ai-calendar/research.md"
}
```

### Duplicate Detection

Via GitHub Contents API:

1. List `ideas/` directory contents
2. Check folder names for any matching `*-<slug>` pattern (any date prefix)
3. If found and `update: false`: Complete job immediately with existing `github_url`
4. If found and `update: true`: Load existing content and append update section
5. If not found: Proceed with new exploration

### File Operations

All file operations use the GitHub Contents API:

- **Read**: `GET /repos/{owner}/{repo}/contents/{path}`
- **Create**: `PUT /repos/{owner}/{repo}/contents/{path}` (without SHA)
- **Update**: `PUT /repos/{owner}/{repo}/contents/{path}` (with SHA)
- **List**: `GET /repos/{owner}/{repo}/contents/{path}` (for directories)

**Authentication:** GitHub PAT stored in Cloudflare secrets

---

## Environment Variables & Secrets

### Cloudflare Secrets (via wrangler secret put)

| Name                       | Description                                  |
| -------------------------- | -------------------------------------------- |
| `ANTHROPIC_API_KEY`        | API key for Claude                           |
| `GITHUB_PAT`               | Personal access token with repo write access |
| `IDEA_EXPLORER_API_TOKEN`  | Token for authenticating API requests        |

### Worker Environment

| Name            | Description                                         |
| --------------- | --------------------------------------------------- |
| `GITHUB_REPO`   | Target repository (e.g., `user/ideas`)              |
| `GITHUB_BRANCH` | Branch to commit to (default: `main`)               |
| `WEBHOOK_URL`   | Optional default webhook URL when request omits one |

### Job Storage

Jobs are persisted in Cloudflare KV. The KV namespace binding is configured in `wrangler.jsonc`.

---

## Observability

### Logging

Log events:

-  `job_created`: `{job_id, idea, mode, timestamp}`
-  `job_started`: `{job_id, mode, model}`
-  `existing_research_found`: `{job_id, path}`
-  `check_existing_complete`: `{job_id, hasExisting}`
-  `claude_started`: `{job_id, model}`
-  `claude_complete`: `{job_id, input_tokens, output_tokens}`
-  `github_write_complete`: `{job_id, path}`
-  `webhook_sent`: `{job_id, status_code, attempt}`
-  `job_complete`: `{job_id, status, total_duration_ms}`
-  `exploration_failed`: `{job_id, error}`

### Cloudflare Analytics

Enable observability in wrangler.jsonc for built-in metrics.

---

## Error Handling

### Anthropic API Errors

- **Rate limits**: Retry with exponential backoff
- **Context too long**: Return clear error to user
- **API down**: Fail job with error message

### GitHub API Errors

- **File exists (409)**: Fetch SHA and update instead
- **Rate limits**: Retry with backoff
- **Auth failure**: Fail with clear message

### Webhook Failures

After 3 failed delivery attempts:

-  Log the failure
-  Job status remains queryable via GET /api/status/{id}

---

## Security Considerations

1. **API Authentication:** Bearer token required for all `/api/*` endpoints
2. **Webhook Signing:** HMAC-SHA256 signature for payload verification
3. **GitHub Access:** Fine-grained PAT scoped to ideas repo only
4. **Secrets Management:** All sensitive values in Cloudflare secrets

---

## Example Usage

```bash
# Start a business analysis
curl -X POST https://idea-explorer.your-domain.workers.dev/api/explore \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "AI-powered code review assistant that learns team patterns",
    "webhook_url": "https://your-server.com/webhook",
    "callback_secret": "your-webhook-secret",
    "mode": "business"
  }'

# Response
{
  "job_id": "a1b2c3d4",
  "status": "pending"
}

# Check status
curl https://idea-explorer.your-domain.workers.dev/api/status/a1b2c3d4 \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# Response (when complete)
{
  "status": "completed",
  "idea": "AI-powered code review assistant that learns team patterns",
  "mode": "business",
  "github_url": "https://github.com/user/ideas/blob/main/ideas/2025-01-07-ai-code-review/research.md"
}

# Update existing research with new insights
curl -X POST https://idea-explorer.your-domain.workers.dev/api/explore \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "AI-powered code review assistant that learns team patterns",
    "update": true
  }'

# Test webhook delivery
curl "https://idea-explorer.your-domain.workers.dev/api/test-webhook?webhook_url=https://your-server.com/webhook&status=completed" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

## Future Considerations (Not in Scope)

-  Multiple GitHub repos per request
-  Telegram/Slack direct notifications
-  Batch exploration of multiple ideas
-  Export to other formats (PDF, Notion, etc.)
-  Interactive/conversational exploration via Cloudflare Agents SDK
