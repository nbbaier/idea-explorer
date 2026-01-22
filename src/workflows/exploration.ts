import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { Result } from "better-result";
import { AnthropicClient } from "../clients/anthropic";
import { type FileContent, GitHubClient } from "../clients/github";
import {
  ExplorationLogParseError,
  ExplorationLogUpdateError,
  type GitHubConfigError,
  WorkflowStepError,
} from "../errors";
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

  let job = existingJob;
  if (stepStartTime !== undefined && stepIndex > 0) {
    const previousStep = WORKFLOW_STEPS[stepIndex - 1];
    const duration = Date.now() - stepStartTime;
    if (!job) {
      const jobResult = await getJob(kv, jobId);
      job = jobResult.unwrapOr(null) ?? undefined;
    }
    const stepDurations = job?.step_durations ?? {};
    updates.step_durations = {
      ...stepDurations,
      [previousStep?.name ?? ""]: duration,
    };
  }

  const result = await updateJob(kv, jobId, updates, job);
  if (result.status === "error") {
    logError("update_step_progress_failed", result.error, undefined, jobId);
  }
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
  const existingJobResult = await getJob(kv, jobId);
  const existingJob = existingJobResult.unwrapOr(null);
  if (existingJob?.webhook_sent_at) {
    logInfo("webhook_already_sent", undefined, jobId);
    return;
  }

  const updateResult = await updateJob(kv, jobId, {
    status,
    ...(githubUrl && { github_url: githubUrl }),
    ...(error && { error }),
  });

  logJobComplete(jobId, status, Date.now() - jobStartTime);

  if (updateResult.status === "error") {
    logError(
      "complete_job_update_failed",
      updateResult.error,
      undefined,
      jobId
    );
    return;
  }

  const updatedJob = updateResult.value;

  const webhookResult = await sendWebhook(updatedJob, githubRepo, branch);
  if (webhookResult.status === "error") {
    throw new Error(`Webhook delivery failed: ${webhookResult.error.message}`);
  }

  const timestampResult = await updateJob(
    kv,
    jobId,
    { webhook_sent_at: Date.now() },
    updatedJob
  );
  if (timestampResult.status === "error") {
    logError(
      "webhook_timestamp_update_failed",
      timestampResult.error,
      undefined,
      jobId
    );
  }
}

function unwrapGitHubClient(
  result: Result<GitHubClient, GitHubConfigError>
): GitHubClient {
  if (result.status === "error") {
    throw new WorkflowStepError({
      step: "initialize",
      message: result.error.message,
      cause: result.error,
    });
  }
  return result.value;
}

function throwOnError<T, E extends { message: string }>(
  result: Result<T, E>,
  operation: string
): T {
  if (result.status === "error") {
    throw new Error(`${operation}: ${result.error.message}`);
  }
  return result.value;
}

async function writeResearchFile(
  github: GitHubClient,
  path: string,
  content: string,
  message: string,
  hasExisting: boolean
): Promise<void> {
  if (hasExisting) {
    const fileResult = await github.getFile(path);
    const currentFile = throwOnError(fileResult, "Failed to get file");

    if (currentFile) {
      const updateResult = await github.updateFile(
        path,
        content,
        currentFile.sha,
        message
      );
      throwOnError(updateResult, "Failed to update file");
    } else {
      const createResult = await github.createFile(path, content, message);
      throwOnError(createResult, "Failed to create file");
    }
  } else {
    const createResult = await github.createFile(path, content, message);
    throwOnError(createResult, "Failed to create file");
  }
}

async function writeExplorationLogToGitHub(
  github: GitHubClient,
  logPath: string,
  explorationLog: ExplorationLog,
  slug: string,
  jobId: string
): Promise<void> {
  const logFileResult = await github.getFile(logPath);
  const existingLog = throwOnError(logFileResult, "Failed to get log file");

  if (existingLog) {
    const writeLogResult = await writeExplorationLog(
      github,
      logPath,
      explorationLog,
      existingLog,
      slug,
      jobId
    );
    throwOnError(writeLogResult, "Failed to write exploration log");
  } else {
    const createLogResult = await github.createFile(
      logPath,
      JSON.stringify([explorationLog], null, 2),
      `log: ${slug}`
    );
    throwOnError(createLogResult, "Failed to create log file");
  }
}

