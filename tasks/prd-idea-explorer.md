# PRD: Idea Explorer - Cloudflare Sandbox Service

## Introduction

A Cloudflare Container-based service that runs autonomous Claude Code sessions to explore and analyze ideas. The service accepts ideas via API, spins up a sandboxed container running Claude Code, executes analysis using configurable frameworks (business or exploration), and commits research output to a GitHub repository. Results are delivered via webhook with HMAC signature verification.

This is a personal-use tool for automated idea exploration and research.

## Goals

-  Accept idea submissions via authenticated REST API
-  Run Claude Code in isolated Cloudflare containers for each exploration
-  Support two analysis frameworks: business viability and creative exploration
-  Automatically commit research output to a GitHub repository
-  Deliver results via signed webhooks with retry logic
-  Provide job status polling endpoint

## User Stories

### US-001: Project Setup and Container Configuration

**Description:** As a developer, I need the base infrastructure configured so the service can run Claude Code in containers.

**Acceptance Criteria:**

-  [ ] Dockerfile extends `cloudflare/sandbox:0.6.10`
-  [ ] Claude Code installed via npm
-  [ ] 15-minute timeout configured via `COMMAND_TIMEOUT_MS`
-  [ ] Prompts directory baked into container at `/prompts/`
-  [ ] Typecheck passes

### US-002: Create Analysis Prompt Templates

**Description:** As a user, I want structured analysis frameworks so my ideas are explored consistently.

**Acceptance Criteria:**

-  [ ] `prompts/business.md` contains business analysis framework (Problem, Market, Technical, Verdict)
-  [ ] `prompts/exploration.md` contains exploration framework (Deconstruction, Directions, Connections, Questions)
-  [ ] Both prompts match the structure defined in SPEC.md

### US-003: Implement POST /explore Endpoint

**Description:** As a user, I want to submit an idea for exploration via API so Claude can analyze it autonomously.

**Acceptance Criteria:**

-  [ ] Accepts JSON body with: `idea` (required), `webhook_url` (required), `mode` (optional, default 'business'), `model` (optional, default 'sonnet'), `callback_secret` (optional), `context` (optional)
-  [ ] Returns 202 Accepted with `{job_id, status: "pending"}`
-  [ ] Returns 400 Bad Request for missing required fields
-  [ ] Returns 401 Unauthorized for invalid/missing bearer token
-  [ ] Spawns container with job parameters
-  [ ] Typecheck passes

### US-004: Implement Bearer Token Authentication

**Description:** As a user, I want API endpoints protected so only I can submit ideas.

**Acceptance Criteria:**

-  [ ] All endpoints require `Authorization: Bearer <token>` header
-  [ ] Token validated against `API_BEARER_TOKEN` secret
-  [ ] Returns 401 Unauthorized with appropriate message on failure
-  [ ] Typecheck passes

### US-005: Implement GET /status/{job_id} Endpoint

**Description:** As a user, I want to check job status so I can poll for completion.

**Acceptance Criteria:**

-  [ ] Returns job status: pending | running | completed | failed
-  [ ] Includes `idea` and `mode` in response
-  [ ] Includes `github_url` when status is completed
-  [ ] Includes `error` message when status is failed
-  [ ] Returns 404 for unknown job_id
-  [ ] Typecheck passes

### US-006: Implement Container Execution Flow

**Description:** As a user, I want the container to run the full exploration workflow so my idea gets analyzed and committed.

**Acceptance Criteria:**

-  [ ] Container clones ideas repo fresh on each run
-  [ ] Runs Claude Code with appropriate prompt (business.md or exploration.md)
-  [ ] Passes idea and optional context to Claude
-  [ ] Uses specified model (sonnet or opus)
-  [ ] Writes output to `ideas/YYYY-MM-DD-<slug>/research.md`
-  [ ] Commits with message: `idea: <slug> - research complete`
-  [ ] Pushes to configured branch
-  [ ] Typecheck passes

### US-007: Implement Webhook Delivery

**Description:** As a user, I want to receive a webhook when exploration completes so I'm notified of results.

**Acceptance Criteria:**

-  [ ] POSTs to provided `webhook_url` on completion or failure
-  [ ] Includes `X-Signature: sha256=<HMAC-SHA256>` header when `callback_secret` provided
-  [ ] Success payload includes: status, job_id, idea, github_url, github_raw_url
-  [ ] Failure payload includes: status, job_id, idea, error
-  [ ] Typecheck passes

