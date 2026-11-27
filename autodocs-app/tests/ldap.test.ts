// External
import { describe, expect, test } from 'bun:test';

// Ours
import { checkLdapSettings, escapeFilterValue, fillFilter } from '../app/lib/server/ldap/settings';

describe('directory settings', () => {
  test('values cannot change the meaning of a filter', () => {
    expect(fillFilter('(mail={email})', { email: '*)(uid=\\' })).toBe('(mail=\\2a\\29\\28uid=\\5c)');
    expect(escapeFilterValue('a\0')).toBe('a\\00');
    expect(fillFilter('(x={other})', { email: 'a' })).toBe('(x={other})');
  });

  test('rejects unusable settings', () => {
    const good = { url: 'ldaps://directory.test:636', userBaseDn: 'ou=p', groupBaseDn: 'ou=g' };
    expect('settings' in checkLdapSettings(good, true)).toBe(true);
    expect('settings' in checkLdapSettings({}, false)).toBe(true);
    for (const bad of [{}, { ...good, url: 'http://x' }, { ...good, userFilter: '(mail=*)' }, { ...good, startTls: 'yes' }]) {
      expect('error' in checkLdapSettings(bad, true)).toBe(true);
    }
  });
});