export class ExplorationWorkflow extends WorkflowEntrypoint<
  ExplorationEnv,
  JobParams
> {
  override async run(
    event: WorkflowEvent<JobParams>,
    step: WorkflowStep
  ): Promise<void> {
    const { jobId, idea, mode, model, context, update } = event.payload;
    const jobStartTime = Date.now();
    const branch = this.env.GITHUB_BRANCH || "main";
    const slug = generateSlug(idea);
    const datePrefix = getDatePrefix();

    const github = unwrapGitHubClient(
      GitHubClient.create({
        pat: this.env.GITHUB_PAT,
        repo: this.env.GITHUB_REPO,
        branch,
      })
    );

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
          const result = await updateJob(this.env.IDEA_EXPLORER_JOBS, jobId, {
            status: "running",
          });
          if (result.status === "error") {
            throw new Error(
              `Failed to update job status: ${result.error.message}`
            );
          }
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
          const dirResult = await github.listDirectory("ideas");
          if (dirResult.status === "error") {
            throw new Error(
              `Failed to list directory: ${dirResult.error.message}`
            );
          }
          const directories = dirResult.value;

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
              const fileResult = await github.getFile(existingResearchPath);
              if (fileResult.status === "error") {
                throw new Error(
                  `Failed to get file: ${fileResult.error.message}`
                );
              }
              const existing = fileResult.value;
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

          if (result.status === "error") {
            throw new Error(
              `Claude generation failed: ${result.error.message}`
            );
          }

          researchContent = result.value.content;
          inputTokens = result.value.inputTokens;
          outputTokens = result.value.outputTokens;

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

      let finalResearchPath = researchPath;
      let finalLogPath = logPath;

      const hasExistingResearch = Boolean(
        existingSha && existingContent && existingDirPath
      );
      if (hasExistingResearch) {
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

          await writeResearchFile(
            github,
            finalResearchPath,
            finalContent,
            commitMessage,
            hasExistingResearch
          );

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

          await writeExplorationLogToGitHub(
            github,
            finalLogPath,
            explorationLog,
            slug,
            jobId
          );

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
      const jobResult = await getJob(this.env.IDEA_EXPLORER_JOBS, jobId);
      const job = jobResult.unwrapOr(null);
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

type WriteExplorationLogError =
  | ExplorationLogParseError
  | ExplorationLogUpdateError;

async function writeExplorationLog(
  github: GitHubClient,
  logPath: string,
  explorationLog: ExplorationLog,
  existingLog: FileContent,
  slug: string,
  jobId: string
): Promise<Result<void, WriteExplorationLogError>> {
  const parseResult = Result.try({
    try: () => JSON.parse(existingLog.content) as unknown,
    catch: (cause) => new ExplorationLogParseError({ jobId, logPath, cause }),
  });

  let logs: unknown[];
  if (parseResult.status === "error") {
    logError("log_parse_failed", parseResult.error, undefined, jobId);
    logs = [explorationLog];
  } else {
    const existingLogs = parseResult.value;
    logs = Array.isArray(existingLogs)
      ? [...existingLogs, explorationLog]
      : [existingLogs, explorationLog];
  }

  const commitMessage =
    parseResult.status === "ok" ? `log: ${slug} - updated` : `log: ${slug}`;

  const updateResult = await github.updateFile(
    logPath,
    JSON.stringify(logs, null, 2),
    existingLog.sha,
    commitMessage
  );

  if (updateResult.status === "error") {
    return Result.err(
      new ExplorationLogUpdateError({
        jobId,
        logPath,
        cause: updateResult.error,
      })
    );
  }

  return Result.ok(undefined);
}
