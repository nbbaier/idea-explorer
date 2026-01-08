import type { Job } from '../jobs';

export interface WebhookSuccessPayload {
  status: 'completed';
  job_id: string;
  idea: string;
  github_url: string;
  github_raw_url: string;
}

export interface WebhookFailurePayload {
  status: 'failed';
  job_id: string;
  idea: string;
  error: string;
}

export type WebhookPayload = WebhookSuccessPayload | WebhookFailurePayload;

async function generateSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hashHex}`;
}

function buildSuccessPayload(job: Job, githubRepo: string, branch: string): WebhookSuccessPayload {
  const outputPath = job.github_url?.split(`/blob/${branch}/`)[1] ?? '';
  const githubRawUrl = `https://raw.githubusercontent.com/${githubRepo}/${branch}/${outputPath}`;
  
  return {
    status: 'completed',
    job_id: job.id,
    idea: job.idea,
    github_url: job.github_url!,
    github_raw_url: githubRawUrl,
  };
}

function buildFailurePayload(job: Job): WebhookFailurePayload {
  return {
    status: 'failed',
    job_id: job.id,
    idea: job.idea,
    error: job.error ?? 'Unknown error',
  };
}

export async function sendWebhook(
  job: Job,
  githubRepo: string,
  branch: string
): Promise<{ success: boolean; statusCode?: number }> {
  const payload: WebhookPayload = job.status === 'completed'
    ? buildSuccessPayload(job, githubRepo, branch)
    : buildFailurePayload(job);
  
  const body = JSON.stringify(payload);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (job.callback_secret) {
    headers['X-Signature'] = await generateSignature(job.callback_secret, body);
  }
  
  try {
    const response = await fetch(job.webhook_url, {
      method: 'POST',
      headers,
      body,
    });
    
    return {
      success: response.ok,
      statusCode: response.status,
    };
  } catch {
    return { success: false };
  }
}
