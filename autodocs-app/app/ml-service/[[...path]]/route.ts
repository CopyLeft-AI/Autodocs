import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { forwardToMl, hasUnsafeSegment } from '@/app/lib/server/ml-proxy';

type RouteContext = { params: Promise<{ path?: string[] }> };

/**
 * Forward a call to the ML service, which has no login of its own, so only
 * administrators may use it. Exists so the Swagger page at /ml-service/docs can
 * "Try it out" without exposing the service's private address.
 */
async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { path = [] } = await context.params;
  if (hasUnsafeSegment(path)) return NextResponse.json({ message: 'Invalid path.' }, { status: 400 });
  try {
    return await forwardToMl(request, path);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('ML service proxy failed:', error);
    return NextResponse.json({ message: 'Could not reach the analysis service.' }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
