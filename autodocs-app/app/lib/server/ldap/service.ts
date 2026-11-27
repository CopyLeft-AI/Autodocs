// Ours
import { db } from '@/app/lib/server/db';
import { RequestError } from '@/app/lib/server/recordings/errors';
import { decryptSecret, encryptSecret } from '@/app/lib/server/sso/secret-box';
import { openDirectory } from './directory';
import { checkLdapSettings, DEFAULT_LDAP_SETTINGS, type LdapSettings } from './settings';
import { saveMemberships } from './sync';

const SECRET_CONTEXT = 'ldap';

interface Stored { enabled: boolean; settings: LdapSettings; encrypted: string | null; }

async function load(): Promise<Stored> {
  const row = (await db.query<{ enabled: boolean; settings: Partial<LdapSettings>; encrypted: string | null }>(
    'SELECT enabled, settings, bind_password_encrypted AS encrypted FROM ldap_settings',
  )).rows[0];
  return { enabled: row?.enabled ?? false, settings: { ...DEFAULT_LDAP_SETTINGS, ...row?.settings }, encrypted: row?.encrypted ?? null };
}

/** The saved settings without the password. */
export async function readLdapView() {
  const { enabled, settings, encrypted } = await load();
  return { enabled, settings, hasBindPassword: encrypted !== null };
}

export async function saveLdapSettings(userId: string, body: Record<string, unknown>) {
  const enabled = body.enabled === true;
  const checked = checkLdapSettings(body.settings, enabled);
  if ('error' in checked) throw new RequestError(400, checked.error);
  const password = body.bindPassword;
  if (password !== undefined && (typeof password !== 'string' || password.length > 500)) throw new RequestError(400, 'Invalid bind password.');
  const stored = await load();
  // The saved password must not follow a changed server address to another host.
  const keep = checked.settings.url === stored.settings.url && checked.settings.startTls === stored.settings.startTls;
  const encrypted = password ? encryptSecret(password, SECRET_CONTEXT) : password === '' || !keep ? null : stored.encrypted;
  await db.query(
    `INSERT INTO ldap_settings (id, enabled, settings, bind_password_encrypted, updated_by)
     VALUES (TRUE, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET enabled = $1, settings = $2, bind_password_encrypted = $3, updated_by = $4, updated_at = NOW()`,
    [enabled, JSON.stringify(checked.settings), encrypted, userId],
  );
  return readLdapView();
}

async function connect(stored: Stored) {
  const password = stored.encrypted ? decryptSecret(stored.encrypted, SECRET_CONTEXT) : '';
  if (password === null) throw new RequestError(409, 'The saved bind password can no longer be read. Enter it again.');
  try {
    return await openDirectory(stored.settings, password);
  } catch (error) {
    console.error('LDAP connection failed:', stored.settings.url, error);
    throw new RequestError(502, `Could not connect to the directory: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/** Look one email up with the saved settings, changing nothing. */
export async function testLdapLookup(email: string) {
  const directory = await connect(await load());
  try {
    const groups = await directory.groupsOf(email);
    return { found: groups !== null, groups: groups ?? [] };
  } catch (error) {
    throw new RequestError(502, `The directory search failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    await directory.close().catch(() => undefined);
  }
}

export interface SyncReport { synced: number; notFound: number; failed: number; skippedGroups: string[]; }

/** Refresh the directory memberships of the given users. */
async function syncUsers(users: Array<{ id: string; email: string }>, stored: Stored): Promise<SyncReport> {
  const report: SyncReport = { synced: 0, notFound: 0, failed: 0, skippedGroups: [] };
  const directory = await connect(stored);
  const skipped = new Set<string>();
  try {
    for (const user of users) {
      try {
        const groups = await directory.groupsOf(user.email);
        // Someone gone from the directory loses its groups too.
        (await saveMemberships(user.id, groups ?? [])).skipped.forEach((name) => skipped.add(name));
        if (groups === null) report.notFound++; else report.synced++;
      } catch (error) {
        console.error('LDAP synchronisation failed for user', user.id, error);
        report.failed++;
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return { ...report, skippedGroups: [...skipped].sort() };
}

export async function syncAllUsers(): Promise<SyncReport> {
  const stored = await load();
  if (!stored.enabled) throw new RequestError(409, 'Enable the directory first.');
  const users = await db.query<{ id: string; email: string }>('SELECT id, email FROM users');
  return syncUsers(users.rows, stored);
}

/** Called at sign-in. A directory problem is logged and never blocks signing in. */
export async function syncUserAtLogin(user: { id: string; email: string }): Promise<void> {
  try {
    const stored = await load();
    if (stored.enabled) await syncUsers([user], stored);
  } catch (error) {
    console.error('LDAP synchronisation at sign-in failed for user', user.id, error);
  }
}
