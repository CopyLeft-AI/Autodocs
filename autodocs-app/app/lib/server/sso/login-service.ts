// Ours
import type { SessionUser } from '@/app/lib/server/session-auth';
import { resolveAccount } from '@/app/lib/server/sso/account-service';
import { checkProfileAgainstPolicy } from '@/app/lib/server/sso/account-policy';
import { redirectUriFor } from '@/app/lib/server/sso/base-url';
import { createFlowState, openFlowState, sealFlowState, statesMatch } from '@/app/lib/server/sso/flow-state';
import {
  buildAuthorizationUrl, exchangeAuthorizationCode, fetchDiscovery, fetchUserInfo, verifyIdToken, type OidcDiscovery,
} from '@/app/lib/server/sso/oidc-client';
import { buildOAuth2AuthorizationUrl, exchangeOAuth2Code, getOAuth2Adapter } from '@/app/lib/server/sso/oauth2-client';
import { finalizeProfile, profileFromClaims, type RawProfile } from '@/app/lib/server/sso/profile-mapping';
import { loadRuntimeProvider } from '@/app/lib/server/sso/provider-service';
import type { OidcProviderDefinition, RuntimeSsoProvider, SsoErrorCode, SsoProviderId, SsoResult } from '@/app/lib/server/sso/types';

/** First step: where to send the browser, and the cookie value that remembers this attempt. */
export interface SsoStart {
  authorizationUrl: string;
  flowCookie: string;
}

function fail(provider: SsoProviderId, code: SsoErrorCode, detail: string): { ok: false; code: SsoErrorCode } {
  // The detail is for the administrator reading the server log; the user only sees the code's message.
  console.error(`[sso] ${provider}: ${code}: ${detail}`);
  return { ok: false, code };
}

/** Start a sign-in: build the provider's authorization URL and the signed flow cookie. */
export async function beginSsoLogin(provider: SsoProviderId, baseUrl: string): Promise<SsoResult<SsoStart>> {
  const runtime = await loadRuntimeProvider(provider);
  if (!runtime) return { ok: false, code: 'provider_disabled' };
  const redirectUri = redirectUriFor(baseUrl, provider);
  const flow = createFlowState(provider);

  let authorizationUrl: string;
  if (runtime.definition.protocol === 'oidc') {
    const discovery = await fetchDiscovery(runtime.definition.issuerFor(runtime.settings));
    if (!discovery.ok) return fail(provider, 'provider_unreachable', discovery.message);
    authorizationUrl = buildAuthorizationUrl({
      discovery: discovery.value, clientId: runtime.clientId, redirectUri, scopes: runtime.definition.scopes,
      state: flow.state, nonce: flow.nonce, codeChallenge: flow.codeChallenge,
    });
  } else {
    const adapter = getOAuth2Adapter(provider);
    if (!adapter) return fail(provider, 'unexpected', 'no OAuth 2.0 adapter is registered for this provider');
    authorizationUrl = buildOAuth2AuthorizationUrl({
      adapter, settings: runtime.settings, clientId: runtime.clientId, redirectUri, state: flow.state, codeChallenge: flow.codeChallenge,
    });
  }
  return { ok: true, value: { authorizationUrl, flowCookie: sealFlowState(flow) } };
}

/** Exchange the code at an OpenID Connect provider and read the verified identity from the ID token. */
async function readOidcProfile(
  runtime: RuntimeSsoProvider & { definition: OidcProviderDefinition },
  args: { code: string; redirectUri: string; codeVerifier: string; nonce: string },
): Promise<{ ok: true; profile: RawProfile } | { ok: false; code: SsoErrorCode; detail: string }> {
  const discovery = await fetchDiscovery(runtime.definition.issuerFor(runtime.settings));
  if (!discovery.ok) return { ok: false, code: 'provider_unreachable', detail: discovery.message };
  const tokens = await exchangeAuthorizationCode({
    discovery: discovery.value, clientId: runtime.clientId, clientSecret: runtime.clientSecret,
    redirectUri: args.redirectUri, code: args.code, codeVerifier: args.codeVerifier,
  });
  if (!tokens.ok) return { ok: false, code: 'exchange_failed', detail: tokens.message };
  const verified = await verifyIdToken({ discovery: discovery.value, idToken: tokens.value.idToken, clientId: runtime.clientId, nonce: args.nonce });
  if (!verified.ok) return { ok: false, code: 'exchange_failed', detail: verified.message };

  let claims: Record<string, unknown> = { ...verified.value };
  if (claims.email === undefined && tokens.value.accessToken !== null) claims = await withUserInfoClaims(discovery.value, tokens.value.accessToken, claims);
  return { ok: true, profile: profileFromClaims(claims, runtime.definition.verifiedEmailClaims) };
}

