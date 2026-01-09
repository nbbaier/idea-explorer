import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import {
	createJob,
	type ExploreRequest,
	getJob,
	type Job,
	updateJob,
} from "./jobs";
import { type AuthEnv, requireAuth } from "./middleware/auth";
import {
	logClaudeStarted,
	logCloneComplete,
	logCommitPushed,
	logContainerStarted,
	logError,
	logInfo,
	logJobComplete,
	logJobCreated,
} from "./utils/logger";
import { generateSlug } from "./utils/slug";
import { sendWebhook } from "./utils/webhook";

interface ExploreEnv extends AuthEnv {
	ANTHROPIC_API_KEY: string;
	GITHUB_PAT: string;
	GITHUB_REPO: string;
	GITHUB_BRANCH: string;
	WEBHOOK_URL?: string;
	Sandbox: DurableObjectNamespace<Sandbox>;
	JOBS: KVNamespace;
}

function isValidExploreRequest(body: unknown): body is ExploreRequest {
	if (typeof body !== "object" || body === null) return false;
	const obj = body as Record<string, unknown>;
	if (typeof obj.idea !== "string" || obj.idea.trim() === "") return false;
	if (
		obj.webhook_url !== undefined &&
		(typeof obj.webhook_url !== "string" || obj.webhook_url.trim() === "")
	)
		return false;
	if (
		obj.mode !== undefined &&
		obj.mode !== "business" &&
		obj.mode !== "exploration"
	)
		return false;
	if (obj.model !== undefined && obj.model !== "sonnet" && obj.model !== "opus")
		return false;
	if (
		obj.callback_secret !== undefined &&
		typeof obj.callback_secret !== "string"
	)
		return false;
	if (obj.context !== undefined && typeof obj.context !== "string")
		return false;
	if (obj.update !== undefined && typeof obj.update !== "boolean")
		return false;
	return true;
}

