import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { deleteMlJob, MlJobNotFoundError, readMlJob } from '@/app/lib/server/ml-jobs';
import { isLocalCpuJobsEnabled } from '@/app/lib/server/processing-mode';
import { getRequestUser } from '@/app/lib/server/request-auth';
import { RequestError } from '@/app/lib/server/recordings/errors';
import { readJobAndSaveResult } from '@/app/lib/server/recordings/job-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isLocalCpuJobsEnabled()) return NextResponse.json({ message: 'Analysis job processing is disabled.' }, { status: 409 });
  const { jobId } = await params;
  try {
    const progress = await readJobAndSaveResult(user, jobId);
    if (!progress) return NextResponse.json({ message: 'Upload job not found.' }, { status: 404 });
    return NextResponse.json(progress);
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error('Could not read analysis job:', jobId, error);
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Could not read upload job.' }, { status: 502 });
  }
}


export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  if (!isLocalCpuJobsEnabled()) {
    return NextResponse.json({ message: 'Analysis jobs are disabled.' }, { status: 409 });
  }

  const { jobId } = await params;

  const row = (await db.query<{ id: string; status: string; terminal_session_id: string | null }>(
    `SELECT id, status, terminal_session_id FROM terminal_session_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, user.id],
  )).rows[0];

  if (!row) {
    return NextResponse.json({ message: 'Upload job not found.' }, { status: 404 });
  }

  if (row.terminal_session_id) {
    return NextResponse.json(
      { message: 'Saved terminal sessions cannot be deleted here.' },
      { status: 409 },
    );
  }

  try {
    let alreadyMissing = false;

    try {
      const job = await readMlJob(jobId);
      if (job.status !== 'failed' && job.status !== 'cancelled') {
        return NextResponse.json(
          { message: 'Only failed or cancelled jobs can be deleted. Cancel the analysis first.' },
          { status: 409 },
        );
      }

      await db.query(
        `UPDATE terminal_session_jobs
         SET status = $4, error_message = $3, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND terminal_session_id IS NULL`,
        [jobId, user.id, job.error, job.status],
      );
    } catch (error) {
      if (error instanceof MlJobNotFoundError) {
        alreadyMissing = true;
      } else {
        throw error;
      }
    }

    if (alreadyMissing && row.status !== 'failed' && row.status !== 'cancelled') {
      return NextResponse.json(
        { message: 'Cannot delete an unverified missing ML job.' },
        { status: 409 },
      );
    }

    if (!alreadyMissing) {
      await deleteMlJob(jobId);
    }

    const deleted = await db.query(
      `DELETE FROM terminal_session_jobs
       WHERE id = $1 AND user_id = $2 AND terminal_session_id IS NULL`,
      [jobId, user.id],
    );

    if (deleted.rowCount !== 1) {
      throw new Error('Could not remove the upload job from PostgreSQL.');
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Could not delete job.' },
      { status: 502 },
    );
  }
}
