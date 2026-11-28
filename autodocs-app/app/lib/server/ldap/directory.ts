/** The only code that speaks LDAP. */
import { Client } from 'ldapts';
import { fillFilter, type LdapSettings } from './settings';

const TIMEOUT_MILLISECONDS = 5000;

export interface Directory {
  /** Group names of the person with this email, or null when the directory has no such person. */
  groupsOf(email: string): Promise<string[] | null>;
  close(): Promise<void>;
}

const first = (value: unknown): string => String(Array.isArray(value) ? value[0] ?? '' : value ?? '');

export async function openDirectory(settings: LdapSettings, bindPassword: string): Promise<Directory> {
  const client = new Client({ url: settings.url, timeout: TIMEOUT_MILLISECONDS, connectTimeout: TIMEOUT_MILLISECONDS });
  try {
    if (settings.startTls) await client.startTLS({});
    // An empty bind DN means the directory allows anonymous searches.
    if (settings.bindDn) {
      // A simple bind with an empty password is accepted anonymously by many servers.
      if (!bindPassword) throw new Error('A bind password is needed with a bind DN.');
      await client.bind(settings.bindDn, bindPassword);
    }
  } catch (error) {
    await client.unbind().catch(() => undefined);
    throw error;
  }

  return {
    async groupsOf(email) {
      const users = await client.search(settings.userBaseDn, { scope: 'sub', filter: fillFilter(settings.userFilter, { email }), attributes: ['uid'] });
      if (users.searchEntries.length === 0) return null;
      if (users.searchEntries.length > 1) throw new Error('Several directory entries match this email.');
      const [user] = users.searchEntries;
      const groups = await client.search(settings.groupBaseDn, {
        scope: 'sub',
        filter: fillFilter(settings.groupFilter, { dn: user.dn, uid: first(user.uid) }),
        attributes: [settings.groupNameAttribute],
        paged: true,
      });
      return [...new Set(groups.searchEntries.map((entry) => first(entry[settings.groupNameAttribute]).trim()).filter(Boolean))];
    },
    close: () => client.unbind(),
  };
}
