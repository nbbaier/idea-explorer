import path from "node:path";
import { logError, logInfo, logWarn } from "../../src/utils/logger";
import {
	addComment,
	addLabel,
	type Comment,
	delay,
	fetchIssuesByLabel,
	getConfig,
	githubApi,
	type Issue,
	removeLabel,
} from "./shared";

const { baseUrl, bearerToken, githubToken, repo } = getConfig();

async function closeIssue(issueNumber: number): Promise<void> {
	logInfo("closing_issue", { issue_number: issueNumber });
	await githubApi(githubToken, `/repos/${repo}/issues/${issueNumber}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ state: "closed" }),
	});
	logInfo("issue_closed", { issue_number: issueNumber });
}

async function getIssueComments(issueNumber: number): Promise<Comment[]> {
	logInfo("fetching_comments", { issue_number: issueNumber });
	const response = await githubApi(
		githubToken,
		`/repos/${repo}/issues/${issueNumber}/comments`,
		{ method: "GET" },
	);
	const comments = (await response.json()) as Comment[];
	logInfo("comments_fetched", {
		issue_number: issueNumber,
		comment_count: (comments as Comment[]).length,
	});
	return comments as Comment[];
}

function extractJobId(comments: Comment[]): string | null {
	for (const comment of comments) {
		const match = comment.body.match(/Job ID: `([^`]+)`/);
		if (match) return match[1];
	}
	return null;
}

interface StatusResponse {
	status: string;
	github_url?: string;
	error?: string;
}

async function checkJobStatus(jobId: string): Promise<StatusResponse | null> {
	logInfo("checking_job_status", { job_id: jobId });
	const statusUrl = path.join(baseUrl, "/api/status", jobId);
	const response = await fetch(statusUrl, {
		headers: {
			Authorization: `Bearer ${bearerToken}`,
		},
	});

	if (response.status !== 200) {
		logWarn("job_status_check_failed", {
			job_id: jobId,
			status_code: response.status,
		});
		return null;
	}

	const status = await response.json();
	logInfo("job_status_retrieved", {
		job_id: jobId,
		status: (status as StatusResponse).status,
	});
	return status as StatusResponse;
}

async function processIssue(issue: Issue): Promise<void> {
	const { number, title } = issue;
	logInfo("checking_issue_start", { issue_number: number, title });

	const comments = await getIssueComments(number);
	const jobId = extractJobId(comments);

	if (!jobId) {
		logWarn("no_job_id_found", { issue_number: number });
		return;
	}

	logInfo("job_id_extracted", { issue_number: number, job_id: jobId });

	const status = await checkJobStatus(jobId);
	if (!status) {
		logWarn("status_check_failed", { issue_number: number, job_id: jobId });
		return;
	}

	logInfo("job_status_received", {
		issue_number: number,
		job_id: jobId,
		status: status.status,
	});

	if (status.status === "completed") {
		logInfo("job_completed", {
			issue_number: number,
			job_id: jobId,
			github_url: status.github_url,
		});

		await removeLabel(githubToken, repo, number, "idea-processing");
		await addLabel(githubToken, repo, number, "idea-completed");
		logInfo("labels_updated_completed", { issue_number: number });

		await addComment(
			githubToken,
			repo,
			number,
			`✅ Idea exploration complete!

Research available at: ${status.github_url}

The AI has completed analyzing your idea. Check out the research document for insights and recommendations!`,
		);
		logInfo("comment_added", { issue_number: number, type: "completed" });

		await closeIssue(number);
		logInfo("issue_updated_completed", { issue_number: number });
	} else if (status.status === "failed") {
		const errorMsg = status.error || "Unknown error";
		logError("job_failed", new Error(errorMsg), {
			issue_number: number,
			job_id: jobId,
		});

		await removeLabel(githubToken, repo, number, "idea-processing");
		await addLabel(githubToken, repo, number, "idea-failed");
		logInfo("labels_updated_failed", { issue_number: number });

		await addComment(
			githubToken,
			repo,
			number,
			`❌ Idea exploration failed

Error: ${errorMsg}

You may want to try submitting the idea again or adjust the description.`,
		);
		logInfo("comment_added", { issue_number: number, type: "failed" });

		logInfo("issue_updated_failed", { issue_number: number });
	} else {
		logInfo("job_still_in_progress", {
			issue_number: number,
			job_id: jobId,
			status: status.status,
		});
	}

	await delay(2000);
	logInfo("checking_issue_complete", { issue_number: number });
}

async function main(): Promise<void> {
	logInfo("update_status_start", { label: "idea-processing" });
	const issues = await fetchIssuesByLabel(githubToken, repo, "idea-processing");
	logInfo("issues_fetched", {
		count: issues.length,
		label: "idea-processing",
	});

	for (const issue of issues) {
		await processIssue(issue);
	}

	logInfo("update_status_complete", { checked_count: issues.length });
}

main().catch((error) => {
	logError("update_status_fatal", error);
	process.exit(1);
});
