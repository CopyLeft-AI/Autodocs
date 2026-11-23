// Ours
import type { SsoAccountPolicy, SsoErrorCode, SsoProfile } from '@/app/lib/server/sso/types';

/**
 * Decide, without touching the database, whether the person described by `profile` may sign in.
 * A verified email is required for every sign-in: accounts (and the built-in administrators) are identified
 * by email, so an email the provider did not vouch for must never reach account matching.
 */
export function checkProfileAgainstPolicy(profile: SsoProfile, policy: SsoAccountPolicy): { ok: true } | { ok: false; code: SsoErrorCode } {
  if (profile.subject === '') return { ok: false, code: 'exchange_failed' };
  if (profile.email === '' || !profile.email.includes('@')) return { ok: false, code: 'email_missing' };
  if (!profile.emailVerified) return { ok: false, code: 'email_unverified' };
  if (policy.allowedEmailDomains.length > 0) {
    const domain = profile.email.slice(profile.email.lastIndexOf('@') + 1);
    if (!policy.allowedEmailDomains.includes(domain)) return { ok: false, code: 'domain_not_allowed' };
  }
  return { ok: true };
}
