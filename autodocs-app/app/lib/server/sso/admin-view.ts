/**
 * What the administrator's settings page receives and sends. Types only, so client code can import them.
 * The client secret is write-only: it appears in `SsoProviderUpdate`, never in `SsoAdminProvider`.
 */

export interface SsoAdminField {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
  value: string;
}

export interface SsoAdminProvider {
  id: string;
  label: string;
  description: string;
  protocol: 'oidc' | 'oauth2';
  consoleUrl: string;
  fields: SsoAdminField[];
  enabled: boolean;
  clientId: string;
  hasClientSecret: boolean;
  /** The address to register at the provider as the redirect (callback) URL. */
  redirectUri: string;
  /** Enabled, with every required value present, so the login page offers it. */
  isActive: boolean;
  trustProviderEmail: boolean;
  allowNewUsers: boolean;
  linkExistingAccounts: boolean;
  allowedEmailDomains: string[];
  updatedAt: string | null;
}

export interface SsoAdminOverview {
  /** The public address the redirect URLs are built from. */
  baseUrl: string;
  /** True when `APP_BASE_URL` is set; false when the address is guessed from the request. */
  baseUrlConfigured: boolean;
  providers: SsoAdminProvider[];
}

/** Body of `PUT /api/admin/sso/providers/<id>`. Omit `clientSecret` to keep the stored one. */
export interface SsoProviderUpdate {
  enabled: boolean;
  clientId: string;
  clientSecret?: string;
  clearClientSecret?: boolean;
  settings: Record<string, string>;
  trustProviderEmail: boolean;
  allowNewUsers: boolean;
  linkExistingAccounts: boolean;
  allowedEmailDomains: string[];
}

export interface SsoConnectionTestResult {
  ok: boolean;
  message: string;
}
