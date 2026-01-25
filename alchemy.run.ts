import alchemy from "alchemy";
import { Assets, KVNamespace, Worker, Workflow } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

const stage = process.env.STAGE ?? "dev";

const app = await alchemy("idea-explorer", {
  stage,
  phase: process.argv.includes("--destroy") ? "destroy" : "up",
  stateStore: process.env.CI
    ? (scope) =>
        new CloudflareStateStore(scope, {
          apiToken: alchemy.secret(process.env.CLOUDFLARE_API_TOKEN),
        })
    : undefined,
});

// Adopt existing KV namespace
const jobsKv = await KVNamespace("jobs", {
  title: "idea-explorer-jobs",
  adopt: true, // Critical: adopt existing resource
});

// Create assets from public directory
const publicAssets = await Assets({
  path: "./public",
});

// Define the workflow
const explorationWorkflow = Workflow("exploration", {
  workflowName: "exploration-workflow",
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
    html_handling: "auto-trailing-slash",
    not_found_handling: "single-page-application",
  },
  bindings: {
    // Assets
    ASSETS: publicAssets,

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
