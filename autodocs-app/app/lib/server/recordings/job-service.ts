// Ours
import { db } from '@/app/lib/server/db';
import { readMlJob, type MlJobStatus } from '@/app/lib/server/ml-jobs';
import { transaction } from './access';
import { saveAnalysisResult } from './analysis-service';
import type { Actor } from './annotation-store';

interface JobRow {
  title: string;
  duration_seconds: number;
  terminal_session_id: string | null;
  target_session_id: string | null;
}

export interface JobProgress {
  job: MlJobStatus;
  /** Set once the finished result has been saved. */
  terminalSessionId: string | null;
}

const COLUMNS = 'title, duration_seconds, terminal_session_id, target_session_id';

/** Read a job's progress; save its result exactly once when it has completed. */
export async function readJobAndSaveResult(user: Actor, jobId: string): Promise<JobProgress | null> {
  const row = (await db.query<JobRow>(`SELECT ${COLUMNS} FROM terminal_session_jobs WHERE id = $1 AND user_id = $2`, [jobId, user.id])).rows[0];
  if (!row) return null;
  const job = { ...await readMlJob(jobId), sessionId: row.target_session_id };
  await db.query('UPDATE terminal_session_jobs SET status = $2, progress_percent = $3, error_message = $4, updated_at = NOW() WHERE id = $1', [jobId, job.status, job.percent, job.error]);
  const result = job.result;
  if (job.status !== 'completed' || !result || row.terminal_session_id) return { job, terminalSessionId: row.terminal_session_id };
  const terminalSessionId = await transaction(async (client) => {
    // The row lock makes two simultaneous polls save the result only once.
    const locked = (await client.query<JobRow>(`SELECT ${COLUMNS} FROM terminal_session_jobs WHERE id = $1 FOR UPDATE`, [jobId])).rows[0];
    if (locked.terminal_session_id) return locked.terminal_session_id;
    let sessionId = locked.target_session_id;
    if (!sessionId) {
      // Jobs queued before recordings were stored at upload still create their session here.
      sessionId = (await client.query<{ id: string }>(
        `INSERT INTO terminal_sessions (title, duration_seconds, content, legacy_imported) VALUES ($1, $2, '', TRUE) RETURNING id`,
        [locked.title, locked.duration_seconds],
      )).rows[0].id;
      await client.query('INSERT INTO terminal_session_access (user_id, terminal_session_id, owner) VALUES ($1, $2, TRUE)', [user.id, sessionId]);
    }
    await saveAnalysisResult(client, sessionId, user, result);
    await client.query('UPDATE terminal_session_jobs SET terminal_session_id = $2, updated_at = NOW() WHERE id = $1', [jobId, sessionId]);
    return sessionId;
  });
  return { job, terminalSessionId };
}
