// Ours
import type { SsoFieldKind } from '@/app/lib/server/sso/types';

/**
 * Plain `http://` identity-provider URLs are refused unless this environment variable is `true`.
 * It exists for local development (a Keycloak on localhost) and for automated tests with a mock provider.
 */
export function isInsecureHttpAllowed(): boolean {
  return process.env.SSO_ALLOW_INSECURE_HTTP === 'true';
}

export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COGNITO_POOL_ID = /^[a-z]{2}(-[a-z]+)+-\d_[A-Za-z0-9]+$/;
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

/** Check an `https://` (or, in development, `http://`) URL and return it without trailing slash, query or fragment. */
export function checkBaseUrl(raw: string): FieldCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'must be a full URL such as https://example.com' };
  }
  const httpAllowed = url.protocol === 'http:' && isInsecureHttpAllowed();
  if (url.protocol !== 'https:' && !httpAllowed) return { ok: false, message: 'must start with https://' };
  if (url.username !== '' || url.password !== '') return { ok: false, message: 'must not contain a user name or password' };
  if (url.search !== '' || url.hash !== '') return { ok: false, message: 'must not contain a query or a fragment' };
  return { ok: true, value: `${url.origin}${url.pathname}`.replace(/\/+$/, '') };
}

/** Validate and normalize the value of a provider-specific field; empty input is the caller's concern. */
export function checkFieldValue(kind: SsoFieldKind, raw: string): FieldCheck {
  const value = raw.trim();
  switch (kind) {
    case 'hostname': {
      const host = value.toLowerCase();
      return HOSTNAME.test(host) ? { ok: true, value: host } : { ok: false, message: 'must be a host name such as example.okta.com (no https://, no path)' };
    }
    case 'https-url':
      return checkBaseUrl(value);
    case 'guid':
      return GUID.test(value.toLowerCase()) ? { ok: true, value: value.toLowerCase() } : { ok: false, message: 'must be an identifier like 00000000-0000-0000-0000-000000000000' };
    case 'cognito-pool-id':
      return COGNITO_POOL_ID.test(value) ? { ok: true, value } : { ok: false, message: 'must look like eu-west-1_AbCdEf123' };
    case 'slug':
      return SLUG.test(value) ? { ok: true, value } : { ok: false, message: 'may only contain letters, digits, - and _' };
    case 'label':
      return value.length <= 40 ? { ok: true, value } : { ok: false, message: 'can have at most 40 characters' };
  }
}

/** Normalize a list of allowed email domains typed as text separated by commas, spaces or new lines. */
export function parseEmailDomains(raw: string): { ok: true; domains: string[] } | { ok: false; message: string } {
  const domains: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const domain = part.trim().toLowerCase().replace(/^@/, '');
    if (domain === '') continue;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return { ok: false, message: `"${part.trim()}" is not a valid email domain.` };
    if (!domains.includes(domain)) domains.push(domain);
  }
  return { ok: true, domains };
}
