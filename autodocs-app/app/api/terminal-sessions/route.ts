import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { getRequestUser } from '@/app/lib/server/request-auth';
import { readBody, signedIn } from '@/app/lib/server/recordings/http';
import { createSession } from '@/app/lib/server/recordings/session-service';

interface TerminalSessionRow {
  id: string;
  title: string;
  durationSeconds: number;
  content: string;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const result = await db.query<TerminalSessionRow>(
      `SELECT ts.id,
              ts.title,
              ts.duration_seconds AS "durationSeconds",
              ts.content,
              ts.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM annotations a WHERE a.terminal_session_id = ts.id) AS "annotationCount"
       FROM terminal_sessions ts
       INNER JOIN terminal_session_access tsa
         ON tsa.terminal_session_id = ts.id
       WHERE tsa.user_id = $1 AND tsa.owner = TRUE
       ORDER BY ts.created_at DESC`,
      [user.id],
    );
    return NextResponse.json({ terminalSessions: result.rows });
  } catch (e){
    console.log(e);
    return NextResponse.json({ message: 'Failed to fetch sessions.' }, { status: 500 });
  }
}

/** Store a recording. Analysis is a separate request, so nothing starts by itself. */
export async function POST(request: NextRequest) {
  return signedIn(request, async (user) => {
    const body = await readBody(request);
    const terminalSession = await createSession(user, { title: body.title, content: body.content });
    return NextResponse.json({ terminalSession }, { status: 201 });
  });
}
