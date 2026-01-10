# Plan: Migrate to Cloudflare Workflows

## Problem

The current implementation uses `waitUntil()` to run long-running exploration jobs. This causes the error:

> "IoContext timed out due to inactivity, waitUntil tasks were cancelled without completing."

The IoContext times out when there's no I/O activity for extended periods during long-running `sandbox.exec()` calls (especially during Claude Code execution).

## Solution

Replace `waitUntil()` with Cloudflare Workflows - a durable execution engine with automatic retries and state persistence between steps.

## Files to Modify/Create

| File | Action |
|------|--------|
| `src/workflows/exploration.ts` | Create - Workflow class definition |
| `src/index.ts` | Modify - Trigger workflow instead of waitUntil |
| `wrangler.jsonc` | Modify - Add workflow binding |
| `worker-configuration.d.ts` | Regenerate - Add workflow types |
| `SPEC.md` | Update - Document new architecture |

## Implementation Steps

### Step 1: Create the Workflow Class (`src/workflows/exploration.ts`)

Define `ExplorationWorkflow` extending `WorkflowEntrypoint<Env, JobParams>`:

```typescript
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

type JobParams = {
  jobId: string;
  idea: string;
  mode: 'business' | 'exploration';
  model: 'sonnet' | 'opus';
  context?: string;
  update?: boolean;
  webhook_url?: string;
  callback_secret?: string;
};

export class ExplorationWorkflow extends WorkflowEntrypoint<Env, JobParams> {
  async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
    // Step 1: Initialize and update job status
    // Step 2: Setup sandbox and clone repo
    // Step 3: Run Claude Code exploration
    // Step 4: Commit and push results
    // Step 5: Send webhook notification
  }
}
```

**Workflow Steps:**

1. **`initialize`** - Update job status to "running", generate slug, get date prefix
2. **`setup-sandbox`** - Get sandbox, set env vars, clone repo with retry
3. **`check-existing`** - Check for existing idea folder
   - If exists and `update=false`: Complete early with existing URL
   - If exists and `update=true`: Continue to append update section
   - If not exists: Continue with new exploration
4. **`run-claude`** - Execute Claude Code in sandbox (timeout: 15 min)
5. **`commit-push`** - Commit and push results to GitHub
6. **`notify`** - Update job status in KV and send webhook

### Step 2: Update wrangler.jsonc

Add workflow configuration:

```jsonc
"workflows": [
  {
    "name": "exploration-workflow",
    "binding": "EXPLORATION_WORKFLOW",
    "class_name": "ExplorationWorkflow"
  }
]
```

### Step 3: Modify API Endpoint (`src/index.ts`)

Replace the current `waitUntil()` approach:

```typescript
// Before
c.executionCtx.waitUntil(runExploration(job, c.env));

// After
await c.env.EXPLORATION_WORKFLOW.create({
  id: job.id,
  params: {
    jobId: job.id,
    idea: job.idea,
    mode: job.mode,
    model: job.model,
    context: job.context,
    update: job.update,
    webhook_url: job.webhook_url,
    callback_secret: job.callback_secret,
  },
});
```

### Step 4: Add Workflow Status Endpoint

Add `GET /api/workflow-status/:id` to expose native Cloudflare workflow status:

```typescript
app.get("/api/workflow-status/:id", async (c) => {
  const jobId = c.req.param("id");
  try {
    const instance = await c.env.EXPLORATION_WORKFLOW.get(jobId);
    const status = await instance.status();
    return c.json({
      workflow_status: status.status,
      output: status.output,
      error: status.error
    });
  } catch (error) {
    return c.json({ error: "Workflow instance not found" }, 404);
  }
});
```

This provides granular workflow state: `queued`, `running`, `paused`, `complete`, `errored`, `terminated`, `waiting`.

### Step 5: Update Types

Run `bun types` to regenerate `worker-configuration.d.ts` with the new `EXPLORATION_WORKFLOW` binding.

### Step 6: Export Workflow Class

Update exports in `src/index.ts`:

```typescript
export default app;
export { Sandbox };
export { ExplorationWorkflow } from './workflows/exploration';
```

## Workflow Step Configuration

| Step | Timeout | Retries | Notes |
|------|---------|---------|-------|
| initialize | 30s | 3 | KV operations only |
| setup-sandbox | 2 min | 2 | Clone can be slow |
| check-existing | 30s | 3 | Simple ls command |
| run-claude | 15 min | 1 | Main long-running step |
| commit-push | 2 min | 3 | Git operations with retry |
| notify | 30s | 3 | Webhook with retry |

## Key Considerations

1. **Sandbox Access**: The Sandbox Durable Object binding is accessible from within the Workflow because the Workflow runs in the same Worker environment with the same bindings.

2. **Idempotency**: Each step should handle being re-run. The `step.do()` caches results, so a step that succeeds won't re-execute on retry.

3. **Error Handling**: Failed steps will be retried according to config. Final failures update job status to "failed" in a catch block or final step.

4. **State Passing**: Each step returns data needed by subsequent steps. Workflow state is automatically persisted between steps.

5. **Job ID as Workflow ID**: Using the job ID as the workflow instance ID allows easy correlation between job status (KV) and workflow status.

## Verification

1. Deploy with `pnpm deploy`
2. Submit test exploration: `POST /api/explore` with test idea
3. Check job status: `GET /api/status/:id` - should show status updates
4. Check workflow status: `GET /api/workflow-status/:id` - shows step-level progress
5. Verify in Cloudflare dashboard: Workers & Pages > Workflows tab
6. Check logs for step execution progression
7. Verify webhook delivery on completion
8. Test failure scenario - verify retry behavior
