# Task: Simplify Architecture to Direct HTTP Calls

**Status:** Not Started
**Estimated Effort:** ~1 day
**Reference:** [ARCHITECTURE-REVIEW.md](../ARCHITECTURE-REVIEW.md)

---

## Overview

Replace the Cloudflare Sandbox/Container approach with direct HTTP API calls:

| Current (Sandbox)          | New (HTTP)                |
| -------------------------- | ------------------------- |
| Claude Code CLI            | Anthropic Messages API    |
| `git clone/commit/push`    | GitHub Contents API       |
| Container filesystem       | In-memory strings         |
| Docker image               | None                      |
| Shell utilities            | TypeScript functions      |
| Prompts from filesystem    | Embedded in TypeScript    |

---

## Phase 1: Add New API Clients

**Goal:** Create the HTTP clients without touching existing code.

### 1.1 Anthropic Messages API Client

Create `src/clients/anthropic.ts`:

```typescript
interface AnthropicConfig {
  apiKey: string;
  model: "sonnet" | "opus";
}

interface GenerateResearchParams {
  idea: string;
  mode: "business" | "exploration";
  context?: string;
  existingContent?: string; // For update mode
  datePrefix: string;
  jobId: string;
}

interface GenerateResearchResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}
```

- Map model names: `sonnet` → `claude-sonnet-4-5-20250929`, `opus` → `claude-opus-4-5-20251101`
- Use streaming for long responses (research can be lengthy)
- Include retry logic with exponential backoff
- Return token counts for logging

### 1.2 GitHub Contents API Client

Create `src/clients/github.ts`:

```typescript
interface GitHubConfig {
  pat: string;
  repo: string; // "owner/repo"
  branch: string;
}

interface FileContent {
  content: string;
  sha: string;
}

// Core operations needed:
async function getFile(path: string): Promise<FileContent | null>
async function createFile(path: string, content: string, message: string): Promise<string>
async function updateFile(path: string, content: string, sha: string, message: string): Promise<string>
async function listDirectory(path: string): Promise<string[]>
```

- Handle base64 encoding/decoding
- Return file URLs after creation
- Handle 404s gracefully for `getFile`

### 1.3 Embed Prompts

Create `src/prompts/index.ts`:

```typescript
export const PROMPTS = {
  business: `# Business Analysis Framework
...`,
  exploration: `# Exploration Framework
...`,
} as const;

export function buildSystemPrompt(mode: "business" | "exploration"): string
export function buildUserPrompt(params: {
  idea: string;
  context?: string;
  existingContent?: string;
  datePrefix: string;
  jobId: string;
  mode: "business" | "exploration";
  model: "sonnet" | "opus";
}): string
```

- Copy content from `prompts/business.md` and `prompts/exploration.md`
- Remove references to `/workspace/ideas/` (v1 simplification)
- Build YAML frontmatter programmatically

### Files to create:
- [x] `src/clients/anthropic.ts`
- [x] `src/clients/github.ts`
- [x] `src/prompts/index.ts`

### Tests to add:
- [x] `src/clients/anthropic.test.ts` (mock fetch)
- [x] `src/clients/github.test.ts` (mock fetch)
- [x] `src/prompts/index.test.ts` (prompt building)

---

## Phase 2: Create New Workflow

**Goal:** Implement the simplified workflow alongside the existing one.

### 2.1 New Workflow Steps

Rewrite `src/workflows/exploration.ts`:

```typescript
WORKFLOW_STEPS = [
  { name: "initialize", label: "Initializing job..." },
  { name: "check_existing", label: "Checking for existing research..." },
  { name: "generate_research", label: "Generating research with Claude..." },
  { name: "write_github", label: "Writing results to GitHub..." },
  { name: "notify", label: "Sending completion notification..." },
]
```

### 2.2 Workflow Logic

```typescript
// Step 1: Initialize
await updateJob(kv, jobId, { status: "running" });

// Step 2: Check existing (for update mode)
let existingContent: string | undefined;
let existingSha: string | undefined;
if (update) {
  const existing = await github.getFile(outputPath);
  if (existing) {
    existingContent = existing.content;
    existingSha = existing.sha;
  }
}

// Step 3: Generate research
const result = await anthropic.generateResearch({
  idea,
  mode,
  context,
  existingContent,
  datePrefix,
  jobId,
});

// Step 4: Write to GitHub
const researchPath = `ideas/${datePrefix}-${slug}/research.md`;
const logPath = `ideas/${datePrefix}-${slug}/exploration-log.json`;

if (existingSha) {
  await github.updateFile(researchPath, result.content, existingSha, commitMessage);
} else {
  await github.createFile(researchPath, result.content, commitMessage);
}

// Write simplified log
await github.createFile(logPath, JSON.stringify(logData), `log: ${slug}`);

// Step 5: Notify
await completeJobAndNotify({ ... });
```

