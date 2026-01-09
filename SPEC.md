# Idea Explorer - Cloudflare Sandbox Specification

A Cloudflare Container-based service that runs autonomous Claude Code sessions to explore and analyze ideas, committing results to a GitHub repository.

## Overview

The service accepts ideas via API, spins up a Claude Code session in a sandboxed container, runs analysis using one of two frameworks (business or exploration), and commits the research output to a GitHub repository. Results are delivered via webhook with HMAC signature verification.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Worker                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  POST /api/explore ──► Validate ──► Return 202 + job_id                 │
│                                           │                             │
│                                           ▼                             │
│                                    Spawn Container ──────────────────┐  │
│                                                                      │  │
│  GET /api/status/{id} ◄─── Poll for status (reads from KV) ─────┐    │  │
│  GET /api/health                                                │    │  │
│  GET /api/test-webhook                                          │    │  │
│                                                                 │    │  │
└─────────────────────────────────────────────────────────────────┼────┼──┘
                                                                  │    │
                  ┌───────────────────────────────────────────────┼────▼──┐
                  │              Sandbox Container                │       │
                  │                                               │       │
                  │  1. Clone ideas repo (sparse checkout)        │       │
                  │  2. Check for existing idea folder            │       │
                  │     ├─ exists & update=false → use existing   │       |
                  │     └─ exists & update=true → append update   │       │
                  │  3. Run Claude Code with analysis prompt      │       │
                  │  4. Write research.md                      ───┘       │
                  │  5. Git commit + push               (updates KV)      │
                  │  6. Call webhook (with retry)                         │
                  │                                                       │
                  └───────────────────────────────────────────────────────┘
```

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
- With `update: false` (default): Job completes quickly with the existing `github_url`
- With `update: true`: A new `## Update - YYYY-MM-DD` section is appended to the existing research

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

**Error Response (404 Not Found):**

```json
{
  "error": "Job not found"
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

| Parameter         | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `webhook_url`     | Optional: Target URL (defaults to `WEBHOOK_URL` env) |
| `status`          | Optional: `completed` or `failed` (default: `completed`) |
| `callback_secret` | Optional: Secret for HMAC signature                  |

**Response:**

```json
{
  "message": "Webhook test sent",
  "webhook_url": "https://...",
  "status": "completed",
  "result": { "success": true, "attempts": 1, "statusCode": 200 }
}
```

Note: Test webhooks include an `X-Test-Webhook: true` header.

---

## Webhook Specification

Webhooks are sent when a job completes (success or failure), **only if** a webhook URL is available (from the request `webhook_url` field or the `WEBHOOK_URL` environment variable).

**Headers:**

```
Content-Type: application/json
X-Signature: sha256=<HMAC-SHA256 of body using callback_secret>  (only if callback_secret was provided)
```

**Success Payload:**

```json
{
   "status": "completed",
   "job_id": "abc123",
   "idea": "AI calendar assistant",
   "github_url": "https://github.com/user/ideas/blob/main/ideas/2025-01-07-ai-calendar/research.md",
   "github_raw_url": "https://raw.githubusercontent.com/user/ideas/main/ideas/2025-01-07-ai-calendar/research.md"
}
```

**Failure Payload:**

```json
{
   "status": "failed",
   "job_id": "abc123",
   "idea": "AI calendar assistant",
   "error": "Timeout exceeded"
}
```

**Retry Logic:**

-  3 attempts with exponential backoff: 1s, 5s, 30s
-  Webhook considered delivered if response status is 2xx or 3xx (`response.ok`)

### Webhook Signature Verification

When you provide a `callback_secret` in your explore request, the service signs the webhook payload using HMAC-SHA256. This allows you to verify that webhooks are authentic and haven't been tampered with.

**How it works:**

1. You provide a `callback_secret` when creating an exploration job
2. When the job completes, the service computes an HMAC-SHA256 signature of the JSON body using your secret
3. The signature is sent in the `X-Signature` header with format: `sha256=<hex_encoded_signature>`
4. Your webhook endpoint verifies the signature by computing the same HMAC and comparing

**Example verification (Node.js):**

```javascript
// Example verification (Node.js/Express):
// To verify the signature, you MUST use the raw request body.
// If using express.json(), you can capture the raw body like this:
// app.use(express.json({
//   verify: (req, res, buf) => { req.rawBody = buf }
// }));

const crypto = require("crypto");

function verifyWebhookSignature(rawBody, signature, secret) {
   const expectedSignature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

   return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
   );
}

// In your webhook handler:
app.post("/webhook", (req, res) => {
   const signature = req.headers["x-signature"];
   const rawBody = req.rawBody; // Use the captured raw Buffer

   if (
      !rawBody ||
      !verifyWebhookSignature(rawBody, signature, process.env.CALLBACK_SECRET)
   ) {
      return res.status(401).send("Invalid signature");
   }

   const payload = req.body; // The already parsed body
   // Process the webhook...
});
```

**Example verification (Python/Flask):**

```python
import hmac
import hashlib
from flask import Flask, request

def verify_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        body,
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Signature')
    # Use request.get_data() to get the raw request body as bytes
    body = request.get_data()

    if not verify_webhook_signature(body, signature, 'your-secret'):
        return 'Invalid signature', 401

    payload = request.get_json()
    # Process the webhook...
    return 'OK', 200
```

**Security recommendations:**

-  Use a cryptographically random secret (minimum 32 characters)
-  Always use constant-time comparison to prevent timing attacks
-  Verify the signature before processing the webhook payload
-  Store the secret securely (environment variable or secrets manager)

---

## Analysis Frameworks

### Business Mode (default)

Focused analysis for evaluating business viability:

```markdown
# [Idea Title]

## 1. Problem Analysis

