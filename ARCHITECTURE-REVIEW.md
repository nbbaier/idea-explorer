# Architecture Review: Sandbox Necessity

**Date:** January 2026
**Status:** ✅ Implemented
**Outcome:** Sandbox removed; simplified to direct HTTP calls

> **Note:** This review has been implemented. The codebase now uses direct Anthropic Messages API and GitHub Contents API calls instead of containers. See [tasks/simplify-architecture.md](tasks/simplify-architecture.md) for implementation details.

---

## Problem Statement

The current idea-explorer architecture uses Cloudflare Containers (sandbox) to run Claude Code CLI sessions that:

1. Clone a GitHub repository
2. Run Claude Code to generate research output
3. Write files to the container filesystem
4. Git commit and push results

The question: **Is the sandboxing necessary, or is it adding complexity without meaningful benefit?**

The hypothesis was that since we're not running untrusted code—just having Claude write Markdown files—the container isolation might be overkill.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare Worker                          │
│  POST /api/explore → Create Job (KV) → Trigger Workflow         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Workflow                           │
│  initialize → setup-sandbox → check-existing → run-claude →    │
│  commit-push → notify                                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Sandbox Container                             │
│  - Docker image with Claude Code CLI + git                      │
│  - Clone repo, run claude-code, git push                        │
│  - 15 minute timeout                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Components requiring the sandbox

- **Claude Code CLI**: Needs a POSIX environment to run as a process
- **Git operations**: `git clone`, `git commit`, `git push` require a filesystem and shell
- **File I/O**: Writing `research.md` to disk before committing

---

## Exploration

### What does the sandbox actually provide?

1. **POSIX runtime + process execution**
   - Run `claude-code` as a CLI
   - Run git commands
   - Use a traditional filesystem (`/workspace`)

2. **Execution time extension**
   - Container runs the 15-minute Claude session while the Workflow step waits

3. **Process isolation**
   - If Claude Code or git crashes, only the container crashes

### What security benefits does it provide?

**Minimal, for this use case.**

- We're not running arbitrary user code—Claude Code is the trusted executor
- We control all prompts and CLI invocations
- Secrets (GitHub PAT, Anthropic API key) are still injected into the container
- A compromised container could still read/write the repo and exfiltrate secrets

The container is a **runtime convenience**, not a meaningful security boundary for a single-tenant, personal tool.

### What are the downsides?

1. **Operational complexity**
   - Docker image lifecycle (build, push, version)
   - Shell-based git utilities with complex error handling
   - Debugging requires reasoning about Worker logs, Workflow steps, AND container internals

2. **Performance overhead**
   - Container cold starts
   - Full repo clone on every job
   - Latency dominates vs. simple HTTP calls

3. **Failure complexity**
   - Partial state salvage logic (`handleFailure`, `moveToPartial`, `commitPartialWork`)
   - Debug log generation from raw JSONL
   - Multiple failure modes to handle

4. **Testing difficulty**
   - Can't easily run locally without container build + sandbox emulation
   - Shell logic is harder to unit test than TypeScript

5. **Cost and lock-in**
   - Containers are more expensive than Workers
   - Tightly coupled to Cloudflare's sandbox APIs

### Alternative: Direct HTTP calls

Since the actual work is:
- Call Anthropic to generate research → **Anthropic Messages API**
- Write a file to GitHub → **GitHub Contents API**

Neither requires a filesystem, shell, or container.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare Worker                          │
│  POST /api/explore → Create Job (KV) → Trigger Workflow         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Workflow                           │
│  initialize → check-existing → call-anthropic → write-github → │
│  notify                                                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
          Anthropic API             GitHub Contents API
          (fetch call)              (fetch call)
