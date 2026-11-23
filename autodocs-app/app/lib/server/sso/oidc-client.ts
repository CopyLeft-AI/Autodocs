// External
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
// Ours
import { isInsecureHttpAllowed } from '@/app/lib/server/sso/field-validation';

/** The fields of an OpenID Provider Metadata document that the sign-in flow uses. */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

export type OidcOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** Signature algorithms accepted for ID tokens: asymmetric only, so `none` and shared-secret (HS*) tokens are refused. */
const ALLOWED_ID_TOKEN_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

const discoveryCache = new Map<string, { document: OidcDiscovery; expiresAt: number }>();
const keySetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAcceptableEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isInsecureHttpAllowed());
  } catch {
    return false;
  }
}

/** Describe an unexpected failure without leaking more than its message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Fetch (and cache for ten minutes) the provider's metadata. The `issuer` it declares must be the one the
 * administrator configured, and every endpoint must be https, so a hijacked document cannot redirect the flow.
 */
export async function fetchDiscovery(issuer: string, options: { fresh?: boolean } = {}): Promise<OidcOutcome<OidcDiscovery>> {
  const cached = discoveryCache.get(issuer);
  if (cached && !options.fresh && cached.expiresAt > Date.now()) return { ok: true, value: cached.document };
  try {
    const response = await fetch(`${withoutTrailingSlash(issuer)}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, message: `The provider answered HTTP ${response.status} for its discovery document.` };
    const document = (await response.json()) as Partial<OidcDiscovery>;
    if (typeof document.issuer !== 'string' || withoutTrailingSlash(document.issuer) !== withoutTrailingSlash(issuer)) {
      return { ok: false, message: 'The issuer in the discovery document does not match the configured issuer URL.' };
    }
    if (!isAcceptableEndpoint(document.authorization_endpoint) || !isAcceptableEndpoint(document.token_endpoint) || !isAcceptableEndpoint(document.jwks_uri)) {
      return { ok: false, message: 'The discovery document lacks a valid https authorization, token or JWKS endpoint.' };
    }
    const value: OidcDiscovery = {
      issuer: document.issuer,
      authorization_endpoint: document.authorization_endpoint,
      token_endpoint: document.token_endpoint,
      jwks_uri: document.jwks_uri,
      userinfo_endpoint: isAcceptableEndpoint(document.userinfo_endpoint) ? document.userinfo_endpoint : undefined,
      token_endpoint_auth_methods_supported: Array.isArray(document.token_endpoint_auth_methods_supported) ? document.token_endpoint_auth_methods_supported : undefined,
    };
    discoveryCache.set(issuer, { document: value, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: `Could not read the discovery document: ${describeError(error)}` };
  }
}

/** The URL that sends the browser to the provider's login page (authorization code flow with PKCE). */
export function buildAuthorizationUrl(args: {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(args.discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', args.scopes.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('nonce', args.nonce);
  url.searchParams.set('code_challenge', args.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface OidcTokens {
  idToken: string;
  accessToken: string | null;
}

/** Exchange the authorization code for tokens, authenticating the client the way the provider supports. */
export async function exchangeAuthorizationCode(args: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<OidcOutcome<OidcTokens>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const methods = args.discovery.token_endpoint_auth_methods_supported;
  const useBasicAuth = methods !== undefined && !methods.includes('client_secret_post') && methods.includes('client_secret_basic');
  if (useBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(args.clientId)}:${encodeURIComponent(args.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', args.clientId);
    body.set('client_secret', args.clientSecret);
  }
  try {
    const response = await fetch(args.discovery.token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return { ok: false, message: `The token endpoint answered HTTP ${response.status}: ${String(payload.error_description ?? payload.error ?? 'no detail')}` };
    if (typeof payload.id_token !== 'string' || payload.id_token === '') return { ok: false, message: 'The token response contains no ID token.' };
    return { ok: true, value: { idToken: payload.id_token, accessToken: typeof payload.access_token === 'string' ? payload.access_token : null } };
  } catch (error) {
    return { ok: false, message: `Token request failed: ${describeError(error)}` };
  }
}

/** Verify signature, issuer, audience, expiry and nonce of an ID token and return its claims. */
export async function verifyIdToken(args: {
  discovery: OidcDiscovery;
  idToken: string;
  clientId: string;
  nonce: string;
}): Promise<OidcOutcome<JWTPayload>> {
  try {
    let keySet = keySetCache.get(args.discovery.jwks_uri);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(args.discovery.jwks_uri), { timeoutDuration: FETCH_TIMEOUT_MS });
      keySetCache.set(args.discovery.jwks_uri, keySet);
    }
    const { payload } = await jwtVerify(args.idToken, keySet, {
      issuer: args.discovery.issuer,
      audience: args.clientId,
      algorithms: ALLOWED_ID_TOKEN_ALGORITHMS,
      clockTolerance: 60,
    });
    if (payload.nonce !== args.nonce) return { ok: false, message: 'The ID token nonce does not match this sign-in attempt.' };
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== args.clientId) {
      return { ok: false, message: 'The ID token has several audiences and was not issued to this client.' };
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') return { ok: false, message: 'The ID token has no subject.' };
    return { ok: true, value: payload };
  } catch (error) {
    return { ok: false, message: `ID token rejected: ${describeError(error)}` };
  }
}

/** Ask the userinfo endpoint for claims the ID token lacked; the answer must be about the same subject. */
export async function fetchUserInfo(args: { discovery: OidcDiscovery; accessToken: string; subject: string }): Promise<OidcOutcome<Record<string, unknown>>> {
  if (!args.discovery.userinfo_endpoint) return { ok: false, message: 'The provider has no userinfo endpoint.' };
  try {
    const response = await fetch(args.discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${args.accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, message: `The userinfo endpoint answered HTTP ${response.status}.` };
    const claims = (await response.json()) as Record<string, unknown>;
    if (claims.sub !== args.subject) return { ok: false, message: 'The userinfo answer is about a different subject.' };
    return { ok: true, value: claims };
  } catch (error) {
    return { ok: false, message: `Userinfo request failed: ${describeError(error)}` };
  }
}
