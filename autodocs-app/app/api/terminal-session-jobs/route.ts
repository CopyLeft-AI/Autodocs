import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { createJobId, enqueueMlJob, MlJobNotFoundError, readMlJob, type MlJobStatus } from '@/app/lib/server/ml-jobs';
import { isLocalCpuJobsEnabled } from '@/app/lib/server/processing-mode';
import { getRequestUser } from '@/app/lib/server/request-auth';
import { readRemoteApiConcurrency } from '@/app/lib/server/user-settings';

interface JobBody { title?: string; durationSeconds?: number; content?: string; }

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isLocalCpuJobsEnabled()) return NextResponse.json({ message: 'Analysis job processing is disabled. Use the legacy terminal-session endpoint.' }, { status: 409 });
  try {
    const body = (await request.json()) as JobBody;
    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!title || !content) return NextResponse.json({ message: 'title and content are required.' }, { status: 400 });
    if (!Number.isInteger(body.durationSeconds) || (body.durationSeconds ?? -1) < 0) return NextResponse.json({ message: 'durationSeconds must be a non-negative integer.' }, { status: 400 });
    const jobId = createJobId();
    await db.query(`INSERT INTO terminal_session_jobs (id, user_id, title, duration_seconds, status) VALUES ($1, $2, $3, $4, 'queued')`, [jobId, user.id, title, body.durationSeconds]);
    try {
      const job = await enqueueMlJob({ id: jobId, title, content, parallelRequests: (await readRemoteApiConcurrency(user.id)) ?? undefined });
      return NextResponse.json({ job }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start analysis.';
      await db.query(`UPDATE terminal_session_jobs SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`, [jobId, message]);
      return NextResponse.json({ message }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Could not create upload job.' }, { status: 500 });
  }
}

/** Upper bound on analyses returned at once; keeps the status poll cheap. */
const MAX_LISTED_JOBS = 20;

/** Lists every analysis the user still needs to see: active, stopped, or finished but unsaved. */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isLocalCpuJobsEnabled()) return NextResponse.json({ enabled: false, jobs: [] });
  const result = await db.query<{ id: string }>(`SELECT id FROM terminal_session_jobs WHERE user_id = $1
  AND (
    status IN ('queued', 'running', 'paused', 'failed', 'cancelled')
    OR (status = 'completed' AND terminal_session_id IS NULL)
  )
ORDER BY created_at DESC LIMIT $2`, [user.id, MAX_LISTED_JOBS]);
  try {
    const settled = await Promise.all(result.rows.map(async (row) => {
      try {
        return await readMlJob(row.id);
      } catch (error) {
        // A job the ML service no longer knows about cannot be shown or controlled.
        if (error instanceof MlJobNotFoundError) return null;
        throw error;
      }
    }));
    const jobs = settled.filter((job): job is MlJobStatus => job !== null);
    for (const job of jobs) {
      await db.query(
        `UPDATE terminal_session_jobs SET status = $2, progress_percent = $3, error_message = $4, updated_at = NOW() WHERE id = $1 AND user_id = $5`,
        [job.id, job.status, job.percent, job.error, user.id],
      );
    }
    return NextResponse.json({ enabled: true, jobs });
  } catch (error) {
    console.error('Could not read current ML jobs:', error);
    return NextResponse.json(
      { message: 'Could not read analysis status. Please retry.' },
      { status: 502 },
    );
  }
}
