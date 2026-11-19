import { db } from '@/app/lib/server/db';

export const DEFAULT_REMOTE_API_CONCURRENCY = 8;
export const MIN_REMOTE_API_CONCURRENCY = 1;
export const MAX_REMOTE_API_CONCURRENCY = 32;

/** Parallel model requests allowed per analysis; the user's saved value or the default. */
export async function readRemoteApiConcurrency(userId: string): Promise<number> {
  const result = await db.query<{ remote_api_concurrency: number }>(
    'SELECT remote_api_concurrency FROM user_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.remote_api_concurrency ?? DEFAULT_REMOTE_API_CONCURRENCY;
}

export async function saveRemoteApiConcurrency(userId: string, value: number): Promise<void> {
  await db.query(
    `INSERT INTO user_settings (user_id, remote_api_concurrency) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET remote_api_concurrency = EXCLUDED.remote_api_concurrency, updated_at = NOW()`,
    [userId, value],
  );
}
