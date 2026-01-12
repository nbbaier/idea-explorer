export interface Config {
  baseUrl: string;
  bearerToken: string;
  githubToken: string;
  repo: string;
}

export function getConfig(): Config {
  const baseUrl = process.env.IDEA_EXPLORER_API_URL;
  const bearerToken = process.env.IDEA_EXPLORER_API_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!baseUrl) {
    throw new Error("IDEA_EXPLORER_API_URL must be set");
  }

  if (!bearerToken) {
    throw new Error("IDEA_EXPLORER_API_TOKEN must be set");
  }

  if (!githubToken) {
    throw new Error("GITHUB_TOKEN must be set");
  }

  if (!repo) {
    throw new Error("GITHUB_REPOSITORY must be set");
  }

  return { baseUrl, bearerToken, githubToken, repo };
}

export function githubApi(
  githubToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: Label[];
}

export interface Comment {
  body: string;
}

export interface Label {
  name: string;
}

export async function addLabel(
  githubToken: string,
  repo: string,
  issueNumber: number,
  label: string
): Promise<void> {
  await githubApi(githubToken, `/repos/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labels: [label] }),
  });
}

export async function removeLabel(
  githubToken: string,
  repo: string,
  issueNumber: number,
  label: string
): Promise<void> {
  await githubApi(
    githubToken,
    `/repos/${repo}/issues/${issueNumber}/labels/${label}`,
    { method: "DELETE" }
  );
}

export async function addComment(
  githubToken: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await githubApi(
    githubToken,
    `/repos/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }
  );
}

export async function fetchIssuesByLabel(
  githubToken: string,
  repo: string,
  label: string
): Promise<Issue[]> {
  const issues: Issue[] = [];
  let page = 1;

  while (true) {
    const response = await githubApi(
      githubToken,
      `/repos/${repo}/issues?labels=${label}&state=open&per_page=100&page=${page}`,
      { method: "GET" }
    );
    const pageIssues: Issue[] = await response.json();
    if (pageIssues.length === 0) {
      break;
    }
    issues.push(...pageIssues);
    page++;
  }

  return issues;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
