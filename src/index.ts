import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import {
	createJob,
	type ExploreRequest,
	getJob,
	type Job,
	updateJob,
} from "./jobs";
import { requireAuth } from "./middleware/auth";
import { cloneWithRetry, commitAndPush } from "./utils/git";
import {
	logClaudeStarted,
	logCloneComplete,
	logContainerStarted,
	logError,
	logInfo,
	logJobComplete,
	logJobCreated,
} from "./utils/logger";
import { escapeShell } from "./utils/shell";
import { generateSlug } from "./utils/slug";
import { sendWebhook } from "./utils/webhook";

type ExploreEnv = Env & { WEBHOOK_URL?: string; JOBS: KVNamespace };

const app = new Hono<{ Bindings: ExploreEnv }>();

app.use("*", requireAuth());

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
	if (obj.update !== undefined && typeof obj.update !== "boolean") return false;
	return true;
}

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
			{
				cwd: "/workspace",
			},
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
		// No ideas directory yet, that's fine
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

async function handleExistingIdea({
	job,
	env,
	existingFolder,
	branch,
	jobStartTime,
}: {
	job: Job;
	env: ExploreEnv;
	existingFolder: string;
	branch: string;
	jobStartTime: number;
}): Promise<void> {
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
}

async function handleExplorationError({
	error,
	job,
	env,
	branch,
	jobStartTime,
}: {
	error: unknown;
	job: Job;
	env: ExploreEnv;
	branch: string;
	jobStartTime: number;
}): Promise<void> {
	const errorMessage = error instanceof Error ? error.message : "Unknown error";
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

		const existingFolder = await findExistingIdeaFolder(sandbox, slug);

		if (existingFolder && !job.update) {
			await handleExistingIdea({
				job,
				env,
				existingFolder,
				branch,
				jobStartTime,
			});
			return;
		}

		const folderName = existingFolder || `${datePrefix}-${slug}`;
		const outputPath = `ideas/${folderName}/research.md`;
		const isUpdate = !!(existingFolder && job.update);

		await sandbox.exec(`mkdir -p "/workspace/ideas/${folderName}"`);

		const promptFile =
			job.mode === "business"
				? "/prompts/business.md"
				: "/prompts/exploration.md";

		const prompt = buildPrompt({
			idea: job.idea,
			context: job.context,
			isUpdate,
			datePrefix,
			promptFile,
			outputPath,
		});

		const model = job.model === "opus" ? "opus" : "sonnet";
		const claudeCmd = `claude --model ${model} -p "${escapeShell(prompt)}" --permission-mode acceptEdits`;

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

		const commitMessage = isUpdate
			? `idea: ${slug} - research updated`
			: `idea: ${slug} - research complete`;

		await commitAndPush(sandbox, {
			outputPath,
			message: escapeShell(commitMessage),
			branch,
			repoUrl,
			jobId: job.id,
		});

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
		await handleExplorationError({
			error,
			job,
			env,
			branch,
			jobStartTime,
		});
	}
}

app.post("/explore", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	if (!isValidExploreRequest(body)) {
		return c.json({ error: "Bad Request: idea is required" }, 400);
	}

	const webhookUrl = body.webhook_url || c.env.WEBHOOK_URL;

	const job = await createJob(c.env.JOBS, {
		...body,
		webhook_url: webhookUrl,
	});
	logJobCreated(job.id, job.idea, job.mode);

	c.executionCtx.waitUntil(runExploration(job, c.env));

	return c.json({ job_id: job.id, status: "pending" }, 202);
});

app.get("/status/:id", async (c) => {
	const jobId = c.req.param("id");
	const job = await getJob(c.env.JOBS, jobId);

	if (!job) {
		return c.json({ error: "Job not found" }, 404);
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

	return c.json(response);
});

app.get("/test-webhook", async (c) => {
	const webhookUrl = c.req.query("webhook_url") || c.env.WEBHOOK_URL;
	const status = c.req.query("status") === "failed" ? "failed" : "completed";
	const callbackSecret = c.req.query("callback_secret");

	if (!webhookUrl) {
		return c.json(
			{ error: "webhook_url query parameter or WEBHOOK_URL env var required" },
			400,
		);
	}

	const mockJob: Job = {
		id: `test-${crypto.randomUUID().slice(0, 8)}`,
		idea: "Test idea for webhook verification",
		mode: "business",
		model: "sonnet",
		status,
		webhook_url: webhookUrl,
		callback_secret: callbackSecret,
		created_at: Date.now(),
		...(status === "completed"
			? {
					github_url: `https://github.com/${c.env.GITHUB_REPO}/blob/main/ideas/2025-01-01-test-idea/research.md`,
				}
			: { error: "Test error message" }),
	};

	const result = await sendWebhook(
		mockJob,
		c.env.GITHUB_REPO,
		c.env.GITHUB_BRANCH || "main",
		{ "X-Test-Webhook": "true" },
	);

	return c.json({
		message: "Mock webhook sent",
		webhook_url: webhookUrl,
		status,
		result,
	});
});

app.all("*", (c) => c.json({ error: "Not found" }, 404));

export default app;
export { Sandbox };
