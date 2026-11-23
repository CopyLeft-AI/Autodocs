import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicBaseUrl } from '@/app/lib/server/sso/base-url';
import { setFlowCookie } from '@/app/lib/server/sso/flow-cookie';
import { beginSsoLogin } from '@/app/lib/server/sso/login-service';
import { isSsoProviderId, type SsoErrorCode } from '@/app/lib/server/sso/types';

function loginRedirect(baseUrl: string, code: SsoErrorCode): NextResponse {
  return NextResponse.redirect(new URL(`/login?sso_error=${code}`, baseUrl));
}

/** Send the browser to the identity provider's login page. A plain link on the login page points here. */
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const baseUrl = resolvePublicBaseUrl(request).url;
  const { provider } = await context.params;
  if (!isSsoProviderId(provider)) return loginRedirect(baseUrl, 'provider_disabled');
  try {
    const started = await beginSsoLogin(provider, baseUrl);
    if (!started.ok) return loginRedirect(baseUrl, started.code);
    const response = NextResponse.redirect(started.value.authorizationUrl);
    setFlowCookie(response, started.value.flowCookie, baseUrl);
    return response;
  } catch (error) {
    console.error(`[sso] ${provider}: start failed:`, error);
    return loginRedirect(baseUrl, 'unexpected');
  }
}
