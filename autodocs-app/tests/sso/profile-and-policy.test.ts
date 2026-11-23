import { describe, expect, test } from 'bun:test';
import { checkProfileAgainstPolicy } from '@/app/lib/server/sso/account-policy';
import { finalizeProfile, profileFromClaims } from '@/app/lib/server/sso/profile-mapping';
import type { SsoAccountPolicy, SsoProfile } from '@/app/lib/server/sso/types';

const openPolicy: SsoAccountPolicy = { trustProviderEmail: false, allowNewUsers: true, linkExistingAccounts: true, allowedEmailDomains: [] };
const verified: SsoProfile = { subject: 's1', email: 'ann@example.com', emailVerified: true, name: 'Ann' };

describe('profileFromClaims', () => {
  test('lowercases the email and reads email_verified', () => {
    const profile = profileFromClaims({ sub: 'abc', email: ' Ann@Example.COM ', email_verified: true, name: 'Ann Lee' }, []);
    expect(profile).toEqual({ subject: 'abc', email: 'ann@example.com', emailVerifiedByProvider: true, name: 'Ann Lee' });
  });

  test('accepts the string "true" some providers send, but not other truthy-looking values', () => {
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', email_verified: 'true' }, []).emailVerifiedByProvider).toBe(true);
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', email_verified: 'yes' }, []).emailVerifiedByProvider).toBe(false);
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', email_verified: false }, []).emailVerifiedByProvider).toBe(false);
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co' }, []).emailVerifiedByProvider).toBe(false);
  });

  test('provider-specific claims such as Microsoft xms_edov count as verification', () => {
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', xms_edov: true }, ['xms_edov']).emailVerifiedByProvider).toBe(true);
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', xms_edov: '1' }, ['xms_edov']).emailVerifiedByProvider).toBe(true);
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', xms_edov: true }, []).emailVerifiedByProvider).toBe(false);
  });

  test('falls back to preferred_username, then the email name, then a default for the display name', () => {
    expect(profileFromClaims({ sub: 'a', email: 'a@b.co', preferred_username: 'ann' }, []).name).toBe('ann');
    expect(profileFromClaims({ sub: 'a', email: 'jane@b.co' }, []).name).toBe('jane');
    expect(profileFromClaims({ sub: 'a' }, []).name).toBe('User');
  });
});

describe('finalizeProfile', () => {
  const raw = { subject: 's', email: 'a@b.co', emailVerifiedByProvider: false, name: 'A' };

  test('without the trust setting an unverified email stays unverified', () => {
    expect(finalizeProfile(raw, openPolicy).emailVerified).toBe(false);
  });

  test('the trust setting verifies a present email but never a missing one', () => {
    const trusting = { ...openPolicy, trustProviderEmail: true };
    expect(finalizeProfile(raw, trusting).emailVerified).toBe(true);
    expect(finalizeProfile({ ...raw, email: '' }, trusting).emailVerified).toBe(false);
  });
});

describe('checkProfileAgainstPolicy', () => {
  test('lets a verified profile in', () => {
    expect(checkProfileAgainstPolicy(verified, openPolicy)).toEqual({ ok: true });
  });

  test('refuses a missing subject, a missing email and an unverified email, in that order', () => {
    expect(checkProfileAgainstPolicy({ ...verified, subject: '' }, openPolicy)).toEqual({ ok: false, code: 'exchange_failed' });
    expect(checkProfileAgainstPolicy({ ...verified, email: '' }, openPolicy)).toEqual({ ok: false, code: 'email_missing' });
    expect(checkProfileAgainstPolicy({ ...verified, email: 'no-at-sign' }, openPolicy)).toEqual({ ok: false, code: 'email_missing' });
    expect(checkProfileAgainstPolicy({ ...verified, emailVerified: false }, openPolicy)).toEqual({ ok: false, code: 'email_unverified' });
  });

  test('enforces the allowed domains exactly (a look-alike or subdomain is not allowed)', () => {
    const policy = { ...openPolicy, allowedEmailDomains: ['example.com'] };
    expect(checkProfileAgainstPolicy(verified, policy)).toEqual({ ok: true });
    expect(checkProfileAgainstPolicy({ ...verified, email: 'ann@evil-example.com' }, policy)).toEqual({ ok: false, code: 'domain_not_allowed' });
    expect(checkProfileAgainstPolicy({ ...verified, email: 'ann@mail.example.com' }, policy)).toEqual({ ok: false, code: 'domain_not_allowed' });
    expect(checkProfileAgainstPolicy({ ...verified, email: 'ann@example.com.evil.io' }, policy)).toEqual({ ok: false, code: 'domain_not_allowed' });
  });
});
