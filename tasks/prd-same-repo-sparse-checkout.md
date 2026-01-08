# PRD: Same-Repo Storage with Sparse Checkout

## Introduction

Migrate idea storage from a separate GitHub repository to a subdirectory within the idea-explorer application repository (`nbbaier/idea-explorer`). Use Git sparse checkout to minimize disk/network usage in containers by only checking out necessary directories when working on ideas.

This consolidates the codebase and ideas into a single repository while maintaining efficient container operations.

## Goals

- Store all idea research in `ideas/` subdirectory of the main `nbbaier/idea-explorer` repo
- Use sparse checkout to minimize clone size in containers
- Allow containers to browse existing ideas for cross-referencing
- Support both new idea creation and updating existing ideas
- Maintain backward compatibility with existing API responses (GitHub URLs)

## User Stories

### US-001: Update Git clone to use sparse checkout
**Description:** As a developer, I need the container to clone the repo efficiently so that container startup is fast and disk usage is minimal.

**Acceptance Criteria:**
- [ ] Clone uses `--filter=blob:none --sparse` flags
- [ ] Initial clone fetches only repo metadata, not file contents
- [ ] Sparse checkout patterns set to `ideas/` directory
- [ ] Clone completes successfully with minimal data transfer
- [ ] Typecheck passes

### US-002: Create new idea directories with sparse checkout
**Description:** As a user, I want to explore new ideas so that research is saved to the repository.

**Acceptance Criteria:**
- [ ] New `ideas/YYYY-MM-DD-<slug>/` directory created locally in sparse checkout
- [ ] `research.md` written to the new directory
- [ ] Git add, commit, push succeeds
- [ ] GitHub URL in response points to `nbbaier/idea-explorer` repo
- [ ] Typecheck passes

### US-003: Browse existing ideas for cross-referencing
**Description:** As an AI exploring an idea, I want access to previous research so that I can identify connections and avoid duplicating analysis.

**Acceptance Criteria:**
- [ ] Sparse checkout includes all `ideas/*/research.md` files
- [ ] Claude Code can read existing research files during analysis
- [ ] Prompts updated to encourage cross-referencing when relevant
- [ ] Typecheck passes

### US-004: Add update flag for re-running exploration
**Description:** As a user, I want to update an existing idea's research so that I can iterate on ideas over time.

**Acceptance Criteria:**
- [ ] API accepts optional `update: boolean` field (default: `false`)
- [ ] When `update: false` and idea exists: return existing URL (current behavior)
- [ ] When `update: true` and idea exists: sparse-checkout existing folder, run analysis, update research
- [ ] Updated research appends new dated section (e.g., `## Update - 2025-01-08`)
- [ ] Typecheck passes

### US-005: Update environment configuration
**Description:** As a developer, I need to update configuration so the system uses the correct repository.

**Acceptance Criteria:**
- [ ] `GITHUB_REPO` default/example updated to `nbbaier/idea-explorer`
- [ ] Documentation updated to reflect same-repo architecture
- [ ] GitHub PAT permissions verified for the idea-explorer repo
- [ ] Typecheck passes

### US-006: Update duplicate detection for same repo
**Description:** As a developer, I need duplicate detection to query the correct repository path.

**Acceptance Criteria:**
- [ ] GitHub API queries `nbbaier/idea-explorer` for `ideas/` directory
- [ ] Slug matching works correctly with new path structure
- [ ] Returns correct GitHub URL pointing to idea-explorer repo
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Clone repository using `git clone --filter=blob:none --sparse <repo-url>`
- FR-2: Configure sparse checkout with `git sparse-checkout set ideas/`
- FR-3: Create idea directories at `ideas/YYYY-MM-DD-<slug>/research.md`
- FR-4: Commit with message: `idea: <slug> - research complete`
- FR-5: Push to main branch of `nbbaier/idea-explorer`
- FR-6: Accept optional `update` boolean in POST /explore request body
- FR-7: When `update: true`, checkout existing idea folder and run new analysis
- FR-8: GitHub URLs in responses use format: `https://github.com/nbbaier/idea-explorer/blob/main/ideas/...`
- FR-9: Raw URLs use format: `https://raw.githubusercontent.com/nbbaier/idea-explorer/main/ideas/...`

## Non-Goals

- Migrating existing ideas from any previous separate repository
- Changing the analysis frameworks (business/exploration modes)
- Modifying the webhook delivery mechanism
- Supporting multiple target repositories per request
- Branch-per-idea workflow (all ideas go to main)

## Technical Considerations

### Sparse Checkout Commands

```bash
# Initial clone (metadata only)
git clone --filter=blob:none --sparse https://github.com/nbbaier/idea-explorer.git

# Set sparse checkout to ideas directory
cd idea-explorer
git sparse-checkout set ideas/

# For updates to existing ideas, ensure specific folder is checked out
git sparse-checkout add ideas/2025-01-07-existing-idea/
```

### Directory Structure

```
nbbaier/idea-explorer/
├── src/                    # Application code (not checked out in container)
├── prompts/                # Baked into container image
├── ideas/                  # Checked out via sparse checkout
│   ├── 2025-01-07-ai-calendar/
│   │   └── research.md
│   ├── 2025-01-08-code-review-bot/
│   │   └── research.md
│   └── ...
├── package.json            # Not checked out in container
└── ...
```

### Container Behavior

1. Clone with sparse checkout (fast, minimal data)
2. All `ideas/` content available for cross-referencing
3. Create new directory or update existing
4. Commit and push changes

### Git Authentication

Same GitHub PAT, but ensure it has write access to `nbbaier/idea-explorer` (should already if it's your repo).

## Success Metrics

- Container clone time reduced compared to full clone
- Disk usage in container minimized to ideas content only
- Cross-referencing works (Claude can read past research)
- Update flow allows iterating on ideas without creating duplicates

## Design Decisions

- **Update behavior:** Appends new dated section (e.g., `## Update - 2025-01-08`) rather than replacing
- **Update limits:** No limit on update frequency
- **Prompts location:** Baked into container image (not checked out via sparse checkout)
