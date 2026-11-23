// Ours
import type { SsoAccountPolicy, SsoProfile } from '@/app/lib/server/sso/types';

/** What a provider reported, before the account policy is applied. */
export interface RawProfile {
  subject: string;
  email: string;
  /** The provider itself says the email is verified. */
  emailVerifiedByProvider: boolean;
  name: string;
}

function isTruthyClaim(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Turn OpenID Connect claims into a profile. `verifiedEmailClaims` lists provider-specific claims (for
 * example Microsoft's `xms_edov`) that count like `email_verified`.
 */
export function profileFromClaims(claims: Record<string, unknown>, verifiedEmailClaims: string[]): RawProfile {
  const email = readString(claims.email).toLowerCase();
  const name = readString(claims.name) || readString(claims.preferred_username) || (email.includes('@') ? email.split('@')[0] : '');
  return {
    subject: readString(claims.sub),
    email,
    emailVerifiedByProvider: [claims.email_verified, ...verifiedEmailClaims.map((claim) => claims[claim])].some(isTruthyClaim),
    name: name || 'User',
  };
}

/** Apply the administrator's trust setting: with it, any email the provider supplies counts as verified. */
export function finalizeProfile(raw: RawProfile, policy: SsoAccountPolicy): SsoProfile {
  return {
    subject: raw.subject,
    email: raw.email,
    emailVerified: raw.email !== '' && (raw.emailVerifiedByProvider || policy.trustProviderEmail),
    name: raw.name,
  };
}
