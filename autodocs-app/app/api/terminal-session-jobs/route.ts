import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { MlJobNotFoundError, readMlJob } from '@/app/lib/server/ml-jobs';
import { isLocalCpuJobsEnabled } from '@/app/lib/server/processing-mode';
import { getRequestUser } from '@/app/lib/server/request-auth';

/** Upper bound on analyses returned at once; keeps the status poll cheap. */
const MAX_LISTED_JOBS = 20;

/** Lists every analysis the user still needs to see: active, stopped, or finished but unsaved. */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isLocalCpuJobsEnabled()) return NextResponse.json({ enabled: false, jobs: [] });
  const result = await db.query<{ id: string; target_session_id: string | null }>(`SELECT id, target_session_id FROM terminal_session_jobs WHERE user_id = $1
  AND (
    status IN ('queued', 'running', 'paused', 'failed', 'cancelled')
    OR (status = 'completed' AND terminal_session_id IS NULL)
  )
ORDER BY created_at DESC LIMIT $2`, [user.id, MAX_LISTED_JOBS]);
  try {
    const settled = await Promise.all(result.rows.map(async (row) => {
      try {
        return { ...await readMlJob(row.id), sessionId: row.target_session_id };
      } catch (error) {
        // A job the ML service no longer knows about cannot be shown or controlled.
        if (error instanceof MlJobNotFoundError) return null;
        throw error;
      }
    }));
    const jobs = settled.filter((job): job is NonNullable<typeof job> => job !== null);
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
