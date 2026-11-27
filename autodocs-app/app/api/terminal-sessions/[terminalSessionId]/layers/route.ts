import { NextRequest, NextResponse } from 'next/server';
import { createLayer } from '@/app/lib/server/recordings/annotation-service';
import { readBody, requireUuid, signedIn } from '@/app/lib/server/recordings/http';

type Context = { params: Promise<{ terminalSessionId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const sessionId = requireUuid((await params).terminalSessionId);
    const layer = await createLayer(user, sessionId, await readBody(request));
    return NextResponse.json({ layer }, { status: 201 });
  });
}
