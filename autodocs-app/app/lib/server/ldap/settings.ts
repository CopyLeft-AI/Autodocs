/** The directory settings an administrator enters, and their validation. */
export interface LdapSettings {
  url: string;
  startTls: boolean;
  bindDn: string;
  userBaseDn: string;
  /** `{email}` is replaced by the account's email address. */
  userFilter: string;
  groupBaseDn: string;
  /** `{dn}` and `{uid}` are replaced by the found user's values. */
  groupFilter: string;
  groupNameAttribute: string;
}

export const DEFAULT_LDAP_SETTINGS: LdapSettings = {
  url: '',
  startTls: false,
  bindDn: '',
  userBaseDn: '',
  userFilter: '(mail={email})',
  groupBaseDn: '',
  groupFilter: '(|(member={dn})(uniqueMember={dn})(memberUid={uid}))',
  groupNameAttribute: 'cn',
};

/** Escape a value placed inside a search filter (RFC 4515). */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (character) => `\\${character.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function fillFilter(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? escapeFilterValue(values[name]) : placeholder));
}

export function checkLdapSettings(value: unknown, enabled: boolean): { settings: LdapSettings } | { error: string } {
  const input = (value ?? {}) as Record<string, unknown>;
  const settings = { ...DEFAULT_LDAP_SETTINGS };
  for (const key of Object.keys(DEFAULT_LDAP_SETTINGS) as Array<keyof LdapSettings>) {
    const given = input[key];
    if (given === undefined) continue;
    if (key === 'startTls') {
      if (typeof given !== 'boolean') return { error: 'startTls must be true or false.' };
      settings.startTls = given;
    } else {
      if (typeof given !== 'string' || given.length > 500) return { error: `${key} must be text of at most 500 characters.` };
      settings[key] = given.trim() || (key === 'userFilter' || key === 'groupFilter' || key === 'groupNameAttribute' ? DEFAULT_LDAP_SETTINGS[key] : '');
    }
  }
  if (settings.url && !/^ldaps?:\/\/[^\s/]+\/?$/i.test(settings.url)) return { error: 'The address must look like ldap://host:389 or ldaps://host:636.' };
  if (enabled && (!settings.url || !settings.userBaseDn || !settings.groupBaseDn)) return { error: 'The address and both base DNs are needed to enable the directory.' };
  if (!settings.userFilter.includes('{email}')) return { error: 'The user filter must contain {email}.' };
  return { settings };
}
