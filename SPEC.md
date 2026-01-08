# Idea Explorer - Cloudflare Sandbox Specification

A Cloudflare Container-based service that runs autonomous Claude Code sessions to explore and analyze ideas, committing results to a GitHub repository.

## Overview

The service accepts ideas via API, spins up a Claude Code session in a sandboxed container, runs analysis using one of two frameworks (business or exploration), and commits the research output to a GitHub repository. Results are delivered via webhook with HMAC signature verification.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                          │
│                                                                   │
│  POST /explore ──► Validate ──► Check GitHub for duplicates       │
│                        │                    │                     │
│                        │              ┌─────▼─────┐               │
│                        │              │  Exists?  │               │
│                        │              └─────┬─────┘               │
│                        │           Yes      │      No             │
│                        │        ┌───────────┴───────────┐         │
│                        │        ▼                       ▼         │
│                   Return existing URL         Spawn Container     │
│                                                     │             │
│  GET /status/{id} ◄───────────────────────────────► │             │
│                                                     │             │
└─────────────────────────────────────────────────────┼─────────────┘
                                                      │
                    ┌─────────────────────────────────▼─────────────┐
                    │              Sandbox Container                │
                    │                                               │
                    │  1. Clone ideas repo (fresh each time)        │
                    │  2. Run Claude Code with analysis prompt      │
                    │  3. Write research.md                         │
                    │  4. Git commit + push                         │
                    │  5. Call webhook (with retry)                 │
                    │                                               │
                    └───────────────────────────────────────────────┘
```

---

## API Specification

### POST /explore

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
}
```

**Success Response (202 Accepted):**

```json
{
   "job_id": "abc123",
   "status": "pending"
}
```

**Duplicate Response (200 OK):**

```json
{
   "status": "exists",
   "github_url": "https://github.com/user/ideas/blob/main/ideas/2025-01-07-ai-calendar/research.md"
}
```

**Error Responses:**

-  `400 Bad Request` - Missing required fields
-  `401 Unauthorized` - Invalid or missing bearer token

---

### GET /status/{job_id}

Check the status of an exploration job.

**Authentication:** Bearer token in `Authorization` header

**Response:**

```json
{
  "job_id": "abc123",
  "status": "pending" | "running" | "completed" | "failed",
  "idea": "AI calendar assistant",
  "mode": "business",
  "github_url": "https://github.com/...",  // Present when completed
  "error": "Error message"                  // Present when failed
}
```

---

## Webhook Specification

When a job completes (success or failure), the service POSTs to the webhook URL (either from the request `webhook_url` field or the `WEBHOOK_URL` environment variable).

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
-  Webhook considered delivered if response is 2xx

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

-  What specific problem does this solve?
-  Who experiences this problem and how often?
-  What's the current workaround?
-  How painful is this problem (1-10)?

## 2. Market Assessment

-  Target market definition
-  Market size estimation (TAM/SAM/SOM)
-  Existing solutions and competitors
-  Key differentiators

## 3. Technical Feasibility

-  Core technical requirements
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

Before starting an exploration:

1. Query GitHub API for existing files matching the slug (any date)
2. If found, return `{status: 'exists', github_url: '...'}` without starting a new job
3. If not found, proceed with exploration

### Git Operations

1. Clone ideas repo fresh (ensures latest state, handles parallel jobs)
2. Create directory: `ideas/YYYY-MM-DD-<slug>/`
3. Write `research.md`
4. Commit with message: `idea: <slug> - research complete`
5. Push to main branch

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

| Name            | Description                            |
| --------------- | -------------------------------------- |
| `GITHUB_REPO`   | Target repository (e.g., `user/ideas`) |
| `GITHUB_BRANCH` | Branch to commit to (default: `main`)  |

---

## Observability

### Logging (Standard Level)

Log the following events:

-  Job created: `{job_id, idea, mode, timestamp}`
-  Container started: `{job_id, container_id}`
-  Clone complete: `{job_id, duration_ms}`
-  Claude started: `{job_id, model}`
-  Research written: `{job_id, file_size}`
-  Commit pushed: `{job_id, commit_sha}`
-  Webhook sent: `{job_id, status_code, attempt}`
-  Job complete: `{job_id, status, total_duration_ms}`

### Cloudflare Analytics

Enable observability in wrangler.jsonc for built-in metrics.

---

## Error Handling

### Container Failures

-  Timeout (15 min): Mark job as failed, report in webhook
-  Clone failure: Retry once, then fail
-  Push failure: Retry once with fresh pull, then fail
-  Claude error: Capture stderr, include in failure webhook

### Webhook Failures

After 3 failed delivery attempts:

-  Log the failure
-  Job status remains queryable via GET /status/{id}
-  Include webhook delivery status in status response

---

## Security Considerations

1. **API Authentication:** Bearer token required for all endpoints
2. **Webhook Signing:** HMAC-SHA256 signature for payload verification
3. **GitHub Access:** Fine-grained PAT scoped to ideas repo only
4. **Container Isolation:** Each exploration runs in fresh container
5. **Secrets Management:** All sensitive values in Cloudflare secrets

---

## Implementation Checklist

-  [ ] Update Dockerfile with 15min timeout and prompts
-  [ ] Create business.md and exploration.md prompt templates
-  [ ] Implement POST /explore endpoint
-  [ ] Implement GET /status/{id} endpoint
-  [ ] Add bearer token authentication
-  [ ] Implement GitHub duplicate detection
-  [ ] Implement git clone/commit/push workflow
-  [ ] Implement webhook delivery with HMAC signing
-  [ ] Implement retry logic for webhooks
-  [ ] Add Cloudflare secrets for API keys
-  [ ] Test end-to-end flow
-  [ ] Deploy to Cloudflare

---

## Example Usage

```bash
# Start a business analysis
curl -X POST https://idea-explorer.your-domain.workers.dev/explore \
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
curl https://idea-explorer.your-domain.workers.dev/status/a1b2c3d4 \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# Response (when complete)
{
  "job_id": "a1b2c3d4",
  "status": "completed",
  "idea": "AI-powered code review assistant that learns team patterns",
  "github_url": "https://github.com/user/ideas/blob/main/ideas/2025-01-07-ai-code-review/research.md"
}
```

---

## Future Considerations (Not in Scope)

-  Multiple GitHub repos per request
-  Telegram/Slack direct notifications
-  Batch exploration of multiple ideas
-  Re-run with force flag to update existing research
-  Export to other formats (PDF, Notion, etc.)
