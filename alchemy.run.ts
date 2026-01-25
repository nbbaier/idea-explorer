import alchemy from "alchemy";
import {
  Assets,
  KVNamespace,
  Worker,
  Workflow,
  WranglerJson,
} from "alchemy/cloudflare";
import { GitHubComment } from "alchemy/github";
import { CloudflareStateStore } from "alchemy/state";

const app = await alchemy("idea-explorer", {
  stateStore: (scope) => new CloudflareStateStore(scope),
  password: process.env.ALCHEMY_PASSWORD,
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
  name: `idea-explorer-${app.stage}`,
  entrypoint: "./src/index.ts",
  compatibilityDate: "2026-01-24",
  compatibilityFlags: ["nodejs_compat"],
  url: true,
  adopt: true,
  assets: {
    html_handling: "auto-trailing-slash",
    not_found_handling: "single-page-application",
  },
  domains: app.stage === "prod" ? ["ideas.nicobaier.com"] : [],
  bindings: {
    ASSETS: await Assets({ path: "./public" }),
    IDEA_EXPLORER_JOBS: jobsKv,
    EXPLORATION_WORKFLOW: explorationWorkflow,
    GH_REPO: alchemy.secret(process.env.GH_REPO),
    GH_BRANCH: alchemy.secret(process.env.GH_BRANCH),
    ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
    GH_PAT: alchemy.secret(process.env.GH_PAT),
    IDEA_EXPLORER_API_TOKEN: alchemy.secret(
      process.env.IDEA_EXPLORER_API_TOKEN
    ),
  },
  observability: {
    enabled: true,
  },
});

console.log(`Worker URL: ${worker.url}`);
console.log(`Worker name: ${worker.name}`);
console.log(`App stage: ${app.stage}`);

await WranglerJson({ worker });

if (process.env.PULL_REQUEST) {
  const previewUrl = worker.url;

  await GitHubComment("pr-preview-comment", {
    owner: process.env.GITHUB_REPOSITORY_OWNER || "nbbaier",
    repository: process.env.GITHUB_REPOSITORY_NAME || "idea-explorer",
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