```

**Benefits:**
- No Docker image to maintain
- No shell scripting for git
- Faster execution (no cold starts, no clone)
- Easier debugging (HTTP request/response logs)
- Better testability (pure TypeScript)
- Cheaper (Workers vs. Containers)

**Trade-offs:**
- No "agentic" multi-step Claude sessions with iterative file editing
- Single API call per idea instead of interactive exploration

For a tool that outputs one `research.md` per idea, this is acceptable.

### Durable Objects consideration

Also explored whether Durable Objects would be useful. Conclusion: **not for this use case**.

Durable Objects excel at:
- Strongly consistent, transactional state
- Real-time coordination (WebSockets)
- Global singleton enforcement
- Rate limiting / deduplication

This tool has:
- Independent jobs with no coordination needs
- Status polling (no real-time requirement)
- Single tenant, no concurrency concerns
- Simple key-value job storage

Workflows + KV already cover these needs. Durable Objects would add complexity without benefit.

---

## Conclusion

**The Cloudflare Container/Sandbox approach is unnecessary for this use case.**

The sandbox exists to provide a POSIX environment for Claude Code CLI and git—but both can be replaced with direct HTTP API calls:

| Current (Sandbox) | Simplified (HTTP) |
|-------------------|-------------------|
| Claude Code CLI | Anthropic Messages API |
| `git clone/commit/push` | GitHub Contents API |
| Container filesystem | In-memory strings |
| Docker image | None |
| Shell utilities | TypeScript functions |

### Recommended architecture

Keep:
- Cloudflare Workers for API endpoints
- Cloudflare Workflows for durable execution and retries
- KV for job storage

Replace:
- Sandbox container → direct `fetch()` calls
- Claude Code CLI → Anthropic Messages API
- Git operations → GitHub Contents API

### Effort estimate

| Task | Effort |
|------|--------|
| Remove sandbox dependencies | ~1 hour |
| Wire Anthropic API directly | ~2-3 hours |
| Implement GitHub Contents API helpers | ~3-4 hours |
| **Total** | **~1 day** |

### When to reconsider sandboxing

Reintroduce a sandbox/container if:
- Allowing arbitrary user workflows or plugins
- Claude needs to work against real codebases with tools, tests, multiple files
- Running longer, complex agentic sessions with multiple tool invocations
- Opening beyond personal use with need for stronger security boundaries

---

## Appendix: Cloudflare Agents SDK

Also explored whether the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) would be useful.

### What the Agents SDK provides

The SDK is built on Durable Objects and provides:

- **Real-time WebSocket connections** with automatic client sync
- **Built-in state management** via `this.setState` with persistence
- **Embedded SQLite database** per agent instance (zero-latency reads/writes)
- **React hooks** (`useAgent`, `useAgentChat`) for bidirectional state sync
- **`AIChatAgent` base class** for conversational AI with message history
- **MCP server integration** for tool use

### Why it's not a fit now

The Agents SDK excels at:
- Real-time collaborative apps (chat, multiplayer)
- Stateful conversational AI with WebSocket streaming
- Client apps that need bidirectional state sync
- Per-user/per-session isolated state

Current idea-explorer is:
- Fire-and-forget API calls
- No persistent conversation state
- No real-time UI requirements
- Simple job status polling

Using Agents SDK would mean adopting Durable Objects (already determined unnecessary) plus an additional abstraction layer, for a system that doesn't need real-time sync or conversational state.

### When Agents SDK would make sense

If idea-explorer evolved into:

| Feature | Why Agents SDK helps |
|---------|---------------------|
| **Interactive chat UI** | `AIChatAgent` handles message history, streaming responses |
| **Real-time progress streaming** | WebSocket connections with `useAgent` hook |
| **Multi-turn research sessions** | Per-agent SQLite stores conversation context |
| **Collaborative idea refinement** | State sync across multiple connected clients |
| **Iterative exploration** | Agent maintains state between user interactions |

Example future architecture with Agents:

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Frontend                             │
│  useAgentChat() ←──WebSocket──→ IdeaExplorerAgent              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              IdeaExplorerAgent (Durable Object)                 │
│  - Extends AIChatAgent                                          │
│  - this.messages for conversation history                       │
│  - this.sql for research artifacts                              │
│  - Streams responses back to client                             │
│  - Commits to GitHub when user approves                         │
└─────────────────────────────────────────────────────────────────┘
```

This would enable a conversational workflow:
1. User describes idea in chat
2. Agent asks clarifying questions
3. User refines direction interactively
4. Agent generates research with real-time streaming
5. User reviews and requests changes
6. Final research committed to GitHub

**Bottom line:** Agents SDK is a future option if the tool becomes interactive/conversational, but adds unnecessary complexity for the current fire-and-forget API design.
