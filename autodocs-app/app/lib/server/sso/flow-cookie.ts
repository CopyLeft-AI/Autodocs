// External
import type { NextResponse } from 'next/server';
// Ours
import { SSO_FLOW_COOKIE, SSO_FLOW_COOKIE_PATH, SSO_FLOW_TTL_SECONDS } from '@/app/lib/server/sso/flow-state';

/** Remember a sign-in attempt in the browser. `secure` follows the public address of the site. */
export function setFlowCookie(response: NextResponse, value: string, baseUrl: string): void {
  response.cookies.set(SSO_FLOW_COOKIE, value, {
    httpOnly: true,
    secure: baseUrl.startsWith('https://'),
    // Lax, not Strict: the provider sends the browser back with a top-level GET, which Strict would not carry.
    sameSite: 'lax',
    path: SSO_FLOW_COOKIE_PATH,
    maxAge: SSO_FLOW_TTL_SECONDS,
  });
}

/** Forget the attempt; called after every callback so a cookie cannot be replayed. */
export function clearFlowCookie(response: NextResponse): void {
  response.cookies.set(SSO_FLOW_COOKIE, '', { httpOnly: true, path: SSO_FLOW_COOKIE_PATH, maxAge: 0 });
}
