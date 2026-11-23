import { describe, expect, test } from 'bun:test';
import { getProviderDefinition, listProviderDefinitions, providerDisplayLabel } from '@/app/lib/server/sso/provider-definitions';
import { getOAuth2Adapter } from '@/app/lib/server/sso/oauth2-client';
import { SSO_PROVIDER_IDS, type OidcProviderDefinition } from '@/app/lib/server/sso/types';

function oidc(id: (typeof SSO_PROVIDER_IDS)[number]): OidcProviderDefinition {
  const definition = getProviderDefinition(id);
  if (definition.protocol !== 'oidc') throw new Error(`${id} is not OIDC`);
  return definition;
}

describe('provider registry', () => {
  test('has exactly one definition per provider id, in order', () => {
    expect(listProviderDefinitions().map((definition) => definition.id)).toEqual([...SSO_PROVIDER_IDS]);
  });

  test('every OpenID Connect provider asks for the openid and email scopes', () => {
    for (const definition of listProviderDefinitions()) {
      if (definition.protocol === 'oidc') expect(definition.scopes).toEqual(expect.arrayContaining(['openid', 'email']));
    }
  });

  test('every OAuth 2.0 provider has an adapter, and OIDC providers have none', () => {
    for (const definition of listProviderDefinitions()) {
      expect(getOAuth2Adapter(definition.id) !== undefined).toBe(definition.protocol === 'oauth2');
    }
  });

  test('field keys are unique per provider', () => {
    for (const definition of listProviderDefinitions()) {
      const keys = definition.fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test('builds each issuer URL from the administrator settings', () => {
    expect(oidc('google').issuerFor({})).toBe('https://accounts.google.com');
    expect(oidc('microsoft').issuerFor({ tenantId: 'abc' })).toBe('https://login.microsoftonline.com/abc/v2.0');
    expect(oidc('okta').issuerFor({ domain: 'dev.okta.com' })).toBe('https://dev.okta.com');
    expect(oidc('okta').issuerFor({ domain: 'dev.okta.com', authorizationServerId: 'default' })).toBe('https://dev.okta.com/oauth2/default');
    expect(oidc('auth0').issuerFor({ domain: 't.eu.auth0.com' })).toBe('https://t.eu.auth0.com/');
    expect(oidc('keycloak').issuerFor({ issuerUrl: 'https://kc.example.com/realms/r' })).toBe('https://kc.example.com/realms/r');
    expect(oidc('gitlab').issuerFor({})).toBe('https://gitlab.com');
    expect(oidc('gitlab').issuerFor({ instanceUrl: 'https://git.example.com' })).toBe('https://git.example.com');
    expect(oidc('cognito').issuerFor({ userPoolId: 'eu-west-1_Abc123' })).toBe('https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Abc123');
    expect(oidc('linkedin').issuerFor({})).toBe('https://www.linkedin.com/oauth');
    expect(oidc('custom-oidc').issuerFor({ issuerUrl: 'https://sso.example.com' })).toBe('https://sso.example.com');
  });

  test('only the custom provider lets the administrator rename the button', () => {
    const custom = getProviderDefinition('custom-oidc');
    expect(providerDisplayLabel(custom, { buttonLabel: ' Company SSO ' })).toBe('Company SSO');
    expect(providerDisplayLabel(custom, {})).toBe('Custom OpenID Connect');
    expect(providerDisplayLabel(getProviderDefinition('google'), {})).toBe('Google');
  });
});
