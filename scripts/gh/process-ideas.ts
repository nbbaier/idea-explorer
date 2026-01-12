import path from "node:path";
import { logError, logInfo, logWarn } from "../../src/utils/logger";
import {
  addComment,
  addLabel,
  delay,
  fetchIssuesByLabel,
  getConfig,
  githubApi,
  type Issue,
  type Label,
  removeLabel,
} from "./shared";

const { baseUrl, bearerToken, githubToken, repo } = getConfig();

const NEWLINE_REGEX = /\r?\n/;
const IDEA_REGEX = /^\[IDEA\]\s*/;

function extractIssueFormSection(body: string, heading: string): string {
  const lines = body.split(NEWLINE_REGEX);
  let found = false;
  const result: string[] = [];

  for (const line of lines) {
    if (found) {
      if (line.startsWith("### ")) {
        break;
      }
      result.push(line);
    }
    if (line === `### ${heading}`) {
      found = true;
    }
  }
  return result.join("\n").trim();
}

async function getIssueLabels(issueNumber: number): Promise<string[]> {
  const response = await githubApi(
    githubToken,
    `/repos/${repo}/issues/${issueNumber}/labels`,
    { method: "GET" }
  );
  const labels: Label[] = await response.json();
  return labels.map((l) => l.name);
}

async function processIssue(issue: Issue): Promise<void> {
  const { number, title, body } = issue;
  logInfo("processing_issue_start", { issue_number: number, title });

  const labels = await getIssueLabels(number);
  logInfo("issue_labels_fetched", { issue_number: number, labels });

  if (
    labels.includes("idea-processing") ||
    labels.includes("idea-completed") ||
    labels.includes("idea-failed")
  ) {
    logWarn("issue_skipped_already_processed", {
      issue_number: number,
      existing_labels: labels.filter((l) =>
        ["idea-processing", "idea-completed", "idea-failed"].includes(l)
      ),
    });
    return;
  }

  await addLabel(githubToken, repo, number, "idea-processing");
  logInfo("label_added", { issue_number: number, label: "idea-processing" });

  const titleClean = title.replace(IDEA_REGEX, "");

  let formIdea = "";
  let formContext = "";
  let formMode = "";

  if (body) {
    formIdea = extractIssueFormSection(body, "What's your idea?");
    if (!formIdea) {
      formIdea = extractIssueFormSection(body, "Idea");
    }

    formMode = extractIssueFormSection(body, "Analysis Mode");
    if (formMode) {
      formMode = formMode.trim();
    } else {
      formMode = "business";
    }

    formContext = extractIssueFormSection(
      body,
      "Additional Context (Optional)"
    );
    if (!formContext) {
      formContext = extractIssueFormSection(body, "Additional Context");
    }
  }

  let ideaText = titleClean;
  if (formIdea) {
    ideaText = `${titleClean}\n\n${formIdea}`;
  } else if (body) {
    ideaText = `${titleClean}\n\n${body}`;
  }

  const payload: Record<string, string> = {
    idea: ideaText,
    mode: formMode,
    model: "sonnet",
  };

  if (formContext.replace(/\s+/g, "").length > 0) {
    payload.context = formContext;
  }

  logInfo("exploration_request_prepared", {
    issue_number: number,
    has_form_idea: !!formIdea,
    has_form_context: formContext.replace(/\s+/g, "").length > 0,
    idea_length: ideaText.length,
  });

  try {
    logInfo("exploration_request_sending", { issue_number: number });
    const exploreUrl = path.join(baseUrl, "/api/explore");
    const response = await fetch(exploreUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      const data = await response.json();
      const jobId = (data as { job_id: string }).job_id;
      logInfo("exploration_request_success", {
        issue_number: number,
        job_id: jobId,
        status_code: response.status,
      });

      const statusUrl = path.join(baseUrl, "/api/status", jobId);

      await addComment(
        githubToken,
        repo,
        number,
        `🚀 Idea exploration started! Job ID: \`${jobId}\`

The analysis will be available soon. You can check the status at:
\`\`\`
${statusUrl}
\`\`\`

I'll update this issue when the exploration is complete.`
      );
      logInfo("comment_added", { issue_number: number, type: "success" });
    } else {
      const errorBody = await response.text();
      logError("exploration_request_failed", new Error(errorBody), {
        issue_number: number,
        status_code: response.status,
      });

      await removeLabel(githubToken, repo, number, "idea-processing");
      await addLabel(githubToken, repo, number, "idea-failed");
      await addComment(
        githubToken,
        repo,
        number,
        `❌ Failed to submit idea for exploration. Error: HTTP ${response.status}`
      );
      logInfo("labels_updated_failed", { issue_number: number });
    }
  } catch (error) {
    logError("exploration_request_exception", error, {
      issue_number: number,
    });
    await removeLabel(githubToken, repo, number, "idea-processing");
    await addLabel(githubToken, repo, number, "idea-failed");
    await addComment(
      githubToken,
      repo,
      number,
      `❌ Failed to submit idea for exploration. Error: ${error}`
    );
    logInfo("labels_updated_failed", { issue_number: number });
  }

  await delay(2000);
  logInfo("processing_issue_complete", { issue_number: number });
}

async function main(): Promise<void> {
  logInfo("process_ideas_start", { label: "idea" });
  const issues = await fetchIssuesByLabel(githubToken, repo, "idea");
  logInfo("issues_fetched", { count: issues.length, label: "idea" });

  for (const issue of issues) {
    await processIssue(issue);
  }

  logInfo("process_ideas_complete", { processed_count: issues.length });
}

main().catch((error) => {
  logError("process_ideas_fatal", error);
  process.exit(1);
});
