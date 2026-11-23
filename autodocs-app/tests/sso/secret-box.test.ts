import { afterEach, describe, expect, test } from 'bun:test';
import { decryptSecret, deriveKey, encryptSecret } from '@/app/lib/server/sso/secret-box';

const originalJwtSecret = process.env.JWT_SECRET;
const originalSsoKey = process.env.SSO_SECRET_KEY;

afterEach(() => {
  process.env.JWT_SECRET = originalJwtSecret;
  if (originalSsoKey === undefined) delete process.env.SSO_SECRET_KEY;
  else process.env.SSO_SECRET_KEY = originalSsoKey;
});

describe('secret box', () => {
  test('round-trips a secret and never stores it in clear text', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    const stored = encryptSecret('super-secret-value', 'google');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('super-secret-value');
    expect(decryptSecret(stored, 'google')).toBe('super-secret-value');
  });

  test('uses a fresh random IV every time', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    expect(encryptSecret('same', 'google')).not.toBe(encryptSecret('same', 'google'));
  });

  test('refuses a ciphertext moved to another provider', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    expect(decryptSecret(encryptSecret('value', 'google'), 'github')).toBeNull();
  });

  test('refuses tampered or malformed values', () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    const parts = encryptSecret('value', 'google').split(':');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(decryptSecret(parts.join(':'), 'google')).toBeNull();
    expect(decryptSecret('not-a-secret', 'google')).toBeNull();
    expect(decryptSecret('', 'google')).toBeNull();
  });

  test('cannot be read after the base secret changes', () => {
    process.env.JWT_SECRET = 'first';
    const stored = encryptSecret('value', 'google');
    process.env.JWT_SECRET = 'second';
    expect(decryptSecret(stored, 'google')).toBeNull();
  });

  test('SSO_SECRET_KEY takes precedence over JWT_SECRET, and purposes give unrelated keys', () => {
    process.env.JWT_SECRET = 'jwt';
    const fromJwt = deriveKey('client-secret').toString('hex');
    process.env.SSO_SECRET_KEY = 'dedicated';
    expect(deriveKey('client-secret').toString('hex')).not.toBe(fromJwt);
    expect(deriveKey('flow-cookie').toString('hex')).not.toBe(deriveKey('client-secret').toString('hex'));
  });

  test('fails loudly when no base secret exists', () => {
    delete process.env.JWT_SECRET;
    delete process.env.SSO_SECRET_KEY;
    expect(() => deriveKey('client-secret')).toThrow();
  });
});
