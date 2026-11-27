import { NextRequest, NextResponse } from 'next/server';
import { deleteAnnotation, updateAnnotation } from '@/app/lib/server/recordings/annotation-service';
import { readBody, requireUuid, signedIn } from '@/app/lib/server/recordings/http';

type Context = { params: Promise<{ terminalSessionId: string; annotationId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const { terminalSessionId, annotationId } = await params;
    const annotation = await updateAnnotation(user, requireUuid(terminalSessionId), requireUuid(annotationId), await readBody(request));
    return NextResponse.json({ annotation });
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const { terminalSessionId, annotationId } = await params;
    await deleteAnnotation(user, requireUuid(terminalSessionId), requireUuid(annotationId));
    return NextResponse.json({ deleted: true });
  });
}
