import { NextRequest, NextResponse } from 'next/server';
import { deleteLayer, updateLayer } from '@/app/lib/server/recordings/annotation-service';
import { readBody, requireUuid, signedIn } from '@/app/lib/server/recordings/http';

type Context = { params: Promise<{ terminalSessionId: string; layerId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const { terminalSessionId, layerId } = await params;
    const layers = await updateLayer(user, requireUuid(terminalSessionId), requireUuid(layerId), await readBody(request));
    return NextResponse.json({ layers });
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const { terminalSessionId, layerId } = await params;
    await deleteLayer(user, requireUuid(terminalSessionId), requireUuid(layerId));
    return NextResponse.json({ deleted: true });
  });
}