/** Add the claims the ID token lacked from the userinfo endpoint; on failure keep what the ID token had. */
async function withUserInfoClaims(discovery: OidcDiscovery, accessToken: string, claims: Record<string, unknown>): Promise<Record<string, unknown>> {
  const info = await fetchUserInfo({ discovery, accessToken, subject: String(claims.sub) });
  return info.ok ? { ...info.value, ...claims, email: info.value.email, email_verified: info.value.email_verified } : claims;
}

/** Exchange the code at a plain OAuth 2.0 provider and read the profile from its API. */
async function readOAuth2Profile(
  runtime: RuntimeSsoProvider,
  provider: SsoProviderId,
  args: { code: string; redirectUri: string; codeVerifier: string },
): Promise<{ ok: true; profile: RawProfile } | { ok: false; code: SsoErrorCode; detail: string }> {
  const adapter = getOAuth2Adapter(provider);
  if (!adapter) return { ok: false, code: 'unexpected', detail: 'no OAuth 2.0 adapter is registered for this provider' };
  const token = await exchangeOAuth2Code({
    adapter, settings: runtime.settings, clientId: runtime.clientId, clientSecret: runtime.clientSecret,
    redirectUri: args.redirectUri, code: args.code, codeVerifier: args.codeVerifier,
  });
  if (!token.ok) return { ok: false, code: 'exchange_failed', detail: token.message };
  const profile = await adapter.fetchProfile(token.value, runtime.settings);
  return profile.ok ? { ok: true, profile: profile.value } : { ok: false, code: 'exchange_failed', detail: profile.message };
}

/**
 * Second step, when the provider sends the browser back: check the attempt, learn who signed in, apply the
 * account policy and return the local user. Every refusal is a code, never an exception.
 */
export async function completeSsoLogin(input: {
  provider: SsoProviderId;
  baseUrl: string;
  query: URLSearchParams;
  flowCookie: string | undefined;
}): Promise<SsoResult<SessionUser>> {
  const { provider } = input;
  const flow = openFlowState(input.flowCookie, provider);
  if (!flow || !statesMatch(flow.state, input.query.get('state'))) return fail(provider, 'invalid_state', 'missing, expired or mismatching state');

  const providerError = input.query.get('error');
  if (providerError) return fail(provider, providerError === 'access_denied' ? 'access_denied' : 'exchange_failed', `provider returned error "${providerError}"`);
  const code = input.query.get('code');
  if (!code) return fail(provider, 'exchange_failed', 'no authorization code in the callback');

  const runtime = await loadRuntimeProvider(provider);
  if (!runtime) return fail(provider, 'provider_disabled', 'provider disabled or incomplete');

  const redirectUri = redirectUriFor(input.baseUrl, provider);
  const read = runtime.definition.protocol === 'oidc'
    ? await readOidcProfile({ ...runtime, definition: runtime.definition }, { code, redirectUri, codeVerifier: flow.codeVerifier, nonce: flow.nonce })
    : await readOAuth2Profile(runtime, provider, { code, redirectUri, codeVerifier: flow.codeVerifier });
  if (!read.ok) return fail(provider, read.code, read.detail);

  const profile = finalizeProfile(read.profile, runtime.policy);
  const allowed = checkProfileAgainstPolicy(profile, runtime.policy);
  if (!allowed.ok) return fail(provider, allowed.code, `sign-in refused for ${profile.email || 'an account without email'}`);
  return resolveAccount(provider, profile, runtime.policy);
}