### US-008: Implement Webhook Retry Logic

**Description:** As a user, I want webhook delivery to retry on failure so I don't miss notifications.

**Acceptance Criteria:**

-  [ ] Retries up to 3 times on non-2xx response
-  [ ] Uses exponential backoff: 1s, 5s, 30s delays
-  [ ] Logs each attempt with status code
-  [ ] Considers delivered on any 2xx response
-  [ ] Typecheck passes

### US-009: Implement Error Handling

**Description:** As a user, I want robust error handling so failures are reported correctly.

**Acceptance Criteria:**

-  [ ] Container timeout (15 min) marks job as failed
-  [ ] Clone failure retries once before failing
-  [ ] Push failure retries once with fresh pull before failing
-  [ ] Claude errors captured and included in failure webhook
-  [ ] All errors logged with job_id context
-  [ ] Typecheck passes

### US-010: Configure Secrets and Environment

**Description:** As a developer, I need secrets and environment variables configured for the service to function.

**Acceptance Criteria:**

-  [ ] `ANTHROPIC_API_KEY` configured as Cloudflare secret
-  [ ] `GITHUB_PAT` configured as Cloudflare secret
-  [ ] `API_BEARER_TOKEN` configured as Cloudflare secret
-  [ ] `GITHUB_REPO` configured in wrangler.jsonc
-  [ ] `GITHUB_BRANCH` configured with default 'main'
-  [ ] Documentation for secret setup in README

### US-011: Implement Logging

**Description:** As a developer, I want structured logging so I can debug issues.

**Acceptance Criteria:**

-  [ ] Log job created: {job_id, idea, mode, timestamp}
-  [ ] Log container started: {job_id, container_id}
-  [ ] Log clone complete: {job_id, duration_ms}
-  [ ] Log Claude started: {job_id, model}
-  [ ] Log research written: {job_id, file_size}
-  [ ] Log commit pushed: {job_id, commit_sha}
-  [ ] Log webhook sent: {job_id, status_code, attempt}
-  [ ] Log job complete: {job_id, status, total_duration_ms}

## Functional Requirements

-  FR-1: POST /explore accepts idea submission with required fields (idea, webhook_url) and optional fields (mode, model, callback_secret, context)
-  FR-2: POST /explore returns 202 Accepted with job_id for valid requests
-  FR-3: GET /status/{job_id} returns current job status and metadata
-  FR-4: All endpoints require valid bearer token authentication
-  FR-5: Container clones GitHub repo fresh for each job
-  FR-6: Container runs Claude Code with mode-specific prompt template
-  FR-7: Container writes research output to `ideas/YYYY-MM-DD-<slug>/research.md`
-  FR-8: Container commits and pushes to configured GitHub branch
-  FR-9: Webhook POSTs to callback URL with HMAC signature on completion
-  FR-10: Webhook retries 3 times with exponential backoff on failure
-  FR-11: Job failures include error details in status response and webhook
-  FR-12: Container enforces 15-minute timeout

## Non-Goals

-  No duplicate detection (deferred to future iteration)
-  No multiple GitHub repos per request
-  No Telegram/Slack direct notifications
-  No batch exploration of multiple ideas
-  No re-run/force flag to update existing research
-  No export to other formats (PDF, Notion, etc.)
-  No web UI - API only

## Technical Considerations

-  **Container Runtime:** Cloudflare Containers with `cloudflare/sandbox:0.6.10` base image
-  **Job State:** Jobs need to persist across container lifecycle - consider Durable Objects or KV
-  **GitHub Auth:** Fine-grained PAT scoped to ideas repo only
-  **Slug Generation:** Convert idea title to URL-safe kebab-case slug
-  **Concurrency:** Each job runs in isolated container, no shared state concerns

## Success Metrics

-  API responds within 500ms for job submission
-  Container starts within 10 seconds of job creation
-  95% of jobs complete successfully within 15 minutes
-  Webhooks delivered on first attempt 99% of the time

## Open Questions

-  How should job state be persisted (KV vs Durable Objects)?
-  Should there be a maximum idea length?
-  How long should job status be retained after completion?
-  Should there be rate limiting on job submissions?
