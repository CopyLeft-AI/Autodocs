import { afterEach, describe, expect, test } from 'bun:test';
import { checkBaseUrl, checkFieldValue, isInsecureHttpAllowed, parseEmailDomains } from '@/app/lib/server/sso/field-validation';

afterEach(() => {
  delete process.env.SSO_ALLOW_INSECURE_HTTP;
});

describe('checkBaseUrl', () => {
  test('keeps an https origin and path, dropping the trailing slash', () => {
    expect(checkBaseUrl('https://sso.example.com/realms/main/')).toEqual({ ok: true, value: 'https://sso.example.com/realms/main' });
    expect(checkBaseUrl('https://sso.example.com')).toEqual({ ok: true, value: 'https://sso.example.com' });
  });

  test('refuses plain http unless development mode allows it', () => {
    expect(checkBaseUrl('http://localhost:8080/realms/x').ok).toBe(false);
    process.env.SSO_ALLOW_INSECURE_HTTP = 'true';
    expect(isInsecureHttpAllowed()).toBe(true);
    expect(checkBaseUrl('http://localhost:8080/realms/x')).toEqual({ ok: true, value: 'http://localhost:8080/realms/x' });
  });

  test('refuses credentials, queries, fragments, other schemes and garbage', () => {
    for (const bad of ['https://user:pass@example.com', 'https://example.com/?a=1', 'https://example.com/#x', 'ftp://example.com', 'example.com', '']) {
      expect(checkBaseUrl(bad).ok).toBe(false);
    }
  });
});

describe('checkFieldValue', () => {
  test('hostnames are lowercased and must not contain a scheme or path', () => {
    expect(checkFieldValue('hostname', ' Dev-123.Okta.com ')).toEqual({ ok: true, value: 'dev-123.okta.com' });
    for (const bad of ['https://dev.okta.com', 'dev.okta.com/path', 'bad host', '-bad.com']) expect(checkFieldValue('hostname', bad).ok).toBe(false);
  });

  test('tenant ids, pool ids and slugs follow their formats', () => {
    expect(checkFieldValue('guid', 'ABCDEF01-2345-6789-abcd-ef0123456789')).toEqual({ ok: true, value: 'abcdef01-2345-6789-abcd-ef0123456789' });
    expect(checkFieldValue('guid', 'common').ok).toBe(false);
    expect(checkFieldValue('cognito-pool-id', 'eu-west-1_AbCdEf123').ok).toBe(true);
    expect(checkFieldValue('cognito-pool-id', 'eu-west-1').ok).toBe(false);
    expect(checkFieldValue('slug', 'default').ok).toBe(true);
    expect(checkFieldValue('slug', '../etc').ok).toBe(false);
    expect(checkFieldValue('label', 'x'.repeat(41)).ok).toBe(false);
  });
});

describe('parseEmailDomains', () => {
  test('splits, lowercases, strips @ and removes duplicates', () => {
    expect(parseEmailDomains('Example.com, @example.org;example.com\nfoo.bar')).toEqual({ ok: true, domains: ['example.com', 'example.org', 'foo.bar'] });
    expect(parseEmailDomains('')).toEqual({ ok: true, domains: [] });
  });

  test('refuses things that are not domains', () => {
    expect(parseEmailDomains('not a domain').ok).toBe(false);
    expect(parseEmailDomains('localhost').ok).toBe(false);
    expect(parseEmailDomains('a@b.com').ok).toBe(false);
  });
});
