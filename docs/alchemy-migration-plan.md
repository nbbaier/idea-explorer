# Alchemy Migration Plan

This document outlines the step-by-step migration from Wrangler to [Alchemy](https://github.com/alchemy-run/alchemy) for the idea-explorer project.

## Current Setup

| Resource | Wrangler Config |
|----------|-----------------|
| Worker | `idea-explorer` with Hono entrypoint |
| KV Namespace | `IDEA_EXPLORER_JOBS` (id: `dbcbf4512f9f4fd18a20d5fc7e23d3ef`) |
| Workflow | `ExplorationWorkflow` bound as `EXPLORATION_WORKFLOW` |
| Assets | `./public` directory with SPA handling |
| Vars | `GITHUB_REPO`, `GITHUB_BRANCH` |
| Secrets | `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AUTH_SECRET` |

---

## Phase 1: Setup & Dependencies

### Step 1.1: Install Alchemy
```bash
bun add alchemy
```

### Step 1.2: Set Environment Variables
Create/update `.dev.vars`:
```bash
# Alchemy encryption password (generate once, keep secret)
ALCHEMY_PASSWORD=<generate-with: openssl rand -base64 32>

# Cloudflare auth (use existing or create new)
CLOUDFLARE_API_TOKEN=<your-token>

# Existing secrets
ANTHROPIC_API_KEY=<existing>
GITHUB_TOKEN=<existing>
AUTH_SECRET=<existing>
```

### Step 1.3: Update `.gitignore`
```gitignore
# Alchemy state (local development)
.alchemy/
```

---

## Phase 2: Create `alchemy.run.ts`

### Step 2.1: Create the Alchemy Configuration File

Create `alchemy.run.ts` in project root:

```typescript
import alchemy from "alchemy";
import { Worker, KVNamespace, Workflow } from "alchemy/cloudflare";

const stage = process.env.STAGE ?? "dev";

const app = await alchemy("idea-explorer", {
  stage,
  phase: process.argv.includes("--destroy") ? "destroy" : "up",
});

// Adopt existing KV namespace
const jobsKv = await KVNamespace("jobs", {
  title: "idea-explorer-jobs",
  adopt: true, // Critical: adopt existing resource
});

// Define the workflow
const explorationWorkflow = Workflow("exploration", {
  name: "exploration-workflow",
  className: "ExplorationWorkflow",
});

// Main worker with all bindings
export const worker = await Worker("api", {
  name: `idea-explorer${stage === "dev" ? "-dev" : ""}`,
  entrypoint: "./src/index.ts",
  compatibilityDate: "2025-05-06",
  compatibilityFlags: ["nodejs_compat"],
  url: true,
  adopt: true,
  assets: {
    directory: "./public",
    binding: "ASSETS",
    htmlHandling: "auto-trailing-slash",
    notFoundHandling: "single-page-application",
  },
  bindings: {
    // KV
    IDEA_EXPLORER_JOBS: jobsKv,
    
    // Workflow
    EXPLORATION_WORKFLOW: explorationWorkflow,
    
    // Environment variables
    GITHUB_REPO: "nbbaier/idea-explorer",
    GITHUB_BRANCH: "main",
    
    // Secrets (encrypted at rest)
    ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
    GITHUB_TOKEN: alchemy.secret(process.env.GITHUB_TOKEN),
    AUTH_SECRET: alchemy.secret(process.env.AUTH_SECRET),
  },
  observability: {
    enabled: true,
  },
});

console.log(`Worker URL: ${worker.url}`);

await app.finalize();
```

### Step 2.2: Update Worker Types

Update `src/index.ts` to use Alchemy-generated types:

```typescript
// Before
import type { ExploreEnv } from "./types";

// After
import type { worker } from "../alchemy.run";
type ExploreEnv = typeof worker.Env;
```

---

## Phase 3: Update Scripts

### Step 3.1: Update `package.json` Scripts

```json
{
  "scripts": {
    "deploy": "bun alchemy.run.ts",
    "deploy:wrangler": "wrangler deploy",
    "dev": "bun alchemy.run.ts --dev",
    "dev:wrangler": "wrangler dev",
    "destroy": "bun alchemy.run.ts --destroy",
    "types": "wrangler types"
  }
}
```

Keep wrangler scripts as fallback during transition.

---

## Phase 4: Testing & Validation

### Step 4.1: Local Development Test
```bash
bun run dev
# Verify worker starts and endpoints respond
```

### Step 4.2: Validate Bindings
Test each binding works correctly:
- [ ] KV read/write operations
- [ ] Workflow creation and execution
- [ ] Secret access (ANTHROPIC_API_KEY, etc.)
- [ ] Asset serving from `/public`

### Step 4.3: Run Tests
```bash
bun run test:run
bun run typecheck
```

---

## Phase 5: Production State Management

### Step 5.1: Configure CloudflareStateStore for CI/CD

Update `alchemy.run.ts` to use persistent state in production:

```typescript
import { CloudflareStateStore } from "alchemy/state";

const app = await alchemy("idea-explorer", {
  stage,
  stateStore: process.env.CI
    ? (scope) => new CloudflareStateStore(scope, {
        apiToken: alchemy.secret(process.env.CLOUDFLARE_API_TOKEN),
      })
    : undefined,
});
```

### Step 5.2: Update GitHub Actions

Update `.github/workflows/deploy.yml`:

```yaml
- name: Deploy with Alchemy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    ALCHEMY_PASSWORD: ${{ secrets.ALCHEMY_PASSWORD }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
    STAGE: production
    CI: true
  run: bun alchemy.run.ts
```

---

## Phase 6: Cleanup

### Step 6.1: Remove Wrangler Config (Optional)
After successful migration and validation:
```bash
git rm wrangler.jsonc
```

Or keep it for reference/fallback.

### Step 6.2: Remove Legacy Type Generation
```bash
# Remove from package.json if no longer needed
"types": "wrangler types"
```

### Step 6.3: Update Documentation
- Update README.md with new commands
- Archive this migration plan

---

## Rollback Plan

If issues arise:
1. Checkout `main` branch
2. Run `wrangler deploy` to restore from wrangler config
3. Document issues encountered

---

## Checklist

- [ ] **Phase 1**: Dependencies & environment setup
- [ ] **Phase 2**: Create `alchemy.run.ts`
- [ ] **Phase 3**: Update package.json scripts
- [ ] **Phase 4**: Test locally and run test suite
- [ ] **Phase 5**: Configure production state store
- [ ] **Phase 6**: Cleanup and documentation

---

## Resources

- [Alchemy Documentation](https://alchemy.run/docs)
- [Alchemy GitHub](https://github.com/alchemy-run/alchemy)
- [Cloudflare Worker Guide](https://github.com/alchemy-run/alchemy/blob/main/alchemy-web/src/content/docs/guides/cloudflare-worker.mdx)
- [State Store Guide](https://github.com/alchemy-run/alchemy/blob/main/alchemy-web/src/content/docs/guides/cloudflare-state-store.mdx)
