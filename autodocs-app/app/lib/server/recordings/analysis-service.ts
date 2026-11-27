// External
import type { PoolClient } from 'pg';

// Ours
import { readModels, readResultEvents, type AnalysisOptions } from '@/app/lib/annotations/analysis';
import { timeAnalysisEvents } from '@/app/lib/annotations/legacy';
import { toVersion2 } from '@/app/lib/cast/parse';
import { db } from '@/app/lib/server/db';
import { createJobId, enqueueMlJob, mlServiceUrl, type MlJobStatus } from '@/app/lib/server/ml-jobs';
import { readRemoteApiConcurrency } from '@/app/lib/server/user-settings';
import { requireAccess, transaction } from './access';
import { checkAnalysisOptions, readAnalysisChoices } from './analysis-options';
import { insertAnnotatedLayer, type Actor } from './annotation-store';
import { RequestError } from './errors';
import { getSessionDetail, loadRecordingText, readRecording } from './session-service';

export type StartedAnalysis = { job: MlJobStatus } | { completed: true };

/** Add a finished analysis to a session as a new timeline; earlier annotations stay as they are. */
export async function saveAnalysisResult(
  client: PoolClient,
  sessionId: string,
  actor: Actor,
  result: { content: string[]; models?: unknown },
): Promise<void> {
  await requireAccess(actor.id, sessionId, 'annotate', client);
  const session = (await client.query<{ durationSeconds: number }>(
    'SELECT duration_seconds AS "durationSeconds" FROM terminal_sessions WHERE id = $1 FOR UPDATE',
    [sessionId],
  )).rows[0];
  if (!session) throw new RequestError(404, 'Session not found.');
  const models = readModels(result.models);
  const events = readResultEvents(result.content);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await insertAnnotatedLayer(client, sessionId, {
    title: `AI ${models.annotate?.model ?? 'analysis'} ${stamp}`,
    annotations: timeAnalysisEvents(events, session.durationSeconds * 1000),
  }, { origin: 'ai', actor, models });
  // The event list kept for the session overview shows the latest analysis.
  await client.query('UPDATE terminal_sessions SET content = $2 WHERE id = $1', [sessionId, JSON.stringify({ version: 2, events })]);
}

async function startDirect(actor: Actor, sessionId: string, title: string, content: string, options: AnalysisOptions): Promise<StartedAnalysis> {
  const response = await fetch(mlServiceUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, options }),
  });
  if (!response.ok) {
    console.error('ML service error:', response.status, await response.text());
    throw new RequestError(502, 'The analysis service could not process this recording.');
  }
  const result = await response.json() as { content?: string[]; models?: unknown };
  if (!Array.isArray(result.content)) throw new RequestError(502, 'The analysis service answered in an unknown format.');
  await transaction((client) => saveAnalysisResult(client, sessionId, actor, { content: result.content!, models: result.models }));
  return { completed: true };
}

async function startJob(actor: Actor, sessionId: string, title: string, content: string, options: AnalysisOptions, durationSeconds: number): Promise<StartedAnalysis> {
  const jobId = createJobId();
  await db.query(
    `INSERT INTO terminal_session_jobs (id, user_id, title, duration_seconds, status, target_session_id, settings)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6)`,
    [jobId, actor.id, title, durationSeconds, sessionId, JSON.stringify(options)],
  );
  try {
    const parallelRequests = (await readRemoteApiConcurrency(actor.id)) ?? undefined;
    const job = await enqueueMlJob({ id: jobId, title, content, parallelRequests, options });
    return { job: { ...job, sessionId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start analysis.';
    console.error('Could not enqueue analysis job:', jobId, message);
    await db.query(`UPDATE terminal_session_jobs SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`, [jobId, message]);
    throw new RequestError(502, 'Could not start the analysis. Is the analysis service running?');
  }
}

/** Run a model on a stored recording. */
export async function startAnalysis(actor: Actor, sessionId: string, requested: unknown): Promise<StartedAnalysis> {
  await requireAccess(actor.id, sessionId, 'annotate');
  const detail = await getSessionDetail(actor.id, sessionId);
  const { title, text } = await loadRecordingText(actor.id, sessionId);
  const choices = await readAnalysisChoices(actor.id);
  const options = checkAnalysisOptions(requested, choices);
  // The service reads version 2 only; this also drops any annotations in the header.
  const content = toVersion2(readRecording(text).recording);
  return choices.mode === 'jobs'
    ? startJob(actor, sessionId, title, content, options, detail.durationSeconds)
    : startDirect(actor, sessionId, title, content, options);
}
