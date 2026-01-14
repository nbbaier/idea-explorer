import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { AnthropicClient } from "../clients/anthropic";
import { GitHubClient } from "../clients/github";
import { getJob, type Job, updateJob } from "../jobs";
import { buildSystemPrompt, buildUserPrompt } from "../prompts";
import { logError, logInfo, logJobComplete } from "../utils/logger";
import { generateSlug } from "../utils/slug";
import { sendWebhook } from "../utils/webhook";

interface JobParams {
  jobId: string;
  idea: string;
  mode: "business" | "exploration";
  model: "sonnet" | "opus";
  context?: string;
  update?: boolean;
  webhook_url?: string;
  callback_secret?: string;
}

interface CompleteJobParams {
  kv: KVNamespace;
  jobId: string;
  status: "completed" | "failed";
  githubUrl?: string;
  error?: string;
  githubRepo: string;
  branch: string;
  jobStartTime: number;
}

interface ExplorationLog {
  jobId: string;
  idea: string;
  mode: "business" | "exploration";
  model: "sonnet" | "opus";
  context?: string;
  isUpdate: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  outputPath: string;
}
type ExplorationEnv = Env & {
  IDEA_EXPLORER_JOBS: KVNamespace;
};

const WORKFLOW_STEPS: {
  name: string;
  label: string;
}[] = [
  { name: "initialize", label: "Initializing job..." },
  { name: "check_existing", label: "Checking for existing research..." },
  { name: "generate_research", label: "Generating research with Claude..." },
  { name: "write_github", label: "Writing results to GitHub..." },
  { name: "notify", label: "Sending completion notification..." },
];

async function updateStepProgress(
  kv: KVNamespace,
  jobId: string,
  stepIndex: number,
  stepStartTime?: number,
  existingJob?: Job
): Promise<void> {
  const currentStep = WORKFLOW_STEPS[stepIndex];
  const updates: Record<string, unknown> = {
    current_step: currentStep?.name,
    current_step_label: currentStep?.label,
    steps_completed: stepIndex,
    steps_total: WORKFLOW_STEPS.length,
    step_started_at: Date.now(),
  };

  // Only fetch job once if we need step_durations and don't have existingJob
  let job = existingJob;
  if (stepStartTime !== undefined && stepIndex > 0) {
    const previousStep = WORKFLOW_STEPS[stepIndex - 1];
    const duration = Date.now() - stepStartTime;
    if (!job) {
      job = await getJob(kv, jobId);
    }
    const stepDurations = job?.step_durations ?? {};
    updates.step_durations = {
      ...stepDurations,
      [previousStep?.name ?? ""]: duration,
    };
  }

  await updateJob(kv, jobId, updates, job);
}

