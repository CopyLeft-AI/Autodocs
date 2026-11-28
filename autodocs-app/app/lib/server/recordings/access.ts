// External
import type { PoolClient } from 'pg';

// Ours
import type { SessionAccess } from '@/app/lib/annotations/types';
import { db } from '@/app/lib/server/db';
import { RequestError } from './errors';

export type Need = 'view' | 'annotate' | 'own';

/**
 * The single access rule for a recording: owners can do everything, people it
 * is shared with can view, and may annotate only if the owner allowed it.
 * Someone without any access gets 404, so ids cannot be probed.
 */
export async function requireAccess(userId: string, sessionId: string, need: Need, client: PoolClient | typeof db = db): Promise<SessionAccess> {
  const row = (await client.query<{ owner: boolean; can_annotate: boolean }>(
    'SELECT owner, can_annotate FROM terminal_session_access WHERE user_id = $1 AND terminal_session_id = $2',
    [userId, sessionId],
  )).rows[0];
  if (!row) throw new RequestError(404, 'Session not found.');
  const access = { isOwner: row.owner, canAnnotate: row.owner || row.can_annotate };
  if (need === 'own' && !access.isOwner) throw new RequestError(403, 'Only the owner can do this.');
  if (need === 'annotate' && !access.canAnnotate) throw new RequestError(403, 'This session was shared with you without the right to annotate it.');
  return access;
}

/** Run `work` in one transaction on one connection. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
