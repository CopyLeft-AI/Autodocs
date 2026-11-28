import { NextRequest, NextResponse } from 'next/server';
import { requireUuid, signedIn } from '@/app/lib/server/recordings/http';
import { exportRecording } from '@/app/lib/server/recordings/session-service';

type Context = { params: Promise<{ terminalSessionId: string }> };

/** A file name that survives any character, in both header forms. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest, { params }: Context) {
  return signedIn(request, async (user) => {
    const sessionId = requireUuid((await params).terminalSessionId);
    const withAnnotations = request.nextUrl.searchParams.get('annotations') === '1';
    const { fileName, text } = await exportRecording(user.id, sessionId, withAnnotations);
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'application/x-asciicast; charset=utf-8',
        'Content-Disposition': contentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
