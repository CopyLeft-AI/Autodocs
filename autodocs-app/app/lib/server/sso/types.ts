/** Shared contracts of the single sign-on (SSO) feature. Pure types and constants, no I/O. */

export type SsoProtocol = 'oidc' | 'oauth2';

/** Every identity provider an administrator can configure. Add a provider here and in provider-definitions.ts. */
export const SSO_PROVIDER_IDS = [
  'google', 'microsoft', 'github', 'gitlab', 'okta', 'auth0', 'keycloak', 'cognito', 'linkedin', 'discord', 'custom-oidc',
] as const;

export type SsoProviderId = (typeof SSO_PROVIDER_IDS)[number];

/** Whether a string from a URL or a request body names a known provider. */
export function isSsoProviderId(value: unknown): value is SsoProviderId {
  return typeof value === 'string' && (SSO_PROVIDER_IDS as readonly string[]).includes(value);
}

/** How the value of a provider-specific field is validated and turned into URLs. */
export type SsoFieldKind = 'hostname' | 'https-url' | 'guid' | 'cognito-pool-id' | 'slug' | 'label';

/** A provider-specific setting an administrator fills in (for example the Okta domain). */
export interface SsoFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  kind: SsoFieldKind;
  required: boolean;
}

interface SsoDefinitionBase {
  id: SsoProviderId;
  label: string;
  /** One sentence shown in the settings card. */
  description: string;
  /** Where the administrator creates the OAuth client (the provider's console). */
  consoleUrl: string;
  fields: SsoFieldDefinition[];
}

/** OpenID Connect provider: endpoints come from `<issuer>/.well-known/openid-configuration`. */
export interface OidcProviderDefinition extends SsoDefinitionBase {
  protocol: 'oidc';
  scopes: string[];
  /** The issuer URL derived from the administrator's settings. */
  issuerFor(settings: SsoProviderSettings): string;
  /** Claim names (besides `email_verified`) that, when true, prove the provider verified the email. */
  verifiedEmailClaims: string[];
}

/** Plain OAuth 2.0 provider without ID tokens; the profile comes from the provider's API (see oauth2-adapters.ts). */
export interface OAuth2ProviderDefinition extends SsoDefinitionBase {
  protocol: 'oauth2';
}

export type SsoProviderDefinition = OidcProviderDefinition | OAuth2ProviderDefinition;

/** Values of the provider-specific fields, keyed by `SsoFieldDefinition.key`. */
export type SsoProviderSettings = Record<string, string>;

/** Rules that decide who may sign in through a provider and how accounts are matched. */
export interface SsoAccountPolicy {
  /** Treat the email the provider asserts as verified even without an `email_verified` claim. */
  trustProviderEmail: boolean;
  /** Create an account for an email nobody has used yet. */
  allowNewUsers: boolean;
  /** Attach the provider identity to an existing account with the same verified email. */
  linkExistingAccounts: boolean;
  /** When not empty, only emails of these domains (lowercase, no `@`) may sign in. */
  allowedEmailDomains: string[];
}

/** A provider row as stored; the secret stays encrypted. */
export interface StoredSsoProvider extends SsoAccountPolicy {
  providerId: SsoProviderId;
  enabled: boolean;
  clientId: string;
  clientSecretEncrypted: string | null;
  settings: SsoProviderSettings;
  updatedAt: string;
}

/** A provider that is enabled and fully configured, with its secret decrypted, ready for a sign-in. */
export interface RuntimeSsoProvider {
  definition: SsoProviderDefinition;
  clientId: string;
  clientSecret: string;
  settings: SsoProviderSettings;
  policy: SsoAccountPolicy;
}

/** What a provider tells us about the person who signed in. */
export interface SsoProfile {
  /** Stable identifier of the person at the provider (`sub` or the numeric account id). */
  subject: string;
  /** Lowercase email, or an empty string when the provider gave none. */
  email: string;
  /** The provider (or the administrator's trust setting) vouches that the person owns the email. */
  emailVerified: boolean;
  name: string;
}

/** Why a sign-in was refused. The login page maps each code to a message; details stay in the server log. */
export const SSO_ERROR_CODES = [
  'provider_disabled', 'provider_unreachable', 'invalid_state', 'access_denied', 'exchange_failed', 'email_missing',
  'email_unverified', 'domain_not_allowed', 'signups_disabled', 'linking_disabled', 'unexpected',
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

/** Structured outcome of an operation that can fail for an expected reason. */
export type SsoResult<T> = { ok: true; value: T } | { ok: false; code: SsoErrorCode };
