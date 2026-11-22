import { NextRequest, NextResponse } from 'next/server';
import { issueSession } from '@/app/lib/server/session-auth';
import { setSessionCookies } from '@/app/lib/server/session';
import { resolvePublicBaseUrl } from '@/app/lib/server/sso/base-url';
import { clearFlowCookie } from '@/app/lib/server/sso/flow-cookie';
import { SSO_FLOW_COOKIE } from '@/app/lib/server/sso/flow-state';
import { completeSsoLogin } from '@/app/lib/server/sso/login-service';
import { isSsoProviderId, type SsoErrorCode } from '@/app/lib/server/sso/types';

function loginRedirect(baseUrl: string, code: SsoErrorCode): NextResponse {
  const response = NextResponse.redirect(new URL(`/login?sso_error=${code}`, baseUrl));
  clearFlowCookie(response);
  return response;
}

/** The identity provider sends the browser back here: finish the sign-in and start a normal session. */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const baseUrl = resolvePublicBaseUrl(request).url;
  const { provider } = await context.params;
  if (!isSsoProviderId(provider)) return loginRedirect(baseUrl, 'provider_disabled');
  try {
    const outcome = await completeSsoLogin({
      provider,
      baseUrl,
      query: request.nextUrl.searchParams,
      flowCookie: request.cookies.get(SSO_FLOW_COOKIE)?.value,
    });
    if (!outcome.ok) return loginRedirect(baseUrl, outcome.code);
    const { accessToken, refreshToken } = await issueSession(outcome.value);
    const response = NextResponse.redirect(new URL('/home', baseUrl));
    setSessionCookies(response, accessToken, refreshToken);
    clearFlowCookie(response);
    return response;
  } catch (error) {
    console.error(`[sso] ${provider}: callback failed:`, error);
    return loginRedirect(baseUrl, 'unexpected');
  }
}