function getDatePrefix(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDirDate(name: string): number | null {
  const [year, month, day] = name.split("-").slice(0, 3);
  if (
    !(year && month && day) ||
    year.length !== 4 ||
    month.length !== 2 ||
    day.length !== 2
  ) {
    return null;
  }
  const parsed = Date.parse(`${year}-${month}-${day}`);
  return Number.isNaN(parsed) ? null : parsed;
}

async function completeJobAndNotify({
  kv,
  jobId,
  status,
  githubUrl,
  error,
  githubRepo,
  branch,
  jobStartTime,
}: CompleteJobParams): Promise<void> {
  const existingJob = await getJob(kv, jobId);
  if (existingJob?.webhook_sent_at) {
    logInfo("webhook_already_sent", undefined, jobId);
    return;
  }

  const updatedJob = await updateJob(kv, jobId, {
    status,
    ...(githubUrl && { github_url: githubUrl }),
    ...(error && { error }),
    webhook_sent_at: Date.now(),
  });

  logJobComplete(jobId, status, Date.now() - jobStartTime);

  if (updatedJob) {
    await sendWebhook(updatedJob, githubRepo, branch);
  }
}

export class ExplorationWorkflow extends WorkflowEntrypoint<
  ExplorationEnv,
  JobParams
> {
  override async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
    const { jobId, idea, mode, model, context, update } = event.payload;
    const jobStartTime = Date.now();
    const branch = this.env.GITHUB_BRANCH || "main";
    const slug = generateSlug(idea);
    const datePrefix = getDatePrefix();

    const github = new GitHubClient({
      pat: this.env.GITHUB_PAT,
      repo: this.env.GITHUB_REPO,
      branch,
    });

    const anthropic = new AnthropicClient({
      apiKey: this.env.ANTHROPIC_API_KEY,
      model,
    });

    const researchPath = `ideas/${datePrefix}-${slug}/research.md`;
    const logPath = `ideas/${datePrefix}-${slug}/exploration-log.json`;

    let existingContent: string | undefined;
    let existingSha: string | undefined;
    let existingDirPath: string | undefined;
    let existingResearchList: string[] = [];
    let researchContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Step 1: Initialize job
      let stepStartTime = Date.now();
      await updateStepProgress(this.env.IDEA_EXPLORER_JOBS, jobId, 0);
      await step.do(
        "initialize",
        { retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
        async () => {
          await updateJob(this.env.IDEA_EXPLORER_JOBS, jobId, {
            status: "running",
          });
          logInfo("job_started", { mode, model }, jobId);
        }
      );

      // Step 2: Check for existing research (for update mode)
      await updateStepProgress(
        this.env.IDEA_EXPLORER_JOBS,
        jobId,
        1,
        stepStartTime
      );
      stepStartTime = Date.now();
      await step.do(
        "check-existing",
        { retries: { limit: 3, delay: "10 seconds" }, timeout: "1 minute" },
        async () => {
          const directories = await github.listDirectory("ideas");

          // Collect all existing research directories for context
          existingResearchList = directories
            .filter((dir) => dir.type === "dir")
            .map((dir) => dir.name);

          if (update) {
            const matchingDirs = directories
              .filter(
                (dir) => dir.type === "dir" && dir.name.endsWith(`-${slug}`)
              )
              .map((dir) => ({
                dir,
                date: parseDirDate(dir.name),
              }))
              .sort((a, b) => {
                const aDate = a.date ?? Number.NEGATIVE_INFINITY;
                const bDate = b.date ?? Number.NEGATIVE_INFINITY;
                if (aDate !== bDate) {
                  return bDate - aDate;
                }
                return b.dir.name.localeCompare(a.dir.name);
              });
            const latestMatch = matchingDirs[0]?.dir;

            if (latestMatch) {
              existingDirPath = latestMatch.path;
              const existingResearchPath = `${latestMatch.path}/research.md`;
              const existing = await github.getFile(existingResearchPath);
              if (existing) {
                existingContent = existing.content;
                existingSha = existing.sha;
                logInfo(
                  "existing_research_found",
                  { path: existingResearchPath },
                  jobId
                );
              }
            }
          }
          logInfo(
            "check_existing_complete",
            {
              hasExisting: !!existingContent,
              existingCount: existingResearchList.length,
            },
            jobId
          );
        }
      );

      // Step 3: Generate research with Claude
      await updateStepProgress(
        this.env.IDEA_EXPLORER_JOBS,
        jobId,
        2,
        stepStartTime
      );
      stepStartTime = Date.now();
      await step.do(
        "generate-research",
        { retries: { limit: 2, delay: "30 seconds" }, timeout: "10 minutes" },
        async () => {
          logInfo("claude_started", { model }, jobId);

          const systemPrompt = buildSystemPrompt(mode);
          const userPrompt = buildUserPrompt({
            idea,
            context,
            existingContent,
            existingResearchList,
            datePrefix,
            jobId,
            mode,
            model,
          });

          const result = await anthropic.generateResearch({
            idea,
            mode,
            context,
            existingContent,
            datePrefix,
            jobId,
            systemPrompt,
            userPrompt,
          });

          researchContent = result.content;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;

          logInfo(
            "claude_complete",
            {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            },
            jobId
          );
        }
      );

      // Step 4: Write results to GitHub
      await updateStepProgress(
        this.env.IDEA_EXPLORER_JOBS,
        jobId,
        3,
        stepStartTime
      );
      stepStartTime = Date.now();

      // Determine paths - reuse existingDirPath from step 2 if updating
      let finalResearchPath = researchPath;
      let finalLogPath = logPath;

      // Only use existing paths if we have both content and SHA (consistent state)
      const isValidUpdate = existingSha && existingContent && existingDirPath;
      if (isValidUpdate) {
        finalResearchPath = `${existingDirPath}/research.md`;
        finalLogPath = `${existingDirPath}/exploration-log.json`;
      } else if (existingDirPath && !existingContent) {
        logInfo(
          "update_missing_research",
          {
            path: existingDirPath,
            message:
              "Directory exists but research.md not found, creating new file",
          },
          jobId
        );
      }

      await step.do(
        "write-github",
        { retries: { limit: 3, delay: "15 seconds" }, timeout: "2 minutes" },
        async () => {
          const commitMessage = update
            ? `idea: ${slug} - research updated`
            : `idea: ${slug} - research complete`;

          const finalContent = existingContent
            ? `${existingContent}\n\n${researchContent}`
            : researchContent;

          if (isValidUpdate) {
            // Re-fetch SHA to avoid stale SHA conflicts
            const currentFile = await github.getFile(finalResearchPath);
            if (currentFile) {
              await github.updateFile(
                finalResearchPath,
                finalContent,
                currentFile.sha,
                commitMessage
              );
            } else {
              await github.createFile(
                finalResearchPath,
                finalContent,
                commitMessage
              );
            }
          } else {
            await github.createFile(
              finalResearchPath,
              finalContent,
              commitMessage
            );
          }

          const explorationLog: ExplorationLog = {
            jobId,
            idea,
            mode,
            model,
            context,
            isUpdate: !!update,
            startedAt: new Date(jobStartTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - jobStartTime,
            tokens: {
              input: inputTokens,
              output: outputTokens,
              total: inputTokens + outputTokens,
            },
            outputPath: finalResearchPath,
          };

          // Append to existing log file if it exists, otherwise create new
          const existingLog = await github.getFile(finalLogPath);
          if (existingLog) {
            try {
              const existingLogs = JSON.parse(existingLog.content);
              const logs = Array.isArray(existingLogs)
                ? [...existingLogs, explorationLog]
                : [existingLogs, explorationLog];
              await github.updateFile(
                finalLogPath,
                JSON.stringify(logs, null, 2),
                existingLog.sha,
                `log: ${slug} - updated`
              );
            } catch (parseError) {
              // If parsing fails, log a warning and overwrite with new log
              logError(
                "log_parse_failed",
                parseError instanceof Error
                  ? parseError
                  : new Error("Unknown JSON parse error"),
                undefined,
                jobId
              );
              await github.updateFile(
                finalLogPath,
                JSON.stringify([explorationLog], null, 2),
                existingLog.sha,
                `log: ${slug}`
              );
            }
          } else {
            await github.createFile(
              finalLogPath,
              JSON.stringify([explorationLog], null, 2),
              `log: ${slug}`
            );
          }

          logInfo("github_write_complete", { path: finalResearchPath }, jobId);
        }
      );

      // Step 5: Notify completion
      await updateStepProgress(
        this.env.IDEA_EXPLORER_JOBS,
        jobId,
        4,
        stepStartTime
      );
      stepStartTime = Date.now();
      await step.do(
        "notify",
        { retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
        async () => {
          const githubUrl = `https://github.com/${this.env.GITHUB_REPO}/blob/${branch}/${finalResearchPath}`;
          await completeJobAndNotify({
            kv: this.env.IDEA_EXPLORER_JOBS,
            jobId,
            status: "completed",
            githubUrl,
            githubRepo: this.env.GITHUB_REPO,
            branch,
            jobStartTime,
          });
        }
      );

      // Record final step duration
      const job = await getJob(this.env.IDEA_EXPLORER_JOBS, jobId);
      if (job) {
        const duration = Date.now() - stepStartTime;
        const stepDurations = job.step_durations ?? {};
        await updateJob(this.env.IDEA_EXPLORER_JOBS, jobId, {
          step_durations: { ...stepDurations, notify: duration },
        });
      }
    } catch (error) {
      await this.handleFailure({
        jobId,
        error,
        branch,
        jobStartTime,
      });
      throw error;
    }
  }

  private async handleFailure({
    jobId,
    error,
    branch,
    jobStartTime,
  }: {
    jobId: string;
    error: unknown;
    branch: string;
    jobStartTime: number;
  }): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logError("exploration_failed", new Error(errorMessage), undefined, jobId);

    await completeJobAndNotify({
      kv: this.env.IDEA_EXPLORER_JOBS,
      jobId,
      status: "failed",
      error: errorMessage,
      githubRepo: this.env.GITHUB_REPO,
      branch,
      jobStartTime,
    });
  }
}