-  What problem does this solve?
-  Who has this problem?
-  How painful is the problem?

## 2. Market Analysis

-  Market size and dynamics
-  Existing solutions and competitors
-  Differentiation opportunities

## 3. Technical Feasibility

-  Build vs buy decisions
-  MVP scope and complexity
-  Major technical risks

## 4. Verdict

**Recommendation:** STRONG YES | CONDITIONAL YES | PIVOT | PASS

[2-3 paragraph reasoning]

**If pursuing, first steps:**

1. [Immediate action]
2. [Validation experiment]
3. [Key decision to make]
```

### Exploration Mode

Divergent thinking for creative exploration:

```markdown
# [Idea Title] - Exploration

## Core Insight Deconstruction

[First principles breakdown of the underlying insight]

## Directions to Explore

### Direction 1: [Name]

-  **Description:** [What this direction looks like]
-  **Why it could work:** [Key advantages]
-  **Risks:** [What could go wrong]
-  **First step:** [How to start exploring this]

### Direction 2: [Name]

...

### Direction 3: [Name]

...

[Continue for 5-10 directions]

## Unexpected Connections

[Adjacent ideas, unusual combinations, what-if scenarios]

## Questions Worth Answering

[Key unknowns that would unlock clarity]
```

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
│   └── research.md
├── 2025-01-08-code-review-bot/
│   └── research.md
└── ...
```

**Naming Convention:** `ideas/YYYY-MM-DD-<slug>/research.md`

### Duplicate Detection

After cloning the repository:

1. Check local folder names for any matching `*-<slug>` pattern (any date prefix)
2. If found and `update: false`: Complete job immediately with existing `github_url`
3. If found and `update: true`: Append update section to existing research
4. If not found: Proceed with new exploration

### Git Operations

1. Clone ideas repo with sparse checkout of `ideas/` directory
2. Create directory: `ideas/YYYY-MM-DD-<slug>/` (or reuse existing folder for updates)
3. Write `research.md`
4. Commit with message:
   - New: `idea: <slug> - research complete`
   - Update: `idea: <slug> - research updated`
5. Push to configured branch (with retry on failure)

**Authentication:** GitHub PAT stored in Cloudflare secrets

---

## Container Configuration

### Dockerfile

```dockerfile
FROM docker.io/cloudflare/sandbox:0.6.10

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Bake in analysis prompts
COPY prompts/ /prompts/

# 15 minute timeout
ENV COMMAND_TIMEOUT_MS=900000

EXPOSE 3000
```

### Prompts Directory

```
prompts/
├── business.md    # Business analysis framework
└── exploration.md # Exploration framework
```

---

## Environment Variables & Secrets

### Cloudflare Secrets (via wrangler secret put)

| Name                | Description                                  |
| ------------------- | -------------------------------------------- |
| `ANTHROPIC_API_KEY` | API key for Claude                           |
| `GITHUB_PAT`        | Personal access token with repo write access |
| `API_BEARER_TOKEN`  | Token for authenticating API requests        |

### Worker Environment

| Name            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `GITHUB_REPO`   | Target repository (e.g., `user/ideas`)                  |
| `GITHUB_BRANCH` | Branch to commit to (default: `main`)                   |
| `WEBHOOK_URL`   | Optional default webhook URL when request omits one     |

### Job Storage

Jobs are persisted in Cloudflare KV. The KV namespace binding is configured in `wrangler.jsonc`.

---

## Observability

### Logging (Standard Level)

Log the following events:

-  `job_created`: `{job_id, idea, mode, timestamp}`
-  `container_started`: `{job_id}`
-  `clone_complete`: `{job_id, duration_ms}`
-  `claude_started`: `{job_id, model}`
-  `claude_complete`: `{job_id}`
-  `commit_pushed`: `{job_id}`
-  `webhook_sent`: `{job_id, status_code, attempt}`
-  `job_complete`: `{job_id, status, total_duration_ms}`
-  `existing_idea_found`: `{job_id, folder}`
-  `exploration_failed`: `{job_id, error}`

### Cloudflare Analytics

Enable observability in wrangler.jsonc for built-in metrics.

---

## Error Handling

### Container Failures

-  Timeout (15 min): Mark job as failed with message "Container execution timed out (15 minute limit exceeded)"
-  Clone failure: Retry once, then fail
-  Push failure: Retry once with fresh pull, then fail
-  Claude error: Capture error message, include in failure webhook

### Webhook Failures

After 3 failed delivery attempts:

-  Log the failure
-  Job status remains queryable via GET /api/status/{id}

---

## Security Considerations

1. **API Authentication:** Bearer token required for all `/api/*` endpoints
2. **Webhook Signing:** HMAC-SHA256 signature for payload verification
3. **GitHub Access:** Fine-grained PAT scoped to ideas repo only
4. **Container Isolation:** Each exploration runs in fresh container
5. **Secrets Management:** All sensitive values in Cloudflare secrets

---

## Implementation Checklist

-  [x] Update Dockerfile with 15min timeout and prompts
-  [x] Create business.md and exploration.md prompt templates
-  [x] Implement POST /api/explore endpoint
-  [x] Implement GET /api/status/{id} endpoint
-  [x] Implement GET /api/health endpoint
-  [x] Implement GET /api/test-webhook endpoint
-  [x] Add bearer token authentication
-  [x] Implement duplicate detection (via repo contents)
-  [x] Implement update mode for re-running existing ideas
-  [x] Implement git clone/commit/push workflow with retries
-  [x] Implement webhook delivery with HMAC signing
-  [x] Implement retry logic for webhooks
-  [x] Add Cloudflare secrets for API keys
-  [x] Add KV-based job storage
-  [ ] Test end-to-end flow
-  [ ] Deploy to Cloudflare

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
