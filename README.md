# Idea Explorer

A Cloudflare Container-based service that runs autonomous Claude Code sessions to explore and analyze ideas, committing results to a GitHub repository.

## Features

-  **Two analysis modes**: Business viability analysis or creative exploration
-  **Model selection**: Choose between Claude Sonnet or Opus
-  **Duplicate detection**: Automatically finds existing research for the same idea
-  **Update mode**: Append new analysis to existing research
-  **Webhook notifications**: Get notified when exploration completes (with optional HMAC signing)
-  **Job status tracking**: Query job status via API

## Setup

### 1. Configure Environment Variables

Edit `wrangler.jsonc` to set your GitHub repository and branch:

```jsonc
"vars": {
  "GITHUB_REPO": "your-username/repo-name",
  "GITHUB_BRANCH": "main"
}
```

### 2. Configure KV Namespace

Create a KV namespace for job storage and update `wrangler.jsonc` with the IDs:

```bash
wrangler kv namespace create IDEA_EXPLORER_JOBS
wrangler kv namespace create IDEA_EXPLORER_JOBS --preview
```

### 3. Set Up Cloudflare Secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GITHUB_PAT
wrangler secret put API_BEARER_TOKEN
```

| Secret              | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | API key for Claude (get from console.anthropic.com)                         |
| `GITHUB_PAT`        | Personal access token with `repo` scope for writing to the ideas repository |
| `API_BEARER_TOKEN`  | Token used to authenticate API requests (generate a strong random string)   |
| `WEBHOOK_URL`       | (Optional) Default webhook URL for job completion notifications             |

### 4. Deploy

```bash
bun run deploy
```

## Usage

### Start an Exploration

```bash
curl -X POST https://idea-explorer.your-domain.workers.dev/explore \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "AI-powered code review assistant",
    "webhook_url": "https://your-server.com/webhook",
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
curl https://idea-explorer.your-domain.workers.dev/status/{job_id} \
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

## Project Structure

```
idea-explorer/
├── src/
│   ├── index.ts          # Main Hono app with /explore and /status endpoints
│   ├── jobs.ts           # Job types and KV storage functions
│   ├── middleware/       # Auth middleware
│   └── utils/            # Git, webhook, logging, and helper utilities
├── prompts/
│   ├── business.md       # Business analysis framework template
│   └── exploration.md    # Creative exploration framework template
├── Dockerfile            # Container image with Claude Code CLI
└── wrangler.jsonc        # Cloudflare Workers configuration
```

## API Reference

See [SPEC.md](./SPEC.md) for full API documentation including webhook specification and signature verification.

## Local Development

```bash
# Copy example env file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your secrets
# Then run the dev server
bun run dev
```

## Scripts

| Command             | Description                    |
| ------------------- | ------------------------------ |
| `bun run dev`       | Start local development server |
| `bun run deploy`    | Deploy to Cloudflare           |
| `bun run check`     | Run Biome linter               |
| `bun run typecheck` | Run TypeScript type checking   |
