# Idea Explorer

A Cloudflare Worker that explores and analyzes ideas using Claude, committing research results to a GitHub repository.

## Features

- **Two analysis modes**: Business viability analysis or creative exploration
- **Model selection**: Choose between Claude Sonnet or Opus
- **Duplicate detection**: Automatically finds existing research for the same idea
- **Update mode**: Append new analysis to existing research
- **Webhook notifications**: Get notified when exploration completes (with optional HMAC signing)
- **Job status tracking**: Query job status via API
- **GitHub Issues integration**: Submit ideas via GitHub issues for automated exploration

## Architecture

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

### Prerequisites

- [Bun](https://bun.sh) runtime
- Cloudflare account
- Anthropic API key
- GitHub Personal Access Token with `repo` scope

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Create a `.dev.vars` file for local development (see `.dev.vars.example`):

```bash
cp .dev.vars.example .dev.vars
```

Required variables:

| Variable                    | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | API key for Claude (from console.anthropic.com)                   |
| `GH_PAT`                    | Personal access token with `repo` scope                           |
| `GH_REPO`                   | Target repository for research (e.g., `user/ideas`)               |
| `GH_BRANCH`                 | Branch to commit to (e.g., `main`)                                |
| `IDEA_EXPLORER_API_TOKEN`   | Token for authenticating API requests                             |
| `ALCHEMY_PASSWORD`          | Password for Alchemy state encryption                             |

### 3. Deploy

This project uses [Alchemy](https://alchemy.run) for infrastructure as code:

```bash
bun run deploy
```

## Usage

### Option 1: GitHub Issues

Create a new issue with the `idea` label—the system will automatically explore it.

**Setup guides:**
- [Quick Start](./.github/QUICKSTART.md)
- [Full setup guide](./.github/GITHUB_ISSUES_INTEGRATION.md)

### Option 2: API

#### Start an Exploration

```bash
curl -X POST https://your-worker.workers.dev/api/explore \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idea": "AI-powered code review assistant",
    "mode": "business",
    "model": "sonnet"
  }'
```

| Field             | Type                            | Required | Description                                     |
| ----------------- | ------------------------------- | -------- | ----------------------------------------------- |
| `idea`            | string                          | Yes      | The idea to explore                             |
| `mode`            | `"business"` \| `"exploration"` | No       | Analysis framework (default: `"business"`)      |
| `model`           | `"sonnet"` \| `"opus"`          | No       | Claude model to use (default: `"sonnet"`)       |
| `webhook_url`     | string                          | No       | URL to receive completion callback              |
| `callback_secret` | string                          | No       | Secret for HMAC-SHA256 webhook signature        |
| `context`         | string                          | No       | Additional context for the analysis             |
| `update`          | boolean                         | No       | Append to existing research instead of skipping |

#### Check Status

```bash
curl https://your-worker.workers.dev/api/status/{job_id} \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

#### List Jobs

```bash
curl "https://your-worker.workers.dev/api/jobs?status=completed&limit=10" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

## Project Structure

```
src/
├── index.ts              # Main Hono app with API endpoints
├── jobs.ts               # Job types and KV storage
├── errors.ts             # Error definitions
├── cli/                  # CLI implementation
├── clients/              # API clients (Anthropic, GitHub)
├── middleware/           # Auth middleware
├── prompts/              # Embedded prompt templates
├── types/                # Shared API schemas
├── utils/                # Webhook, logging, and helpers
└── workflows/            # Cloudflare Workflow for exploration
```

## Scripts

| Command              | Description                        |
| -------------------- | ---------------------------------- |
| `bun run dev`        | Start local development server     |
| `bun run deploy`     | Deploy to Cloudflare               |
| `bun run destroy`    | Tear down deployed resources       |
| `bun run typecheck`  | Run TypeScript type checking       |
| `bun run check`      | Run Biome linter                   |
| `bun run fix`        | Auto-fix linting/formatting issues |
| `bun run test`       | Run tests (watch mode)             |
| `bun run test:run`   | Run tests once                     |
| `bun run build:cli`  | Build the CLI                      |
| `bun run dev:cli`    | Watch/build the CLI                |

## Tech Stack

- **Runtime**: Cloudflare Workers with Workflows
- **Framework**: Hono
- **Infrastructure**: Alchemy
- **APIs**: Anthropic AI SDK, Octokit (GitHub)
- **Validation**: Zod
- **Testing**: Vitest
- **Linting**: Biome via Ultracite
