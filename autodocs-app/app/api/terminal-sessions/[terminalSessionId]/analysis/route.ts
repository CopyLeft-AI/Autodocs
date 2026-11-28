import { NextRequest, NextResponse } from 'next/server';
import { startAnalysis } from '@/app/lib/server/recordings/analysis-service';
import { readBody, requireUuid, signedIn } from '@/app/lib/server/recordings/http';

type Context = { params: Promise<{ terminalSessionId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const sessionId = requireUuid((await params).terminalSessionId);
    const started = await startAnalysis(user, sessionId, (await readBody(request)).options);
    return NextResponse.json(started, { status: 'job' in started ? 202 : 201 });
  });
}
