import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { getJob, updateJob } from "../jobs";
import { cloneWithRetry, commitAndPush } from "../utils/git";
import {
	logClaudeStarted,
	logCloneComplete,
	logContainerStarted,
	logError,
	logInfo,
	logJobComplete,
} from "../utils/logger";
import { escapeShell } from "../utils/shell";
import { generateSlug } from "../utils/slug";
import { sendWebhook } from "../utils/webhook";

export type JobParams = {
	jobId: string;
	idea: string;
	mode: "business" | "exploration";
	model: "sonnet" | "opus";
	context?: string;
	update?: boolean;
	webhook_url?: string;
	callback_secret?: string;
};

type ExplorationEnv = Env & {
	IDEA_EXPLORER_JOBS: KVNamespace;
};

function getDatePrefix(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

async function findExistingIdeaFolder(
	sandbox: ReturnType<typeof getSandbox>,
	slug: string,
): Promise<string | null> {
	try {
		const result = await sandbox.exec(
			"ls /workspace/ideas/ 2>/dev/null || true",
			{ cwd: "/workspace" },
		);
		const stdout =
			typeof result === "string"
				? result
				: ((result as { stdout?: string }).stdout ?? "");
		const folders = stdout.trim().split("\n").filter(Boolean);
		for (const folder of folders) {
			if (folder.endsWith(`-${slug}`)) {
				return folder;
			}
		}
	} catch {
		// No ideas directory yet
	}
	return null;
}

function buildPrompt({
	idea,
	context,
	isUpdate,
	datePrefix,
	promptFile,
	outputPath,
}: {
	idea: string;
	context?: string;
	isUpdate: boolean;
	datePrefix: string;
	promptFile: string;
	outputPath: string;
}): string {
	const contextPart = context ? `\n\nAdditional context: ${context}` : "";

	if (isUpdate) {
		return `Read the prompt template at ${promptFile} and the existing research at /workspace/${outputPath}.

Analyze the following idea with fresh perspective. Append a new section to the existing research file with the header:

## Update - ${datePrefix}

Include new insights, updated analysis, or changed recommendations based on current thinking.

Idea: ${idea}${contextPart}

Make sure to preserve all existing content and append the new update section at the end of /workspace/${outputPath}.`;
	}

	return `Read the prompt template at ${promptFile} and use it to analyze the following idea. Write your complete analysis to /workspace/${outputPath}

Idea: ${idea}${contextPart}

After completing your analysis, make sure the file /workspace/${outputPath} contains your full research output.`;
}

export class ExplorationWorkflow extends WorkflowEntrypoint<
	ExplorationEnv,
	JobParams
> {
	async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
		const { jobId, idea, mode, model, context, update } = event.payload;
		const jobStartTime = Date.now();
		const branch = this.env.GITHUB_BRANCH || "main";
		const repoUrl = `https://x-access-token:${this.env.GITHUB_PAT}@github.com/${this.env.GITHUB_REPO}.git`;
		const slug = generateSlug(idea);
		const datePrefix = getDatePrefix();

		try {
			// Step 1: Initialize job
			await step.do(
				"initialize",
				{ retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
				async () => {
					await updateJob(this.env.IDEA_EXPLORER_JOBS, jobId, {
						status: "running",
					});
					logContainerStarted(jobId);
				},
			);

			// Step 2: Setup sandbox and clone repo
			await step.do(
				"setup-sandbox",
				{ retries: { limit: 2, delay: "30 seconds" }, timeout: "5 minutes" },
				async () => {
					const sandbox = getSandbox(this.env.Sandbox, jobId);
					await sandbox.setEnvVars({
						ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
						GITHUB_PAT: this.env.GITHUB_PAT,
					});

					const cloneStartTime = Date.now();
					await cloneWithRetry(sandbox, repoUrl, branch, jobId);
					logCloneComplete(jobId, Date.now() - cloneStartTime);
				},
			);

			// Step 3: Check for existing idea folder
			const existingCheck = await step.do(
				"check-existing",
				{ retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
				async () => {
					const sandbox = getSandbox(this.env.Sandbox, jobId);
					const existingFolder = await findExistingIdeaFolder(sandbox, slug);
					return { existingFolder };
				},
			);

			// Handle existing idea (no update requested)
			if (existingCheck.existingFolder && !update) {
				const existingFolder = existingCheck.existingFolder;
				await step.do(
					"handle-existing",
					{ retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
					async () => {
						const outputPath = `ideas/${existingFolder}/research.md`;
						const githubUrl = `https://github.com/${this.env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
						logInfo(jobId, "existing_idea_found");

						const existingJob = await getJob(
							this.env.IDEA_EXPLORER_JOBS,
							jobId,
						);
						if (existingJob?.webhook_sent_at) {
							logInfo(jobId, "webhook_already_sent");
							return;
						}

						const updatedJob = await updateJob(
							this.env.IDEA_EXPLORER_JOBS,
							jobId,
							{
								status: "completed",
								github_url: githubUrl,
								webhook_sent_at: Date.now(),
							},
						);
						logJobComplete(jobId, "completed", Date.now() - jobStartTime);

						if (updatedJob) {
							await sendWebhook(updatedJob, this.env.GITHUB_REPO, branch);
						}
					},
				);
				return;
			}

			const folderName =
				existingCheck.existingFolder || `${datePrefix}-${slug}`;
			const outputPath = `ideas/${folderName}/research.md`;
			const isUpdate = !!(existingCheck.existingFolder && update);

			// Step 4: Run Claude Code exploration (no retries - re-running can produce different results)
			await step.do(
				"run-claude",
				{ timeout: "15 minutes", retries: { limit: 0, delay: "1 second" } },
				async () => {
				const sandbox = getSandbox(this.env.Sandbox, jobId);
				await sandbox.exec(`mkdir -p "/workspace/ideas/${folderName}"`);

				const promptFile =
					mode === "business"
						? "/prompts/business.md"
						: "/prompts/exploration.md";

				const prompt = buildPrompt({
					idea,
					context,
					isUpdate,
					datePrefix,
					promptFile,
					outputPath,
				});

				const modelName = model === "opus" ? "opus" : "sonnet";
				const claudeCmd = `claude --model ${modelName} -p "${escapeShell(prompt)}" --permission-mode acceptEdits`;

				logClaudeStarted(jobId, modelName);
				try {
					await sandbox.exec(claudeCmd, { cwd: "/workspace" });
				} catch (claudeError) {
					logError(jobId, "claude_execution", claudeError);
					const claudeErrorMsg =
						claudeError instanceof Error
							? claudeError.message
							: "Claude execution failed";
					throw new Error(`Claude Code error: ${claudeErrorMsg}`);
				}
				logInfo(jobId, "claude_complete");
			});

			// Step 5: Commit and push results
			await step.do(
				"commit-push",
				{ retries: { limit: 3, delay: "15 seconds" }, timeout: "2 minutes" },
				async () => {
					const sandbox = getSandbox(this.env.Sandbox, jobId);
					const commitMessage = isUpdate
						? `idea: ${slug} - research updated`
						: `idea: ${slug} - research complete`;

					await commitAndPush(sandbox, {
						outputPath,
						message: escapeShell(commitMessage),
						branch,
						repoUrl,
						jobId,
					});
				},
			);

			// Step 6: Notify completion
			await step.do(
				"notify",
				{ retries: { limit: 3, delay: "10 seconds" }, timeout: "30 seconds" },
				async () => {
					const existingJob = await getJob(
						this.env.IDEA_EXPLORER_JOBS,
						jobId,
					);
					if (existingJob?.webhook_sent_at) {
						logInfo(jobId, "webhook_already_sent");
						return;
					}

					const githubUrl = `https://github.com/${this.env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
					const updatedJob = await updateJob(
						this.env.IDEA_EXPLORER_JOBS,
						jobId,
						{
							status: "completed",
							github_url: githubUrl,
							webhook_sent_at: Date.now(),
						},
					);
					logJobComplete(jobId, "completed", Date.now() - jobStartTime);

					if (updatedJob) {
						await sendWebhook(updatedJob, this.env.GITHUB_REPO, branch);
					}
				},
			);
		} catch (error) {
			// Update job status to failed
			await this.handleFailure(jobId, error, branch, jobStartTime);
			throw error;
		}
	}

	private async handleFailure(
		jobId: string,
		error: unknown,
		branch: string,
		jobStartTime: number,
	): Promise<void> {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		const isTimeout =
			errorMessage.includes("timeout") ||
			errorMessage.includes("TIMEOUT") ||
			errorMessage.includes("timed out");

		const finalError = isTimeout
			? "Container execution timed out (15 minute limit exceeded)"
			: errorMessage;

		logError(jobId, "exploration_failed", new Error(finalError));

		const existingJob = await getJob(this.env.IDEA_EXPLORER_JOBS, jobId);
		if (existingJob?.webhook_sent_at) {
			logInfo(jobId, "webhook_already_sent");
			return;
		}

		const updatedJob = await updateJob(this.env.IDEA_EXPLORER_JOBS, jobId, {
			status: "failed",
			error: finalError,
			webhook_sent_at: Date.now(),
		});

		logJobComplete(jobId, "failed", Date.now() - jobStartTime);

		if (updatedJob) {
			await sendWebhook(updatedJob, this.env.GITHUB_REPO, branch);
		}
	}
}
