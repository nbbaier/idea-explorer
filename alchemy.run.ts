import alchemy from "alchemy";
import { Assets, KVNamespace, Worker, Workflow } from "alchemy/cloudflare";
import { GitHubComment } from "alchemy/github";
import { CloudflareStateStore } from "alchemy/state";

const stage = process.env.STAGE ?? "dev";

const app = await alchemy("idea-explorer", {
  stage,
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const jobsKv = await KVNamespace("jobs", {
  title: "idea-explorer-jobs",
  adopt: true, // Critical: adopt existing resource
});

const explorationWorkflow = Workflow("exploration", {
  workflowName: "exploration-workflow",
  className: "ExplorationWorkflow",
});

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
    ASSETS: await Assets({ path: "./public" }),
    IDEA_EXPLORER_JOBS: jobsKv,
    EXPLORATION_WORKFLOW: explorationWorkflow,
    GITHUB_REPO: "nbbaier/idea-explorer",
    GITHUB_BRANCH: "main",
    ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
    GITHUB_PAT: alchemy.secret(process.env.GITHUB_PAT),
    IDEA_EXPLORER_API_TOKEN: alchemy.secret(
      process.env.IDEA_EXPLORER_API_TOKEN
    ),
  },
  observability: {
    enabled: true,
  },
});

console.log(`Worker URL: ${worker.url}`);

if (process.env.PULL_REQUEST) {
  const previewUrl = worker.url;

  await GitHubComment("pr-preview-comment", {
    owner: process.env.GITHUB_REPOSITORY_OWNER || "your-username",
    repository: process.env.GITHUB_REPOSITORY_NAME || "password",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `
## 🚀 Preview Deployed

Your preview is ready!

**Preview URL:** ${previewUrl}

This preview was built from commit ${process.env.GITHUB_SHA}

---
<sub>🤖 This comment will be updated automatically when you push new commits to this PR.</sub>`,
  });
}

await app.finalize();
