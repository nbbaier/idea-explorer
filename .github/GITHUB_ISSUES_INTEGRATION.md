# GitHub Issues Integration

This repository includes automated workflows that allow you to submit ideas via GitHub issues for automated exploration.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Issue Created                        │
│                    (with 'idea' label)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            Process Ideas Workflow (Hourly + On Event)           │
│  1. Detects new 'idea' label                                    │
│  2. Adds 'idea-processing' label                                │
│  3. Submits to /api/explore endpoint                            │
│  4. Posts comment with Job ID                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Idea Explorer Worker                           │
│  • Spins up Claude Code in sandbox                              │
│  • Analyzes idea (5-15 minutes)                                 │
│  • Commits research.md to GitHub repo                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         Update Status Workflow (Every 15 Minutes)               │
│  1. Checks /api/status/{job_id}                                 │
│  2. When complete:                                              │
│     • Removes 'idea-processing' label                           │
│     • Adds 'idea-completed' label                               │
│     • Posts comment with research link                          │
│     • Closes issue                                              │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Submit an Idea**: Create a new GitHub issue with the `idea` label
2. **Automatic Processing**: The workflow automatically picks up the issue and submits it to the Idea Explorer API
3. **Status Updates**: The system monitors the exploration job and updates your issue when complete
4. **Research Delivery**: Once complete, you'll receive a link to the research document

## Setup Instructions

### 1. Create GitHub Secrets

Add the following secrets to your repository (Settings → Secrets and variables → Actions):

- `IDEA_EXPLORER_API_URL`: The base URL of your deployed Idea Explorer worker (e.g., `https://idea-explorer.your-domain.workers.dev`)
- `IDEA_EXPLORER_API_TOKEN`: Your API bearer token for authentication

### 2. Create Labels

Create the following labels in your repository (Issues → Labels):

- `idea` - For new idea submissions (color: `#0E8A16`)
- `idea-processing` - Applied automatically when processing starts (color: `#FEF2C0`)
- `idea-completed` - Applied when exploration is complete (color: `#5319E7`)
- `idea-failed` - Applied when exploration fails (color: `#D73A4A`)

## Usage

### Submitting an Idea

1. Go to the **Issues** tab
2. Click **New Issue**
3. Add a descriptive title (this will be the main idea text)
4. (Optional) Add additional context in the issue body
5. Add the `idea` label
6. Click **Submit new issue**

**Example:**

```
Title: AI-powered code review assistant
Body: An assistant that learns from our team's code review patterns and suggests improvements automatically

Labels: idea
```

### Monitoring Progress

Once submitted:

1. The workflow will add the `idea-processing` label
2. A comment will be added with the Job ID
3. Every 15 minutes, the system checks if your exploration is complete
4. When done, you'll receive a comment with a link to the research document
5. The issue will be labeled `idea-completed` and automatically closed

### Manual Triggers

You can manually trigger the workflows from the **Actions** tab:

- **Process Idea Issues**: Manually check for new ideas to process
- **Update Idea Status**: Manually check for completed explorations

## Workflow Details

### Process Ideas Workflow

**Triggers:**
- When a new issue is opened
- When a label is added to an issue
- Every hour (scheduled)
- Manual trigger

**What it does:**
1. Finds all open issues with the `idea` label
2. Skips issues already being processed or completed
3. Submits each idea to the Idea Explorer API
4. Adds the `idea-processing` label
5. Posts a comment with the Job ID

### Update Status Workflow

**Triggers:**
- Every 15 minutes (scheduled)
- Manual trigger

**What it does:**
1. Finds all issues with the `idea-processing` label
2. Checks the status of each job via the API
3. When a job completes:
   - Updates the label to `idea-completed` or `idea-failed`
   - Adds a comment with the research link (on success)
   - Closes the issue (on success)

## Troubleshooting

### My issue wasn't picked up

- Make sure you added the `idea` label
- Check the Actions tab to see if the workflow ran
- Manually trigger the "Process Idea Issues" workflow

### The status hasn't updated

- Explorations can take up to 15 minutes
- The status update workflow runs every 15 minutes
- Manually trigger the "Update Idea Status" workflow to force a check

### My idea failed

- Check the error message in the issue comment
- Common issues:
  - API authentication problems (check your secrets)
  - Worker deployment issues
  - Timeout (idea was too complex)

## Integration with Existing API

These workflows use the existing `/api/explore` and `/api/status` endpoints. No changes to the Idea Explorer worker are required - this is a pure GitHub Actions integration.

## Cost Considerations

- GitHub Actions minutes are free for public repositories
- For private repositories, check your GitHub Actions quota
- The workflows run:
  - Process Ideas: Hourly + on issue events
  - Update Status: Every 15 minutes
  - Estimated monthly usage: ~1,000-2,000 minutes/month (depending on activity)
