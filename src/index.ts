import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import { requireAuth, type AuthEnv } from './middleware/auth';
import { createJob, getJob, updateJob, type ExploreRequest, type Job } from './jobs';
import { generateSlug } from './utils/slug';
import { sendWebhook } from './utils/webhook';

interface ExploreEnv extends AuthEnv {
  ANTHROPIC_API_KEY: string;
  GITHUB_PAT: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  Sandbox: DurableObjectNamespace<Sandbox>;
}

function isValidExploreRequest(body: unknown): body is ExploreRequest {
  if (typeof body !== 'object' || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.idea !== 'string' || obj.idea.trim() === '') return false;
  if (typeof obj.webhook_url !== 'string' || obj.webhook_url.trim() === '') return false;
  if (obj.mode !== undefined && obj.mode !== 'business' && obj.mode !== 'exploration') return false;
  if (obj.model !== undefined && obj.model !== 'sonnet' && obj.model !== 'opus') return false;
  if (obj.callback_secret !== undefined && typeof obj.callback_secret !== 'string') return false;
  if (obj.context !== undefined && typeof obj.context !== 'string') return false;
  return true;
}

function getDatePrefix(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function logError(jobId: string, operation: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.log(JSON.stringify({ 
    level: 'error', 
    job_id: jobId, 
    operation, 
    error: errorMessage,
    timestamp: new Date().toISOString()
  }));
}

function logInfo(jobId: string, event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ 
    level: 'info', 
    job_id: jobId, 
    event, 
    ...data,
    timestamp: new Date().toISOString()
  }));
}

async function cloneWithRetry(
  sandbox: ReturnType<typeof getSandbox>,
  repoUrl: string,
  branch: string,
  jobId: string
): Promise<void> {
  const cloneCmd = `git clone --depth 1 --branch ${branch} ${repoUrl} /workspace`;
  try {
    await sandbox.exec(cloneCmd);
  } catch (error) {
    logError(jobId, 'clone_first_attempt', error);
    logInfo(jobId, 'clone_retry');
    await sandbox.exec(cloneCmd);
  }
}

async function pushWithRetry(
  sandbox: ReturnType<typeof getSandbox>,
  branch: string,
  repoUrl: string,
  jobId: string
): Promise<void> {
  try {
    await sandbox.exec(`git push origin ${branch}`, { cwd: '/workspace' });
  } catch (error) {
    logError(jobId, 'push_first_attempt', error);
    logInfo(jobId, 'push_retry_with_pull');
    await sandbox.exec(`git pull --rebase ${repoUrl} ${branch}`, { cwd: '/workspace' });
    await sandbox.exec(`git push origin ${branch}`, { cwd: '/workspace' });
  }
}

async function runExploration(job: Job, env: ExploreEnv): Promise<void> {
  updateJob(job.id, { status: 'running' });
  logInfo(job.id, 'exploration_started', { idea: job.idea, mode: job.mode, model: job.model });

  const sandbox = getSandbox(env.Sandbox, job.id);
  const slug = generateSlug(job.idea);
  const datePrefix = getDatePrefix();
  const folderName = `${datePrefix}-${slug}`;
  const outputPath = `ideas/${folderName}/research.md`;
  const branch = env.GITHUB_BRANCH || 'main';
  const repoUrl = `https://x-access-token:$GITHUB_PAT@github.com/${env.GITHUB_REPO}.git`;
  
  try {
    await sandbox.setEnvVars({ 
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GITHUB_PAT: env.GITHUB_PAT,
    });
    
    await cloneWithRetry(sandbox, repoUrl, branch, job.id);
    logInfo(job.id, 'clone_complete');
    
    await sandbox.exec(`mkdir -p /workspace/ideas/${folderName}`);
    
    const promptFile = job.mode === 'business' ? '/prompts/business.md' : '/prompts/exploration.md';
    const contextPart = job.context ? `\n\nAdditional context: ${job.context}` : '';
    const prompt = `Read the prompt template at ${promptFile} and use it to analyze the following idea. Write your complete analysis to /workspace/${outputPath}

Idea: ${job.idea}${contextPart}

After completing your analysis, make sure the file /workspace/${outputPath} contains your full research output.`;
    
    const model = job.model === 'opus' ? 'opus' : 'sonnet';
    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const claudeCmd = `claude --model ${model} -p "${escapedPrompt}" --permission-mode acceptEdits`;
    
    logInfo(job.id, 'claude_started', { model });
    try {
      await sandbox.exec(claudeCmd, { cwd: '/workspace' });
    } catch (claudeError) {
      logError(job.id, 'claude_execution', claudeError);
      const claudeErrorMsg = claudeError instanceof Error ? claudeError.message : 'Claude execution failed';
      throw new Error(`Claude Code error: ${claudeErrorMsg}`);
    }
    logInfo(job.id, 'claude_complete');
    
    await sandbox.exec('git config user.email "idea-explorer@workers.dev"', { cwd: '/workspace' });
    await sandbox.exec('git config user.name "Idea Explorer"', { cwd: '/workspace' });
    
    await sandbox.exec(`git add ${outputPath}`, { cwd: '/workspace' });
    
    const commitMessage = `idea: ${slug} - research complete`;
    await sandbox.exec(`git commit -m "${commitMessage}"`, { cwd: '/workspace' });
    
    await pushWithRetry(sandbox, branch, repoUrl, job.id);
    logInfo(job.id, 'push_complete');
    
    const githubUrl = `https://github.com/${env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
    const updatedJob = updateJob(job.id, { status: 'completed', github_url: githubUrl });
    logInfo(job.id, 'exploration_complete', { status: 'completed', github_url: githubUrl });
    
    if (updatedJob) {
      await sendWebhook(updatedJob, env.GITHUB_REPO, branch);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT') || errorMessage.includes('timed out');
    
    const finalError = isTimeout 
      ? 'Container execution timed out (15 minute limit exceeded)' 
      : errorMessage;
    
    logError(job.id, 'exploration_failed', new Error(finalError));
    const updatedJob = updateJob(job.id, { status: 'failed', error: finalError });
    
    if (updatedJob) {
      await sendWebhook(updatedJob, env.GITHUB_REPO, branch);
    }
  }
}

export default {
  async fetch(request: Request, env: ExploreEnv): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === 'POST' && url.pathname === '/explore') {
      const auth = requireAuth(request, env);
      if (!auth.success) return auth.response;
      
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
      
      if (!isValidExploreRequest(body)) {
        return Response.json(
          { error: 'Bad Request: idea and webhook_url are required fields' },
          { status: 400 }
        );
      }
      
      const job = createJob(body);
      
      runExploration(job, env);
      
      return Response.json(
        { job_id: job.id, status: 'pending' },
        { status: 202 }
      );
    }
    
    const statusMatch = url.pathname.match(/^\/status\/([^/]+)$/);
    if (request.method === 'GET' && statusMatch) {
      const auth = requireAuth(request, env);
      if (!auth.success) return auth.response;
      
      const jobId = statusMatch[1];
      const job = getJob(jobId);
      
      if (!job) {
        return Response.json(
          { error: 'Job not found' },
          { status: 404 }
        );
      }
      
      const response: Record<string, string> = {
        status: job.status,
        idea: job.idea,
        mode: job.mode,
      };
      
      if (job.status === 'completed' && job.github_url) {
        response.github_url = job.github_url;
      }
      
      if (job.status === 'failed' && job.error) {
        response.error = job.error;
      }
      
      return Response.json(response);
    }
    
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};

export { Sandbox };