### 2.3 Simplified Exploration Log

Structure for `exploration-log.json`:

```typescript
interface ExplorationLog {
  jobId: string;
  idea: string;
  mode: "business" | "exploration";
  model: "sonnet" | "opus";
  context?: string;
  isUpdate: boolean;
  startedAt: string; // ISO timestamp
  completedAt: string;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  outputPath: string;
}
```

### Files to modify:
- [x] `src/workflows/exploration.ts`

### Tests to add:
- [ ] `src/workflows/exploration.test.ts` (deferred - Cloudflare Workflow primitives require wrangler test runner)

---

## Phase 3: Update Configuration

**Goal:** Remove sandbox configuration and update bindings.

### 3.1 Update Exports

In `src/index.ts`:
- Remove `Sandbox` import and export

### 3.2 Update wrangler.jsonc

```jsonc
{
  // Remove sandbox configuration
}
```

### 3.3 Update Environment Types

In `worker-configuration.d.ts`:
- Remove `Sandbox` binding
- Add `ANTHROPIC_API_KEY` to env interface (if not already present)

### Files to modify:
- [x] `src/index.ts`
- [x] `wrangler.jsonc`
- [x] `worker-configuration.d.ts`

---

## Phase 4: Cleanup

**Goal:** Remove all sandbox-related code.

### 4.1 Delete Files

- [x] `src/utils/git.ts` (sandbox git operations)
- [x] `src/utils/shell.ts` (shell escaping)
- [x] `src/utils/claude-log.ts` (raw JSONL parsing)
- [x] `Dockerfile` (container image)
- [x] `prompts/` directory (now embedded)

### 4.2 Update Dependencies

In `package.json`, remove:
- [x] `@cloudflare/sandbox` (not present - never added)
- [x] `shescape` (not present - never added)
- [x] Updated package name and description

### 4.3 Simplify Logger

In `src/utils/logger.ts`:
- [x] Remove sandbox-specific log events (`logContainerStarted`, `logCloneComplete`, `logCommitPushed`)
- [x] HTTP operation events handled via generic `logInfo`

### 4.4 Update Documentation

- [x] Update `README.md` to reflect new architecture
- [x] Update `SPEC.md` if API behavior changes
- [x] Archive `ARCHITECTURE-REVIEW.md` or mark as implemented

---

## Phase 5: Testing & Validation

### 5.1 Unit Tests

- [x] All new clients have tests with mocked fetch
- [x] Prompt building tests cover all modes and update scenarios
- [ ] Workflow tests mock both Anthropic and GitHub clients (deferred - requires wrangler test runner)

### 5.2 Integration Tests

- [ ] Manual test: Create new idea → verify GitHub file created
- [ ] Manual test: Update existing idea → verify content appended
- [ ] Manual test: Webhook delivery works
- [ ] Manual test: Job status polling works

### 5.3 Deploy Verification

```bash
# Deploy to Cloudflare
bun run deploy

# Test API
curl -X POST https://idea-explorer.your-domain.workers.dev/api/explore \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"idea": "Test idea for architecture migration"}'
```

---

## Error Handling Considerations

### Anthropic API Errors
- Rate limits → retry with backoff
- Context too long → return clear error to user
- API down → fail job with error message

### GitHub API Errors
- File exists (409) on create → fetch SHA and update instead
- Branch protection → fail with clear message
- Rate limits → retry with backoff

### Partial Failures
- Anthropic succeeds, GitHub fails → retry GitHub step (workflow durability)
- No need for "partial work salvage" - either research is written or not

---

## Rollback Plan

If issues arise after deployment:

1. Revert to previous git commit
2. Redeploy

---

## Success Criteria

- [ ] Jobs complete successfully with new workflow
- [ ] Research files appear in GitHub with correct content
- [ ] Exploration logs are committed alongside research
- [ ] Update mode appends to existing files correctly
- [ ] Webhook notifications work as before
- [ ] No Docker image to maintain
- [ ] All tests pass
- [ ] `bunx ultracite check` passes
