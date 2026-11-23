import { describe, expect, test } from 'bun:test';
import { getProviderDefinition } from '@/app/lib/server/sso/provider-definitions';
import { parseProviderUpdate } from '@/app/lib/server/sso/provider-input';
import type { StoredSsoProvider } from '@/app/lib/server/sso/types';

const okta = getProviderDefinition('okta');
const google = getProviderDefinition('google');

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false, clientId: '', settings: {}, trustProviderEmail: false, allowNewUsers: true, linkExistingAccounts: true, allowedEmailDomains: [],
    ...overrides,
  };
}

function stored(overrides: Partial<StoredSsoProvider> = {}): StoredSsoProvider {
  return {
    providerId: 'okta', enabled: false, clientId: 'abc', clientSecretEncrypted: 'v1:x:y:z', settings: { domain: 'dev.okta.com' },
    trustProviderEmail: false, allowNewUsers: true, linkExistingAccounts: true, allowedEmailDomains: [], updatedAt: 'now', ...overrides,
  };
}

describe('parseProviderUpdate', () => {
  test('saves an incomplete draft while the provider stays disabled', () => {
    const result = parseProviderUpdate(okta, body({ clientId: 'abc' }), null);
    expect(result.ok).toBe(true);
  });

  test('refuses to enable without a client ID, a secret or a required field', () => {
    expect(parseProviderUpdate(okta, body({ enabled: true }), null)).toEqual({ ok: false, message: 'Enter the client ID before enabling this provider.' });
    expect(parseProviderUpdate(okta, body({ enabled: true, clientId: 'abc' }), null)).toEqual({ ok: false, message: 'Enter the client secret before enabling this provider.' });
    const noDomain = parseProviderUpdate(okta, body({ enabled: true, clientId: 'abc', clientSecret: 's' }), null);
    expect(noDomain.ok).toBe(false);
  });

  test('enables a complete configuration and normalizes the field values', () => {
    const result = parseProviderUpdate(okta, body({ enabled: true, clientId: ' abc ', clientSecret: 's3cret', settings: { domain: ' DEV.okta.com ', authorizationServerId: '' } }), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clientId).toBe('abc');
    expect(result.value.settings).toEqual({ domain: 'dev.okta.com' });
    expect(result.value.secret).toEqual({ action: 'replace', value: 's3cret' });
  });

  test('keeps the stored secret when none is sent, and an empty secret does not erase it', () => {
    const keep = parseProviderUpdate(okta, body({ enabled: true, clientId: 'abc', settings: { domain: 'dev.okta.com' } }), stored());
    expect(keep.ok && keep.value.secret).toEqual({ action: 'keep' });
    const empty = parseProviderUpdate(okta, body({ enabled: true, clientId: 'abc', clientSecret: '', settings: { domain: 'dev.okta.com' } }), stored());
    expect(empty.ok && empty.value.secret).toEqual({ action: 'keep' });
  });

  test('clearing the secret blocks enabling', () => {
    const result = parseProviderUpdate(okta, body({ enabled: true, clientId: 'abc', clearClientSecret: true, settings: { domain: 'dev.okta.com' } }), stored());
    expect(result.ok).toBe(false);
  });

  test('rejects malformed fields with the field name in the message', () => {
    const result = parseProviderUpdate(okta, body({ settings: { domain: 'https://dev.okta.com' } }), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Okta domain');
  });

  test('ignores settings the provider does not define', () => {
    const result = parseProviderUpdate(google, body({ settings: { issuerUrl: 'https://evil.example' } }), null);
    expect(result.ok && result.value.settings).toEqual({});
  });

  test('rejects wrong types and bad bodies', () => {
    expect(parseProviderUpdate(google, null, null).ok).toBe(false);
    expect(parseProviderUpdate(google, [], null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ enabled: 'yes' }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ clientId: 5 }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ clientSecret: 5 }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ settings: 'x' }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ allowedEmailDomains: 'example.com' }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ allowedEmailDomains: ['not a domain'] }), null).ok).toBe(false);
    expect(parseProviderUpdate(google, body({ clientId: 'x'.repeat(513) }), null).ok).toBe(false);
  });

  test('carries the account policy through', () => {
    const result = parseProviderUpdate(google, body({ trustProviderEmail: true, allowNewUsers: false, linkExistingAccounts: false, allowedEmailDomains: ['Example.com'] }), null);
    expect(result.ok && result.value.policy).toEqual({ trustProviderEmail: true, allowNewUsers: false, linkExistingAccounts: false, allowedEmailDomains: ['example.com'] });
  });
});
