"use client";

import { useEffect, useState } from 'react';
import { messageOf, request } from '@/app/lib/editor/api';
import type { LdapSettings } from '@/app/lib/server/ldap/settings';
import type { SyncReport } from '@/app/lib/server/ldap/service';

interface View { enabled: boolean; settings: LdapSettings; hasBindPassword: boolean; }

const FIELDS: Array<[Exclude<keyof LdapSettings, 'startTls'>, string, string]> = [
  ['url', 'Server address', 'ldaps://ldap.example.org:636'],
  ['bindDn', 'Account used to search (empty for anonymous)', 'cn=reader,dc=example,dc=org'],
  ['userBaseDn', 'Where people are', 'ou=people,dc=example,dc=org'],
  ['userFilter', 'Filter finding a person by email', '(mail={email})'],
  ['groupBaseDn', 'Where groups are', 'ou=groups,dc=example,dc=org'],
  ['groupFilter', 'Filter finding a person’s groups', '(member={dn})'],
  ['groupNameAttribute', 'Attribute holding the group name', 'cn'],
];

const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';

/** Settings of the LDAP directory that supplies group memberships. */
export function LdapAdmin() {
  const [view, setView] = useState<View | null>(null);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    request<View>('GET', '/api/admin/ldap').then(setView).catch((error: unknown) => setResult({ ok: false, message: messageOf(error) }));
  }, []);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setResult(null);
    try { setResult({ ok: true, message: await work() }); }
    catch (error) { setResult({ ok: false, message: messageOf(error) }); }
    finally { setBusy(false); }
  };

  if (!view) return <p role="status" className="text-sm text-muted-foreground">{result?.message ?? 'Loading the directory settings…'}</p>;

  const save = () => run(async () => {
    setView(await request<View>('PUT', '/api/admin/ldap', { enabled: view.enabled, settings: view.settings, ...(password && { bindPassword: password }) }));
    setPassword('');
    return 'Saved.';
  });
  const change = (settings: Partial<LdapSettings>) => setView({ ...view, settings: { ...view.settings, ...settings } });

  return (
    <section className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-foreground">LDAP directory</h2>
        <p className="text-sm text-muted-foreground">
          Group memberships are copied at sign-in, matched by email. New groups appear under Groups without any right; give them rights there. They only affect users whose rights come from their groups. Changes to their members here are overwritten.
        </p>
      </div>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={view.enabled} onChange={(event) => setView({ ...view, enabled: event.target.checked })} /> Use this directory</label>
        {FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="block space-y-1">
            <span className="text-sm">{label}</span>
            <input value={view.settings[key]} placeholder={placeholder} onChange={(event) => change({ [key]: event.target.value })} className={input} />
          </label>
        ))}
        <label className="block space-y-1">
          <span className="text-sm">Password of that account</span>
          <input type="password" autoComplete="new-password" value={password} placeholder={view.hasBindPassword ? 'Saved; type to replace it' : ''} onChange={(event) => setPassword(event.target.value)} className={input} />
          <span className="text-xs text-muted-foreground">Changing the server address removes the saved password.</span>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={view.settings.startTls} onChange={(event) => change({ startTls: event.target.checked })} /> Upgrade the connection with StartTLS</label>
        <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Save</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email to look up" aria-label="Email to look up" className={`${input} max-w-xs`} />
        <button type="button" disabled={busy || !email.trim()} className={button} onClick={() => void run(async () => {
          const found = await request<{ found: boolean; groups: string[] }>('POST', '/api/admin/ldap/test', { email });
          return !found.found ? 'No directory entry has this email.' : found.groups.length ? `Groups: ${found.groups.join(', ')}` : 'Found, in no group.';
        })}>Test lookup</button>
        <button type="button" disabled={busy || !view.enabled} className={button} onClick={() => void run(async () => {
          const report = await request<SyncReport>('POST', '/api/admin/ldap/sync');
          return `${report.synced} synchronised, ${report.notFound} not in the directory, ${report.failed} failed.${report.skippedGroups.length ? ` Ignored groups: ${report.skippedGroups.join(', ')}.` : ''}`;
        })}>Synchronise everyone now</button>
      </div>
      <p className="text-xs text-muted-foreground">Tests and synchronisation use the saved settings.</p>
      {result && <p role="status" className={`text-sm ${result.ok ? 'text-emerald-300' : 'text-destructive'}`}>{result.message}</p>}
    </section>
  );
}
