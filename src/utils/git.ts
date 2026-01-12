import type { getSandbox } from "@cloudflare/sandbox";
import { logCommitPushed, logError, logInfo } from "./logger";

type SandboxInstance = ReturnType<typeof getSandbox>;

/**
 * Checks if there are any uncommitted changes in the workspace
 */
export async function hasUncommittedChanges(
  sandbox: SandboxInstance
): Promise<boolean> {
  try {
    const result = await sandbox.exec("git status --porcelain", {
      cwd: "/workspace",
    });
    const output = typeof result === "string" ? result : (result?.stdout ?? "");
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Attempts to commit and push any partial work, used for checkpoints and salvage operations
 */
export async function commitPartialWork(
  sandbox: SandboxInstance,
  {
    folderPath,
    message,
    branch,
    repoUrl,
    jobId,
  }: {
    folderPath: string;
    message: string;
    branch: string;
    repoUrl: string;
    jobId: string;
  }
): Promise<boolean> {
  try {
    await configureGitUser(sandbox);
    await sandbox.exec(`git add "${folderPath}"`, { cwd: "/workspace" });

    const hasChanges = await hasUncommittedChanges(sandbox);
    if (!hasChanges) {
      logInfo("checkpoint_no_changes", undefined, jobId);
      return false;
    }

    await sandbox.exec(`git commit -m "${message}"`, { cwd: "/workspace" });
    await pushWithRetry(sandbox, branch, repoUrl, jobId);
    logInfo("checkpoint_committed", undefined, jobId);
    return true;
  } catch (error) {
    logError("checkpoint_failed", error, undefined, jobId);
    return false;
  }
}

/**
 * Clones a repository with retry logic
 */
export async function cloneWithRetry(
  sandbox: SandboxInstance,
  repoUrl: string,
  branch: string,
  jobId: string
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
  jobId: string
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
  sandbox: SandboxInstance
): Promise<void> {
  await sandbox.exec('git config user.email "idea-explorer@workers.dev"', {
    cwd: "/workspace",
  });
  await sandbox.exec('git config user.name "Idea Explorer"', {
    cwd: "/workspace",
  });
}

/**
 * Counts the number of WIP checkpoint commits for a given slug
 */
export async function countWipCommits(
  sandbox: SandboxInstance,
  slug: string
): Promise<number> {
  try {
    const result = await sandbox.exec(
      `git log --oneline --grep="WIP: checkpoint" --grep="${slug}" --all-match`,
      { cwd: "/workspace" }
    );
    const output = typeof result === "string" ? result : (result?.stdout ?? "");
    const lines = output.trim().split("\n").filter(Boolean);
    return lines.length;
  } catch {
    return 0;
  }
}

/**
 * Squashes WIP checkpoint commits into a single final commit.
 * Uses soft reset to the commit before the first WIP, then commits all changes.
 */
export async function squashWipCommits(
  sandbox: SandboxInstance,
  {
    slug,
    finalMessage,
    jobId,
  }: {
    slug: string;
    finalMessage: string;
    jobId: string;
  }
): Promise<boolean> {
  try {
    const wipCount = await countWipCommits(sandbox, slug);
    if (wipCount === 0) {
      return false;
    }

    logInfo("squash_starting", undefined, jobId);

    await sandbox.exec(`git reset --soft HEAD~${wipCount}`, {
      cwd: "/workspace",
    });
    await sandbox.exec(`git commit -m "${finalMessage}"`, {
      cwd: "/workspace",
    });

    logInfo("squash_complete", undefined, jobId);
    return true;
  } catch (error) {
    logError("squash_failed", error, undefined, jobId);
    return false;
  }
}

/**
 * Moves a folder to ideas/.partial/ for failed/incomplete work
 */
export async function moveToPartial(
  sandbox: SandboxInstance,
  {
    folderName,
    jobId,
  }: {
    folderName: string;
    jobId: string;
  }
): Promise<boolean> {
  try {
    const sourcePath = `ideas/${folderName}`;
    const partialDir = "ideas/.partial";
    const destPath = `${partialDir}/${folderName}`;

    await sandbox.exec(`mkdir -p "/workspace/${partialDir}"`, {
      cwd: "/workspace",
    });
    await sandbox.exec(
      `mv "/workspace/${sourcePath}" "/workspace/${destPath}"`,
      {
        cwd: "/workspace",
      }
    );

    logInfo("move_to_partial_complete", undefined, jobId);
    return true;
  } catch (error) {
    logError("move_to_partial_failed", error, undefined, jobId);
    return false;
  }
}

/**
 * Creates and pushes a git commit
 */
export async function commitAndPush(
  sandbox: SandboxInstance,
  {
    outputPath,
    additionalPaths,
    message,
    branch,
    repoUrl,
    jobId,
  }: {
    outputPath: string;
    additionalPaths?: string[];
    message: string;
    branch: string;
    repoUrl: string;
    jobId: string;
  }
): Promise<void> {
  await configureGitUser(sandbox);
  await sandbox.exec(`git add "${outputPath}"`, { cwd: "/workspace" });
  if (additionalPaths) {
    for (const path of additionalPaths) {
      await sandbox.exec(`git add "${path}"`, { cwd: "/workspace" });
    }
  }
  await sandbox.exec(`git commit -m "${message}"`, { cwd: "/workspace" });
  await pushWithRetry(sandbox, branch, repoUrl, jobId);
  logCommitPushed(jobId);
}
