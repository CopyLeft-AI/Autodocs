/**
 * Copy directory memberships into AutoDocs groups. The directory manages only
 * groups it created; a local group with the same name is never touched, so a
 * directory cannot grant rights an administrator gave to a local group.
 */
import type { PoolClient } from 'pg';
import { transaction } from '@/app/lib/server/recordings/access';

/** Group names longer than this cannot be stored. */
const MAX_NAME_LENGTH = 50;

export interface MembershipResult {
  groups: string[];
  /** Directory groups ignored: their name is too long or belongs to a local group. */
  skipped: string[];
}

export async function storeMemberships(client: PoolClient, userId: string, names: string[]): Promise<MembershipResult> {
  const result: MembershipResult = { groups: [], skipped: [] };
  const ids: string[] = [];
  // A fixed order keeps two simultaneous synchronisations from deadlocking.
  for (const name of [...names].sort()) {
    if (name.length > MAX_NAME_LENGTH) { result.skipped.push(name); continue; }
    await client.query(`INSERT INTO user_groups (name, source) VALUES ($1, 'ldap') ON CONFLICT (lower(name)) DO NOTHING`, [name]);
    const group = (await client.query<{ id: string }>(`SELECT id FROM user_groups WHERE lower(name) = lower($1) AND source = 'ldap'`, [name])).rows[0];
    if (!group) { result.skipped.push(name); continue; }
    ids.push(group.id);
    result.groups.push(name);
  }
  await client.query(
    `DELETE FROM user_group_members m USING user_groups g
     WHERE m.group_id = g.id AND g.source = 'ldap' AND m.user_id = $1 AND NOT (g.id = ANY($2::uuid[]))`,
    [userId, ids],
  );
  await client.query(
    `INSERT INTO user_group_members (group_id, user_id) SELECT unnest($2::uuid[]), $1 ON CONFLICT DO NOTHING`,
    [userId, ids],
  );
  return result;
}

export const saveMemberships = (userId: string, names: string[]): Promise<MembershipResult> =>
  transaction((client) => storeMemberships(client, userId, names));
