import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import { requireAuth, type AuthEnv } from './middleware/auth';
import { createJob, getJob, updateJob, type ExploreRequest, type Job } from './jobs';
import { generateSlug } from './utils/slug';

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

async function runExploration(job: Job, env: ExploreEnv): Promise<void> {
  updateJob(job.id, { status: 'running' });

  const sandbox = getSandbox(env.Sandbox, job.id);
  const slug = generateSlug(job.idea);
  const datePrefix = getDatePrefix();
  const folderName = `${datePrefix}-${slug}`;
  const outputPath = `ideas/${folderName}/research.md`;
  const branch = env.GITHUB_BRANCH || 'main';
  
  try {
    await sandbox.setEnvVars({ 
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GITHUB_PAT: env.GITHUB_PAT,
    });
    
    const repoUrl = `https://x-access-token:$GITHUB_PAT@github.com/${env.GITHUB_REPO}.git`;
    await sandbox.exec(`git clone --depth 1 --branch ${branch} ${repoUrl} /workspace`);
    
    await sandbox.exec(`mkdir -p /workspace/ideas/${folderName}`);
    
    const promptFile = job.mode === 'business' ? '/prompts/business.md' : '/prompts/exploration.md';
    const contextPart = job.context ? `\n\nAdditional context: ${job.context}` : '';
    const prompt = `Read the prompt template at ${promptFile} and use it to analyze the following idea. Write your complete analysis to /workspace/${outputPath}

Idea: ${job.idea}${contextPart}

After completing your analysis, make sure the file /workspace/${outputPath} contains your full research output.`;
    
    const model = job.model === 'opus' ? 'opus' : 'sonnet';
    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const claudeCmd = `claude --model ${model} -p "${escapedPrompt}" --permission-mode acceptEdits`;
    
    await sandbox.exec(claudeCmd, { cwd: '/workspace' });
    
    await sandbox.exec('git config user.email "idea-explorer@workers.dev"', { cwd: '/workspace' });
    await sandbox.exec('git config user.name "Idea Explorer"', { cwd: '/workspace' });
    
    await sandbox.exec(`git add ${outputPath}`, { cwd: '/workspace' });
    
    const commitMessage = `idea: ${slug} - research complete`;
    await sandbox.exec(`git commit -m "${commitMessage}"`, { cwd: '/workspace' });
    
    await sandbox.exec(`git push origin ${branch}`, { cwd: '/workspace' });
    
    const githubUrl = `https://github.com/${env.GITHUB_REPO}/blob/${branch}/${outputPath}`;
    updateJob(job.id, { status: 'completed', github_url: githubUrl });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateJob(job.id, { status: 'failed', error: errorMessage });
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
