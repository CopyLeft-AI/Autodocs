import { db } from '@/app/lib/server/db';

export const MIN_REMOTE_API_CONCURRENCY = 1;
export const MAX_REMOTE_API_CONCURRENCY = 32;

/** The user's saved parallel-request limit, or null to use the service configuration's default. */
export async function readRemoteApiConcurrency(userId: string): Promise<number | null> {
  const result = await db.query<{ remote_api_concurrency: number }>(
    'SELECT remote_api_concurrency FROM user_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.remote_api_concurrency ?? null;
}

export async function saveRemoteApiConcurrency(userId: string, value: number): Promise<void> {
  await db.query(
    `INSERT INTO user_settings (user_id, remote_api_concurrency) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET remote_api_concurrency = EXCLUDED.remote_api_concurrency, updated_at = NOW()`,
    [userId, value],
  );
}

/** Remove the user's own limit so the service configuration's default applies again. */
export async function clearRemoteApiConcurrency(userId: string): Promise<void> {
  await db.query('DELETE FROM user_settings WHERE user_id = $1', [userId]);
}
