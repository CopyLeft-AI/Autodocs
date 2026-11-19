import crypto from 'crypto';

export interface MlJobStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed';
  current: number;
  total: number;
  /** True while total is a running guess (event count is unknown until all boundaries are found). */
  estimated: boolean;
  detail: string;
}

export interface MlJobTimelineEvent {
  at: string;
  kind: string;
  message: string;
}

export type MlJobState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** Usage of the local processing resources; null when inference runs on a remote API. */
export interface MlJobResources {
  cpu: { percent: number; cores: number; busyCores: number };
  gpu: { percent: number; count: number } | null;
}

export type MlJobControlAction = 'pause' | 'resume' | 'cancel';

export interface MlJobStatus {
  id: string;
  title: string;
  status: MlJobState;
  percent: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  /** Model requests this job runs at once; 1 for local inference. */
  parallelRequests: number;
  /** Estimated seconds left; null until enough work has finished to estimate. */
  etaSeconds: number | null;
  resources: MlJobResources | null;
  stages: MlJobStage[];
  timeline: MlJobTimelineEvent[];
  error: string | null;
  result: { content: string[] } | null;
}

function mlUrl(): string {
  const url = process.env.ML_URL;
  if (!url) throw new Error('ML_URL is not set');
  return url.replace(/\/$/, '');
}

export async function enqueueMlJob(input: { id: string; title: string; content: string; parallelRequests?: number }): Promise<MlJobStatus> {
  const response = await fetch(`${mlUrl()}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: input.id, title: input.title, content: input.content, parallelRequests: input.parallelRequests }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ML job enqueue failed with status ${response.status}`);
  return response.json() as Promise<MlJobStatus>;
}

export class MlJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`ML job not found: ${jobId}`);
    this.name = 'MlJobNotFoundError';
  }
}

export async function readMlJob(jobId: string): Promise<MlJobStatus> {
  const response = await fetch(`${mlUrl()}/jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new MlJobNotFoundError(jobId);
  if (!response.ok) throw new Error(`ML job status failed with status ${response.status}`);
  return response.json() as Promise<MlJobStatus>;
}

export async function deleteMlJob(jobId: string): Promise<void> {
  const response = await fetch(`${mlUrl()}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`ML job deletion failed with status ${response.status}`);
  }
}

export class MlJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlJobConflictError';
  }
}

/** Ask the ML service to pause, resume or cancel a job; returns its new state. */
export async function controlMlJob(jobId: string, action: MlJobControlAction): Promise<MlJobStatus> {
  const response = await fetch(`${mlUrl()}/jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new MlJobNotFoundError(jobId);
  if (response.status === 409) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new MlJobConflictError(body.detail ?? `Cannot ${action} this job in its current state.`);
  }
  if (!response.ok) throw new Error(`ML job ${action} failed with status ${response.status}`);
  return response.json() as Promise<MlJobStatus>;
}

export function createJobId(): string {
  return crypto.randomUUID();
}

/** Settings shape returned by the ML service's GET/PUT /config (API keys never included). */
export interface MlConfigStep {
  stored: Record<string, string | number | undefined>;
  effective: {
    backend: string; model: string; baseUrl: string; timeoutSeconds: number; maxTokens: number;
    numThread: number; maxAttempts: number; reasoningEffort: string; summaryWordLimit: number;
  };
  apiKeySet: boolean;
  apiKeyInFile: boolean;
}

export interface MlConfig {
  path: string;
  steps: { boundaries: MlConfigStep; annotate: MlConfigStep };
  processing: {
    stored: Record<string, string | number | undefined>;
    effective: { remoteApiConcurrency: number; maxConcurrentJobs: number; inferenceLocation: string };
  };
  schema: {
    backends: string[]; chatBackends: string[]; reasoningEfforts: string[]; locations: string[];
    limits: Record<string, { min: number; max: number }>;
  };
}

/** The ML service rejected a configuration update (HTTP 422); the message says why. */
export class MlConfigRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlConfigRejectedError';
  }
}

export async function readMlConfig(): Promise<MlConfig> {
  const response = await fetch(`${mlUrl()}/config`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ML config read failed with status ${response.status}`);
  return response.json() as Promise<MlConfig>;
}

/** Merge `changes` into the ML service's config file. Omit `apiKey` to keep it; null resets a value. */
export async function writeMlConfig(changes: unknown): Promise<MlConfig> {
  const response = await fetch(`${mlUrl()}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 422) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new MlConfigRejectedError(body.detail ?? 'The settings were rejected.');
  }
  if (!response.ok) throw new Error(`ML config update failed with status ${response.status}`);
  return response.json() as Promise<MlConfig>;
}
