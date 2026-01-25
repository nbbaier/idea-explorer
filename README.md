# Idea Explorer

A Cloudflare Worker that explores and analyzes ideas using Claude, committing research results to a GitHub repository via the GitHub Contents API.

## Features

-  **Two analysis modes**: Business viability analysis or creative exploration
-  **Model selection**: Choose between Claude Sonnet or Opus
-  **Duplicate detection**: Automatically finds existing research for the same idea
-  **Update mode**: Append new analysis to existing research
-  **Webhook notifications**: Get notified when exploration completes (with optional HMAC signing)
-  **Job status tracking**: Query job status via API
-  **GitHub Issues integration**: Submit ideas via GitHub issues for automated exploration ([setup guide](./.github/GITHUB_ISSUES_INTEGRATION.md))

## Architecture

The service uses direct HTTP API calls for simplicity and performance:

- **Anthropic Messages API** for Claude research generation
- **GitHub Contents API** for reading/writing files
- **Cloudflare Workflows** for durable execution with automatic retries

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare Worker                          │
│  POST /api/explore → Create Job (KV) → Trigger Workflow         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Workflow                           │
│  initialize → check-existing → generate-research → write-github │
│  → notify                                                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
          Anthropic API             GitHub Contents API
```

## Setup

### 1. Configure Environment Variables

Edit `wrangler.jsonc` to set your production GitHub repository and branch:

```jsonc
"vars": {
  "GH_REPO": "your-username/repo-name",
  "GH_BRANCH": "main"
}
```

For local development, set these in `.dev.vars` instead (see [Local Development](#local-development)).

### 2. Configure KV Namespace

Create a KV namespace for job storage and update `wrangler.jsonc` with the IDs:

```bash
wrangler kv namespace create IDEA_EXPLORER_JOBS
wrangler kv namespace create IDEA_EXPLORER_JOBS --preview
```

### 3. Set Up Cloudflare Secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GH_PAT
wrangler secret put IDEA_EXPLORER_API_TOKEN
# Optional: Set a default webhook URL
wrangler secret put IDEA_EXPLORER_WEBHOOK_URL
```

| Secret                      | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | API key for Claude (get from console.anthropic.com)                          |
| `GH_PAT`                | Personal access token with `repo` scope for writing to the ideas repository  |
| `IDEA_EXPLORER_API_TOKEN`   | Token used to authenticate API requests (generate a strong random string)    |
| `IDEA_EXPLORER_WEBHOOK_URL` | (Optional) Default webhook URL for job completion notifications              |

### 4. Deploy

```bash
bun run deploy
```

## Usage

### Option 1: Submit via GitHub Issues (Recommended for casual use)

The easiest way to submit ideas is through GitHub issues:

1. Create a new issue in this repository
2. Add a descriptive title with your idea
3. Add the `idea` label
4. Wait for the automated workflow to process it

The system will automatically:
- Submit your idea for exploration
- Update you with a Job ID
- Post the research link when complete

**Setup guides:**
- **[Quick Start (5 minutes)](./.github/QUICKSTART.md)** - Get up and running fast
- **[Full setup guide](./.github/GITHUB_ISSUES_INTEGRATION.md)** - Detailed documentation

### Option 2: Direct API Access

### Start an Exploration

```bash
curl -X POST https://idea-explorer.your-domain.workers.dev/api/explore \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "AI-powered code review assistant",
    "webhook_url": "https://your-server.com/webhook",
    "callback_secret": "your-webhook-secret",
    "mode": "business",
    "model": "sonnet"
  }'
```

### Request Body

| Field             | Type                            | Required | Description                                     |
| ----------------- | ------------------------------- | -------- | ----------------------------------------------- |
| `idea`            | string                          | Yes      | The idea to explore                             |
| `webhook_url`     | string                          | No       | URL to receive completion callback              |
| `mode`            | `"business"` \| `"exploration"` | No       | Analysis framework (default: `"business"`)      |
| `model`           | `"sonnet"` \| `"opus"`          | No       | Claude model to use (default: `"sonnet"`)       |
| `callback_secret` | string                          | No       | Secret for HMAC-SHA256 webhook signature        |
| `context`         | string                          | No       | Additional context for the analysis             |
| `update`          | boolean                         | No       | Append to existing research instead of skipping |

### Check Status

```bash
curl https://idea-explorer.your-domain.workers.dev/api/status/{job_id} \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Response

```json
{
   "status": "completed",
   "idea": "AI-powered code review assistant",
   "mode": "business",
   "github_url": "https://github.com/user/ideas/blob/main/ideas/2025-01-07-ai-code-review/research.md"
}
```

### List Jobs

```bash
curl "https://idea-explorer.your-domain.workers.dev/api/jobs?status=completed&mode=business&limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

| Query Param | Type                            | Description                              |
| ----------- | ------------------------------- | ---------------------------------------- |
| `status`    | `"pending"` \| `"running"` \| `"completed"` \| `"failed"` | Filter by job status          |
| `mode`      | `"business"` \| `"exploration"` | Filter by analysis mode                  |
| `limit`     | number                          | Max results to return (1-100, default 20)|
| `offset`    | number                          | Pagination offset (default 0)            |

### Check Workflow Status

```bash
curl https://idea-explorer.your-domain.workers.dev/api/workflow-status/{job_id} \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

Returns the underlying Cloudflare Workflow instance status, output, and any errors.

## Project Structure

```
idea-explorer/
├── src/
│   ├── index.ts              # Main Hono app with API endpoints
│   ├── index.test.ts         # API endpoint tests
│   ├── jobs.ts               # Job types and KV storage functions
│   ├── jobs.test.ts          # Job storage tests
│   ├── cli/                   # CLI implementation
│   ├── clients/
│   │   ├── anthropic.ts      # Anthropic Messages API client
│   │   └── github.ts         # GitHub Contents API client
│   ├── prompts/
│   │   └── index.ts          # Embedded prompt templates
│   ├── types/
│   │   └── api.ts             # Shared API schemas
│   ├── workflows/
│   │   └── exploration.ts    # Cloudflare Workflow for exploration
│   ├── middleware/           # Auth middleware
│   └── utils/                # Webhook, logging, and helper utilities
├── dist/
│   └── cli/                   # Built CLI output
└── wrangler.jsonc            # Cloudflare Workers configuration
```

## API Reference

See [SPEC.md](./SPEC.md) for full API documentation including webhook specification and signature verification.

## Local Development

```bash
# Copy example env file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your local config:
# - ANTHROPIC_API_KEY
# - GH_PAT
# - IDEA_EXPLORER_API_TOKEN
# - GH_REPO
# - GH_BRANCH

# Then run the dev server
bun run dev
```

## Scripts

| Command              | Description                        |
| -------------------- | ---------------------------------- |
| `bun run dev`        | Start local development server     |
| `bun run deploy`     | Deploy to Cloudflare               |
| `bun run typecheck`  | Run TypeScript type checking       |
| `bun run check`      | Run Biome linter                   |
| `bun run fix`        | Auto-fix linting/formatting issues |
| `bun run test`       | Run tests (watch mode)             |
| `bun run test:run`   | Run tests once                     |
| `bun run status`     | Check idea exploration status      |
| `bun run cli:build`  | Build the CLI to `dist/cli`        |
| `bun run cli:dev`    | Watch/build the CLI with tsdown    |
