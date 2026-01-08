# Idea Explorer

A Cloudflare Container-based service that runs autonomous Claude Code sessions to explore and analyze ideas, committing results to a GitHub repository.

## Setup

### 1. Configure Environment Variables

Edit `wrangler.jsonc` to set your GitHub repository and branch:

```jsonc
"vars": {
  "GITHUB_REPO": "your-username/ideas",
  "GITHUB_BRANCH": "main"
}
```

### 2. Set Up Cloudflare Secrets

The service requires three secrets. Set them using the Wrangler CLI:

```bash
# Anthropic API key for Claude Code
wrangler secret put ANTHROPIC_API_KEY

# GitHub Personal Access Token with repo write access
wrangler secret put GITHUB_PAT

# Bearer token for API authentication
wrangler secret put API_BEARER_TOKEN
```

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | API key for Claude (get from console.anthropic.com) |
| `GITHUB_PAT` | Personal access token with `repo` scope for writing to the ideas repository |
| `API_BEARER_TOKEN` | Token used to authenticate API requests (generate a strong random string) |

### 3. Deploy

```bash
wrangler deploy
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
    "mode": "business"
  }'
```

### Check Status

```bash
curl https://idea-explorer.your-domain.workers.dev/status/{job_id} \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

## API Reference

See [SPEC.md](./SPEC.md) for full API documentation.

## Local Development

```bash
# Copy example env file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your secrets
# Then run the dev server
bun run dev
```
