// External
import { NextRequest, NextResponse } from 'next/server';

// Ours
import { getRequestUser } from '@/app/lib/server/request-auth';
import type { SessionUser } from '@/app/lib/server/session-auth';
import { RequestError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run a handler and turn failures into JSON error responses. */
export async function handled(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error('Request failed:', error);
    return NextResponse.json({ message: 'The request could not be completed.' }, { status: 500 });
  }
}

/** Authenticate, then run the handler. */
export async function signedIn(request: NextRequest, handler: (user: SessionUser) => Promise<Response>): Promise<Response> {
  return handled(async () => {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    return handler(user);
  });
}

export function requireUuid(value: string): string {
  if (!UUID.test(value)) throw new RequestError(404, 'Not found.');
  return value;
}

export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'The request body must be a JSON object.');
  return body as Record<string, unknown>;
}
