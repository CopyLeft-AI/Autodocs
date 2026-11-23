// Ours
import type { RawProfile } from '@/app/lib/server/sso/profile-mapping';
import type { SsoProviderId, SsoProviderSettings } from '@/app/lib/server/sso/types';

const FETCH_TIMEOUT_MS = 10_000;

export type OAuth2Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Everything specific to one OAuth 2.0 provider that has no ID tokens: where to send the browser, and how to
 * learn who signed in. Provider quirks stay in this file, behind this interface.
 */
interface OAuth2Adapter {
  scopes: string[];
  endpoints(settings: SsoProviderSettings): { authorizationEndpoint: string; tokenEndpoint: string };
  fetchProfile(accessToken: string, settings: SsoProviderSettings): Promise<OAuth2Outcome<RawProfile>>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

async function getJson(url: string, headers: Record<string, string>): Promise<OAuth2Outcome<unknown>> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, message: `${new URL(url).pathname} answered HTTP ${response.status}.` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, message: `Request to ${new URL(url).pathname} failed: ${describeError(error)}` };
  }
}

interface GithubEmail { email: string; primary: boolean; verified: boolean }

const githubAdapter: OAuth2Adapter = {
  scopes: ['read:user', 'user:email'],
  endpoints: (settings) => {
    const web = settings.enterpriseUrl ?? 'https://github.com';
    return { authorizationEndpoint: `${web}/login/oauth/authorize`, tokenEndpoint: `${web}/login/oauth/access_token` };
  },
  fetchProfile: async (accessToken, settings) => {
    const api = settings.enterpriseUrl ? `${settings.enterpriseUrl}/api/v3` : 'https://api.github.com';
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'autodocs', 'X-GitHub-Api-Version': '2022-11-28' };
    const user = await getJson(`${api}/user`, headers);
    if (!user.ok) return user;
    const emails = await getJson(`${api}/user/emails`, headers);
    if (!emails.ok) return emails;
    const profile = user.value as { id?: number | string; login?: string; name?: string | null };
    if (profile.id === undefined) return { ok: false, message: 'GitHub returned no account id.' };
    // Only the primary email that GitHub verified counts. The public `email` field of /user is not verified.
    const primary = Array.isArray(emails.value) ? (emails.value as GithubEmail[]).find((entry) => entry.primary && entry.verified) : undefined;
    return {
      ok: true,
      value: {
        subject: String(profile.id),
        email: primary ? primary.email.trim().toLowerCase() : '',
        emailVerifiedByProvider: primary !== undefined,
        name: profile.name?.trim() || profile.login || 'User',
      },
    };
  },
};

const discordAdapter: OAuth2Adapter = {
  scopes: ['identify', 'email'],
  endpoints: () => ({ authorizationEndpoint: 'https://discord.com/oauth2/authorize', tokenEndpoint: 'https://discord.com/api/oauth2/token' }),
  fetchProfile: async (accessToken) => {
    const user = await getJson('https://discord.com/api/users/@me', { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' });
    if (!user.ok) return user;
    const profile = user.value as { id?: string; username?: string; global_name?: string | null; email?: string | null; verified?: boolean };
    if (!profile.id) return { ok: false, message: 'Discord returned no account id.' };
    return {
      ok: true,
      value: {
        subject: profile.id,
        email: (profile.email ?? '').trim().toLowerCase(),
        emailVerifiedByProvider: profile.verified === true,
        name: profile.global_name?.trim() || profile.username || 'User',
      },
    };
  },
};

const ADAPTERS: Partial<Record<SsoProviderId, OAuth2Adapter>> = { github: githubAdapter, discord: discordAdapter };

/** The adapter of an OAuth 2.0 provider; undefined for a provider that has none. */
export function getOAuth2Adapter(id: SsoProviderId): OAuth2Adapter | undefined {
  return ADAPTERS[id];
}

/** The URL that sends the browser to the provider's authorization page (with PKCE). */
export function buildOAuth2AuthorizationUrl(args: {
  adapter: OAuth2Adapter;
  settings: SsoProviderSettings;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(args.adapter.endpoints(args.settings).authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', args.adapter.scopes.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Exchange the authorization code for an access token. */
export async function exchangeOAuth2Code(args: {
  adapter: OAuth2Adapter;
  settings: SsoProviderSettings;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<OAuth2Outcome<string>> {
  try {
    const response = await fetch(args.adapter.endpoints(args.settings).tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: args.clientId,
        client_secret: args.clientSecret,
        code_verifier: args.codeVerifier,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // GitHub reports some failures as HTTP 200 with an `error` field.
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof payload.error === 'string') {
      return { ok: false, message: `The token endpoint refused the code: ${String(payload.error_description ?? payload.error ?? `HTTP ${response.status}`)}` };
    }
    if (typeof payload.access_token !== 'string' || payload.access_token === '') return { ok: false, message: 'The token response contains no access token.' };
    return { ok: true, value: payload.access_token };
  } catch (error) {
    return { ok: false, message: `Token request failed: ${describeError(error)}` };
  }
}
