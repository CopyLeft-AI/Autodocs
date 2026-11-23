// Ours
import {
  SSO_PROVIDER_IDS,
  type SsoProviderDefinition,
  type SsoProviderId,
  type SsoProviderSettings,
} from '@/app/lib/server/sso/types';

/**
 * Registry of the identity providers an administrator can enable.
 *
 * Adding a provider that speaks OpenID Connect is one entry here (plus its id in types.ts and an icon in the
 * login button component). A provider without ID tokens also needs an adapter in oauth2-adapters.ts.
 */
const DEFINITIONS: Record<SsoProviderId, SsoProviderDefinition> = {
  google: {
    id: 'google', label: 'Google', protocol: 'oidc',
    description: 'Sign in with a Google account.',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    fields: [],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: () => 'https://accounts.google.com',
    verifiedEmailClaims: [],
  },
  microsoft: {
    id: 'microsoft', label: 'Microsoft', protocol: 'oidc',
    description: 'Sign in with Microsoft Entra ID (Azure AD) accounts of one tenant.',
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    fields: [
      { key: 'tenantId', label: 'Directory (tenant) ID', placeholder: '00000000-0000-0000-0000-000000000000', kind: 'guid', required: true,
        help: 'From the app registration overview. Entra does not mark emails as verified by default: add the "email" and "xms_edov" optional claims to the ID token, or turn on "Trust the email from this provider" below.' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => `https://login.microsoftonline.com/${settings.tenantId}/v2.0`,
    verifiedEmailClaims: ['xms_edov'],
  },
  github: {
    id: 'github', label: 'GitHub', protocol: 'oauth2',
    description: 'Sign in with a GitHub account. Only the primary verified email is used.',
    consoleUrl: 'https://github.com/settings/developers',
    fields: [
      { key: 'enterpriseUrl', label: 'GitHub Enterprise Server URL', placeholder: 'https://github.example.com', kind: 'https-url', required: false,
        help: 'Leave empty for github.com.' },
    ],
  },
  gitlab: {
    id: 'gitlab', label: 'GitLab', protocol: 'oidc',
    description: 'Sign in with a GitLab.com or self-managed GitLab account.',
    consoleUrl: 'https://gitlab.com/-/user_settings/applications',
    fields: [
      { key: 'instanceUrl', label: 'GitLab URL', placeholder: 'https://gitlab.com', kind: 'https-url', required: false,
        help: 'Leave empty for gitlab.com.' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => settings.instanceUrl ?? 'https://gitlab.com',
    verifiedEmailClaims: [],
  },
  okta: {
    id: 'okta', label: 'Okta', protocol: 'oidc',
    description: 'Enterprise single sign-on with Okta.',
    consoleUrl: 'https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/',
    fields: [
      { key: 'domain', label: 'Okta domain', placeholder: 'your-company.okta.com', kind: 'hostname', required: true,
        help: 'The host name of your Okta organization, without https://.' },
      { key: 'authorizationServerId', label: 'Authorization server', placeholder: 'default', kind: 'slug', required: false,
        help: 'Leave empty to use the organization authorization server, or enter the id of a custom one (often "default").' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => (settings.authorizationServerId ? `https://${settings.domain}/oauth2/${settings.authorizationServerId}` : `https://${settings.domain}`),
    verifiedEmailClaims: [],
  },
  auth0: {
    id: 'auth0', label: 'Auth0', protocol: 'oidc',
    description: 'Single sign-on with an Auth0 tenant.',
    consoleUrl: 'https://manage.auth0.com/#/applications',
    fields: [
      { key: 'domain', label: 'Auth0 domain', placeholder: 'your-tenant.eu.auth0.com', kind: 'hostname', required: true,
        help: 'The tenant domain (or custom domain) without https://.' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => `https://${settings.domain}/`,
    verifiedEmailClaims: [],
  },
  keycloak: {
    id: 'keycloak', label: 'Keycloak', protocol: 'oidc',
    description: 'Single sign-on with a Keycloak realm.',
    consoleUrl: 'https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients',
    fields: [
      { key: 'issuerUrl', label: 'Realm URL', placeholder: 'https://keycloak.example.com/realms/my-realm', kind: 'https-url', required: true,
        help: 'The realm URL, ending in /realms/<name>.' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => settings.issuerUrl,
    verifiedEmailClaims: [],
  },
  cognito: {
    id: 'cognito', label: 'Amazon Cognito', protocol: 'oidc',
    description: 'Single sign-on with an Amazon Cognito user pool.',
    consoleUrl: 'https://console.aws.amazon.com/cognito/v2/idp/user-pools',
    fields: [
      { key: 'userPoolId', label: 'User pool ID', placeholder: 'eu-west-1_AbCdEf123', kind: 'cognito-pool-id', required: true,
        help: 'The pool must have a hosted UI domain and an app client with a secret.' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => `https://cognito-idp.${settings.userPoolId.split('_')[0]}.amazonaws.com/${settings.userPoolId}`,
    verifiedEmailClaims: [],
  },
  linkedin: {
    id: 'linkedin', label: 'LinkedIn', protocol: 'oidc',
    description: 'Sign in with LinkedIn ("Sign In with LinkedIn using OpenID Connect").',
    consoleUrl: 'https://www.linkedin.com/developers/apps',
    fields: [],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: () => 'https://www.linkedin.com/oauth',
    verifiedEmailClaims: [],
  },
  discord: {
    id: 'discord', label: 'Discord', protocol: 'oauth2',
    description: 'Sign in with a Discord account that has a verified email.',
    consoleUrl: 'https://discord.com/developers/applications',
    fields: [],
  },
  'custom-oidc': {
    id: 'custom-oidc', label: 'Custom OpenID Connect', protocol: 'oidc',
    description: 'Any other OpenID Connect provider (Authentik, Zitadel, OneLogin, Ping, ADFS, ...).',
    consoleUrl: 'https://openid.net/developers/certified-openid-connect-implementations/',
    fields: [
      { key: 'issuerUrl', label: 'Issuer URL', placeholder: 'https://sso.example.com/application/o/autodocs', kind: 'https-url', required: true,
        help: 'The provider must publish <issuer>/.well-known/openid-configuration.' },
      { key: 'buttonLabel', label: 'Button label', placeholder: 'Company SSO', kind: 'label', required: false,
        help: 'The text of the sign-in button. Defaults to "Custom OpenID Connect".' },
    ],
    scopes: ['openid', 'email', 'profile'],
    issuerFor: (settings) => settings.issuerUrl,
    verifiedEmailClaims: [],
  },
};

/** Definition of a provider. */
export function getProviderDefinition(id: SsoProviderId): SsoProviderDefinition {
  return DEFINITIONS[id];
}

/** All definitions, in the order the settings page and the login page list them. */
export function listProviderDefinitions(): SsoProviderDefinition[] {
  return SSO_PROVIDER_IDS.map((id) => DEFINITIONS[id]);
}

/** The text of the provider's sign-in button, which an administrator can customize for the custom provider. */
export function providerDisplayLabel(definition: SsoProviderDefinition, settings: SsoProviderSettings): string {
  return settings.buttonLabel?.trim() ? settings.buttonLabel.trim() : definition.label;
}