function getDatePrefix(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

async function cloneWithRetry(
	sandbox: ReturnType<typeof getSandbox>,
	repoUrl: string,
	branch: string,
	jobId: string,
): Promise<void> {
	const cloneCmd = `git clone --filter=blob:none --sparse --branch "${branch}" "${repoUrl}" /workspace`;
	try {
		await sandbox.exec(cloneCmd);
	} catch (error) {
		logError(jobId, "clone_first_attempt", error);
		logInfo(jobId, "clone_retry");
		await sandbox.exec(cloneCmd);
	}
	await sandbox.exec("git sparse-checkout set ideas/", { cwd: "/workspace" });
}

async function pushWithRetry(
	sandbox: ReturnType<typeof getSandbox>,
	branch: string,
	repoUrl: string,
	jobId: string,
): Promise<void> {
	try {
		await sandbox.exec(`git push origin "${branch}"`, { cwd: "/workspace" });
	} catch (error) {
		logError(jobId, "push_first_attempt", error);
		logInfo(jobId, "push_retry_with_pull");
		await sandbox.exec(`git pull --rebase "${repoUrl}" "${branch}"`, {
			cwd: "/workspace",
		});
		await sandbox.exec(`git push origin "${branch}"`, { cwd: "/workspace" });
	}
}

async function findExistingIdeaFolder(
	sandbox: ReturnType<typeof getSandbox>,
	slug: string,
): Promise<string | null> {
	try {
		const result = await sandbox.exec("ls /workspace/ideas/ 2>/dev/null || true", {
			cwd: "/workspace",
		});
		const stdout = typeof result === "string" ? result : (result as { stdout?: string }).stdout ?? "";
		const folders = stdout.trim().split("\n").filter(Boolean);
		for (const folder of folders) {
			if (folder.endsWith(`-${slug}`)) {
				return folder;
			}
		}
	} catch {
		// No ideas directory yet, that's fine
	}
	return null;
}

async function runExploration(job: Job, env: ExploreEnv): Promise<void> {
	const jobStartTime = Date.now();
	await updateJob(env.JOBS, job.id, { status: "running" });
	logContainerStarted(job.id);

	const sandbox = getSandbox(env.Sandbox, job.id);
	const slug = generateSlug(job.idea);
	const datePrefix = getDatePrefix();
	const branch = env.GITHUB_BRANCH || "main";
	const repoUrl = `https://x-access-token:${env.GITHUB_PAT}@github.com/${env.GITHUB_REPO}.git`;

	try {
		await sandbox.setEnvVars({
			ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
			GITHUB_PAT: env.GITHUB_PAT,
		});

		const cloneStartTime = Date.now();
		await cloneWithRetry(sandbox, repoUrl, branch, job.id);
		logCloneComplete(job.id, Date.now() - cloneStartTime);

		// Check if idea already exists
		const existingFolder = await findExistingIdeaFolder(sandbox, slug);

		if (existingFolder && !job.update) {
			// Return existing URL without re-running analysis
			const outputPath = `ideas/${existingFolder}/research.md`;
			const githubUrl = `https://github.com/${env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
			logInfo(job.id, "existing_idea_found");
			const updatedJob = await updateJob(env.JOBS, job.id, {
				status: "completed",
				github_url: githubUrl,
			});
			logJobComplete(job.id, "completed", Date.now() - jobStartTime);
			if (updatedJob) {
				await sendWebhook(updatedJob, env.GITHUB_REPO, branch);
			}
			return;
		}

		// Determine folder and output path
		const folderName = existingFolder || `${datePrefix}-${slug}`;
		const outputPath = `ideas/${folderName}/research.md`;
		const isUpdate = existingFolder && job.update;

		await sandbox.exec(`mkdir -p "/workspace/ideas/${folderName}"`);

		const promptFile =
			job.mode === "business"
				? "/prompts/business.md"
				: "/prompts/exploration.md";
		const contextPart = job.context
			? `\n\nAdditional context: ${job.context}`
			: "";

		let prompt: string;
		if (isUpdate) {
			// Update mode: append new section to existing research
			prompt = `Read the prompt template at ${promptFile} and the existing research at /workspace/${outputPath}.

Analyze the following idea with fresh perspective. Append a new section to the existing research file with the header:

## Update - ${datePrefix}

Include new insights, updated analysis, or changed recommendations based on current thinking.

Idea: ${job.idea}${contextPart}

Make sure to preserve all existing content and append the new update section at the end of /workspace/${outputPath}.`;
		} else {
			// New idea mode
			prompt = `Read the prompt template at ${promptFile} and use it to analyze the following idea. Write your complete analysis to /workspace/${outputPath}

Idea: ${job.idea}${contextPart}

After completing your analysis, make sure the file /workspace/${outputPath} contains your full research output.`;
		}

		const model = job.model === "opus" ? "opus" : "sonnet";
		const escapedPrompt = prompt
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/`/g, "\\`")
			.replace(/\$/g, "\\$")
			.replace(/\n/g, "\\n");
		const claudeCmd = `claude --model ${model} -p "${escapedPrompt}" --permission-mode acceptEdits`;

		logClaudeStarted(job.id, model);
		try {
			await sandbox.exec(claudeCmd, { cwd: "/workspace" });
		} catch (claudeError) {
			logError(job.id, "claude_execution", claudeError);
			const claudeErrorMsg =
				claudeError instanceof Error
					? claudeError.message
					: "Claude execution failed";
			throw new Error(`Claude Code error: ${claudeErrorMsg}`);
		}
		logInfo(job.id, "claude_complete");

		await sandbox.exec('git config user.email "idea-explorer@workers.dev"', {
			cwd: "/workspace",
		});

		await sandbox.exec('git config user.name "Idea Explorer"', {
			cwd: "/workspace",
		});

		await sandbox.exec(`git add "${outputPath}"`, { cwd: "/workspace" });

		const commitMessage = isUpdate
			? `idea: ${slug} - research updated`
			: `idea: ${slug} - research complete`;
		const escapedMessage = commitMessage
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/`/g, "\\`")
			.replace(/\$/g, "\\$");
		await sandbox.exec(`git commit -m "${escapedMessage}"`, {
			cwd: "/workspace",
		});

		await pushWithRetry(sandbox, branch, repoUrl, job.id);
		logCommitPushed(job.id);

		const githubUrl = `https://github.com/${env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
		const updatedJob = await updateJob(env.JOBS, job.id, {
			status: "completed",
			github_url: githubUrl,
		});
		logJobComplete(job.id, "completed", Date.now() - jobStartTime);

		if (updatedJob) {
			await sendWebhook(updatedJob, env.GITHUB_REPO, branch);
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		const isTimeout =
			errorMessage.includes("timeout") ||
			errorMessage.includes("TIMEOUT") ||
			errorMessage.includes("timed out");

		const finalError = isTimeout
			? "Container execution timed out (15 minute limit exceeded)"
			: errorMessage;

		logError(job.id, "exploration_failed", new Error(finalError));
		const updatedJob = await updateJob(env.JOBS, job.id, {
			status: "failed",
			error: finalError,
		});
		logJobComplete(job.id, "failed", Date.now() - jobStartTime);

		if (updatedJob) {
			await sendWebhook(updatedJob, env.GITHUB_REPO, branch);
		}
	}
}

export default {
	async fetch(
		request: Request,
		env: ExploreEnv,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/explore") {
			const auth = requireAuth(request, env);
			if (!auth.success) return auth.response;

			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return Response.json({ error: "Invalid JSON body" }, { status: 400 });
			}

			if (!isValidExploreRequest(body)) {
				return Response.json(
					{ error: "Bad Request: idea is required" },
					{ status: 400 },
				);
			}

			const webhookUrl = body.webhook_url || env.WEBHOOK_URL;

			const job = await createJob(env.JOBS, {
				...body,
				webhook_url: webhookUrl,
			});
			logJobCreated(job.id, job.idea, job.mode);

			ctx.waitUntil(runExploration(job, env));

			return Response.json(
				{ job_id: job.id, status: "pending" },
				{ status: 202 },
			);
		}

		const statusMatch = url.pathname.match(/^\/status\/([^/]+)$/);
		if (request.method === "GET" && statusMatch) {
			const auth = requireAuth(request, env);
			if (!auth.success) return auth.response;

			const jobId = statusMatch[1];
			const job = await getJob(env.JOBS, jobId);

			if (!job) {
				return Response.json({ error: "Job not found" }, { status: 404 });
			}

			const response: Record<string, string> = {
				status: job.status,
				idea: job.idea,
				mode: job.mode,
			};

			if (job.status === "completed" && job.github_url) {
				response.github_url = job.github_url;
			}

			if (job.status === "failed" && job.error) {
				response.error = job.error;
			}

			return Response.json(response);
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
};

export { Sandbox };
