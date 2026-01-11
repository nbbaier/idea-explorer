# Quick Start: GitHub Issues as Idea Dropbox

This guide gets you up and running with the GitHub Issues integration in under 5 minutes.

## Prerequisites

- A deployed Idea Explorer instance (see main README for deployment)
- Repository admin access to configure secrets

## Setup (5 minutes)

### Step 1: Configure Secrets (2 minutes)

Go to your repository **Settings → Secrets and variables → Actions** and add:

1. **`IDEA_EXPLORER_API_URL`**
   - Example: `https://idea-explorer.your-domain.workers.dev`
   - This is your deployed Cloudflare Worker URL

2. **`IDEA_EXPLORER_API_TOKEN`**
   - This is the same as your `API_BEARER_TOKEN` secret from Wrangler
   - Get it with: `wrangler secret list` or check your secrets manager

### Step 2: Create Labels (2 minutes)

Go to **Issues → Labels** and create these labels:

| Label | Color | Description |
|-------|-------|-------------|
| `idea` | `#0E8A16` (green) | Marks issues for automatic processing |
| `idea-processing` | `#FEF2C0` (yellow) | Automatically added when processing starts |
| `idea-completed` | `#5319E7` (purple) | Automatically added when exploration completes |
| `idea-failed` | `#D73A4A` (red) | Automatically added when exploration fails |

### Step 3: Test It! (1 minute)

1. Go to **Issues → New Issue**
2. Choose **"💡 Submit an Idea"** template
3. Fill in your idea (e.g., "AI-powered workout planner")
4. Click **Submit new issue**
5. Go to **Actions** tab and manually run **"Process Idea Issues"** workflow
6. Watch the magic happen! 🎉

## What Happens Next?

1. **Within seconds**: The workflow adds the `idea-processing` label
2. **Within 1 minute**: A comment appears with your Job ID
3. **Within 15 minutes**: The AI completes the analysis
4. **Automatically**: You get a comment with the research link and the issue closes

## Troubleshooting

### "Workflow doesn't run"
- Check that you added the secrets correctly
- Make sure you created the `idea` label
- Try manually triggering from the Actions tab

### "API returns 401 Unauthorized"
- Double-check your `IDEA_EXPLORER_API_TOKEN` secret
- Verify it matches your deployed Worker's `API_BEARER_TOKEN`

### "Job never completes"
- Check your Cloudflare Worker logs
- Verify the Worker has the correct `ANTHROPIC_API_KEY` and `GITHUB_PAT` secrets
- The exploration can take up to 15 minutes

## Advanced Usage

### Customize Analysis Mode

Edit the workflow file `.github/workflows/process-ideas.yml` and change:

```bash
"mode": "business",     # Change to "exploration" for creative analysis
"model": "sonnet"       # Change to "opus" for more detailed analysis
```

### Change Schedules

Edit the `cron` schedules in the workflow files:
- `process-ideas.yml`: Change `'0 * * * *'` (hourly) to your preference
- `update-idea-status.yml`: Change `'*/15 * * * *'` (every 15 min) to your preference

## That's It!

You now have a fully automated idea exploration system. Just create issues with the `idea` label and let the AI do the rest!

For more details, see [GITHUB_ISSUES_INTEGRATION.md](./GITHUB_ISSUES_INTEGRATION.md)
