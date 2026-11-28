import { NextRequest, NextResponse } from 'next/server';
import { listHistory } from '@/app/lib/server/recordings/annotation-service';
import { requireUuid, signedIn } from '@/app/lib/server/recordings/http';

type Context = { params: Promise<{ terminalSessionId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const sessionId = requireUuid((await params).terminalSessionId);
    return NextResponse.json({ revisions: await listHistory(user.id, sessionId) });
  });
}
