import type { getSandbox } from "@cloudflare/sandbox";
import { logCommitPushed, logError, logInfo } from "./logger";

type SandboxInstance = ReturnType<typeof getSandbox>;

/**
 * Clones a repository with retry logic
 */
export async function cloneWithRetry(
	sandbox: SandboxInstance,
	repoUrl: string,
	branch: string,
	jobId: string,
): Promise<void> {
	const cloneCmd = `git clone --filter=blob:none --sparse --branch "${branch}" "${repoUrl}" /workspace`;
	try {
		await sandbox.exec(cloneCmd);
	} catch (error) {
		logError("clone_first_attempt", error, undefined, jobId);
		logInfo("clone_retry", undefined, jobId);
		await sandbox.exec(cloneCmd);
	}
	await sandbox.exec("git sparse-checkout set ideas/", { cwd: "/workspace" });
}

/**
 * Pushes changes to remote with retry logic
 */
export async function pushWithRetry(
	sandbox: SandboxInstance,
	branch: string,
	repoUrl: string,
	jobId: string,
): Promise<void> {
	try {
		await sandbox.exec(`git push origin "${branch}"`, { cwd: "/workspace" });
	} catch (error) {
		logError("push_first_attempt", error, undefined, jobId);
		logInfo("push_retry_with_pull", undefined, jobId);
		await sandbox.exec(`git pull --rebase "${repoUrl}" "${branch}"`, {
			cwd: "/workspace",
		});
		await sandbox.exec(`git push origin "${branch}"`, { cwd: "/workspace" });
	}
}

/**
 * Configures git user identity for commits
 */
export async function configureGitUser(
	sandbox: SandboxInstance,
): Promise<void> {
	await sandbox.exec('git config user.email "idea-explorer@workers.dev"', {
		cwd: "/workspace",
	});
	await sandbox.exec('git config user.name "Idea Explorer"', {
		cwd: "/workspace",
	});
}

/**
 * Creates and pushes a git commit
 */
export async function commitAndPush(
	sandbox: SandboxInstance,
	{
		outputPath,
		message,
		branch,
		repoUrl,
		jobId,
	}: {
		outputPath: string;
		message: string;
		branch: string;
		repoUrl: string;
		jobId: string;
	},
): Promise<void> {
	await configureGitUser(sandbox);
	await sandbox.exec(`git add "${outputPath}"`, { cwd: "/workspace" });
	await sandbox.exec(`git commit -m "${message}"`, { cwd: "/workspace" });
	await pushWithRetry(sandbox, branch, repoUrl, jobId);
	logCommitPushed(jobId);
}
