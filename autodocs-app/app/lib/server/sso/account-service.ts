// External
import type { PoolClient } from 'pg';
// Ours
import { db } from '@/app/lib/server/db';
import type { SessionUser } from '@/app/lib/server/session-auth';
import type { SsoAccountPolicy, SsoProfile, SsoProviderId, SsoResult } from '@/app/lib/server/sso/types';

const USER_COLUMNS = 'u.id, u.email, u.name, u.created_at';
const UNIQUE_VIOLATION = '23505';
const MAX_NAME_LENGTH = 100;

async function findLinkedUser(client: PoolClient, provider: SsoProviderId, subject: string): Promise<SessionUser | null> {
  const result = await client.query<SessionUser>(
    `SELECT ${USER_COLUMNS} FROM oauth_accounts a JOIN users u ON u.id = a.user_id WHERE a.provider = $1 AND a.provider_user_id = $2`,
    [provider, subject],
  );
  return result.rows[0] ?? null;
}

async function findUserByEmail(client: PoolClient, email: string): Promise<SessionUser | null> {
  const result = await client.query<SessionUser>(`SELECT ${USER_COLUMNS} FROM users u WHERE lower(u.email) = $1`, [email]);
  return result.rows[0] ?? null;
}

async function linkIdentity(client: PoolClient, userId: string, provider: SsoProviderId, profile: SsoProfile): Promise<void> {
  await client.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [userId, provider, profile.subject, profile.email],
  );
}

async function matchOrCreate(
  client: PoolClient,
  provider: SsoProviderId,
  profile: SsoProfile,
  policy: SsoAccountPolicy,
): Promise<SsoResult<SessionUser>> {
  // 1. The same person signed in through this provider before.
  const linked = await findLinkedUser(client, provider, profile.subject);
  if (linked) return { ok: true, value: linked };

  // 2. An account with the same (verified) email exists.
  const sameEmail = await findUserByEmail(client, profile.email);
  if (sameEmail) {
    if (!policy.linkExistingAccounts) return { ok: false, code: 'linking_disabled' };
    await linkIdentity(client, sameEmail.id, provider, profile);
    return { ok: true, value: sameEmail };
  }

  // 3. A new person: create an account without a password.
  if (!policy.allowNewUsers) return { ok: false, code: 'signups_disabled' };
  const created = await client.query<SessionUser>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, NULL) RETURNING id, email, name, created_at`,
    [profile.email, profile.name.slice(0, MAX_NAME_LENGTH)],
  );
  await linkIdentity(client, created.rows[0].id, provider, profile);
  return { ok: true, value: created.rows[0] };
}

/**
 * Find the local account for a verified provider profile, linking or creating it as the policy allows.
 * Runs in one transaction; if two first-time sign-ins of the same person race (unique violation), the loser retries
 * once and then finds the winner's rows.
 */
export async function resolveAccount(provider: SsoProviderId, profile: SsoProfile, policy: SsoAccountPolicy): Promise<SsoResult<SessionUser>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const outcome = await matchOrCreate(client, provider, profile, policy);
      await client.query(outcome.ok ? 'COMMIT' : 'ROLLBACK');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const isRace = typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
      if (!isRace || attempt === 1) {
        console.error(`[sso] Error in account-service.ts:resolveAccount for ${provider}:`, error instanceof Error ? error.message : error);
        return { ok: false, code: 'unexpected' };
      }
    } finally {
      client.release();
    }
  }
  return { ok: false, code: 'unexpected' };
}
