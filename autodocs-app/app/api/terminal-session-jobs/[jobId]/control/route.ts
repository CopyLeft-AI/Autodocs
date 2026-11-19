import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { controlMlJob, MlJobConflictError, MlJobNotFoundError, type MlJobControlAction } from '@/app/lib/server/ml-jobs';
import { isLocalCpuJobsEnabled } from '@/app/lib/server/processing-mode';
import { getRequestUser } from '@/app/lib/server/request-auth';

const CONTROL_ACTIONS: readonly MlJobControlAction[] = ['pause', 'resume', 'cancel'];

function isControlAction(value: unknown): value is MlJobControlAction {
  return typeof value === 'string' && (CONTROL_ACTIONS as readonly string[]).includes(value);
}

/** Pause, resume or cancel one of the signed-in user's analysis jobs. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isLocalCpuJobsEnabled()) return NextResponse.json({ message: 'Analysis job processing is disabled.' }, { status: 409 });

  const { jobId } = await params;
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  if (!isControlAction(body.action)) {
    return NextResponse.json({ message: `action must be one of: ${CONTROL_ACTIONS.join(', ')}.` }, { status: 400 });
  }

  const owned = await db.query(`SELECT 1 FROM terminal_session_jobs WHERE id = $1 AND user_id = $2`, [jobId, user.id]);
  if (!owned.rows[0]) return NextResponse.json({ message: 'Upload job not found.' }, { status: 404 });

  try {
    const job = await controlMlJob(jobId, body.action);
    await db.query(
      `UPDATE terminal_session_jobs SET status = $2, progress_percent = $3, updated_at = NOW() WHERE id = $1 AND user_id = $4`,
      [jobId, job.status, job.percent, user.id],
    );
    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof MlJobNotFoundError) return NextResponse.json({ message: 'Upload job not found.' }, { status: 404 });
    if (error instanceof MlJobConflictError) return NextResponse.json({ message: error.message }, { status: 409 });
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Could not control analysis.' }, { status: 502 });
  }
}
