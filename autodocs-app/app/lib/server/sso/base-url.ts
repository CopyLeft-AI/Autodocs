// External
import type { NextRequest } from 'next/server';
// Ours
import type { SsoProviderId } from '@/app/lib/server/sso/types';

export interface PublicBaseUrl {
  url: string;
  /** True when it comes from `APP_BASE_URL`; false when it is guessed from the request headers. */
  configured: boolean;
}

/** Normalize the site's own address: http or https, no credentials, no query, no trailing slash; null when invalid. */
function normalizeSiteUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * The public address of the site, from which redirect URLs are built.
 * `APP_BASE_URL` wins. Without it the address is guessed from the forwarded headers of a reverse proxy, or the
 * request itself: fine for a first try, but a provider only accepts the exact URL it was given, so production
 * installs should set `APP_BASE_URL`.
 */
export function resolvePublicBaseUrl(request: NextRequest): PublicBaseUrl {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    const normalized = normalizeSiteUrl(configured);
    if (normalized) return { url: normalized, configured: true };
    console.error('[sso] APP_BASE_URL is ignored: it is not a valid http(s) URL without credentials or query.');
  }
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : request.nextUrl.protocol.replace(':', '');
  return { url: normalizeSiteUrl(`${protocol}://${host}`) ?? request.nextUrl.origin, configured: false };
}

/** The exact redirect (callback) URL to register at a provider. */
export function redirectUriFor(baseUrl: string, provider: SsoProviderId): string {
  return `${baseUrl}/api/auth/sso/${provider}/callback`;
}
