"use client";

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  canEditSettings: boolean;
  rightsMode: 'own' | 'groups';
  groupIds: string[];
  isAdmin: boolean;
  isHardcodedAdmin: boolean;
  effectiveCanEditSettings: boolean;
}

interface ManagedGroup {
  id: string;
  name: string;
  isAdmin: boolean;
  canEditSettings: boolean;
  memberIds: string[];
}

const inputClass = 'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60';
const buttonClass = 'inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60';

async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `Request failed with status ${response.status}`);
  return data;
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">{title}</p>
      <div className="flex gap-4 items-start">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** Administrators manage users (rights source, groups, own rights) and groups (rights, members). */
export function RightsAdmin({ view }: { view: 'users' | 'groups' }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [groups, setGroups] = useState<ManagedGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([call('/api/admin/users', 'GET'), call('/api/admin/groups', 'GET')]);
      setUsers(u.users as ManagedUser[]);
      setGroups(g.groups as ManagedGroup[]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setErrorMessage(null);
    try {
      await action();
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save.');
    } finally {
      setBusy(null);
    }
  };

  const patchUser = (user: ManagedUser, changes: Record<string, unknown>) => run(user.id, () => call(`/api/admin/users/${user.id}`, 'PATCH', changes));
  const patchGroup = (group: ManagedGroup, changes: Record<string, unknown>) => run(group.id, () => call(`/api/admin/groups/${group.id}`, 'PATCH', changes));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const loading = !users || !groups;
  const status = (
    <>
      {loading && !errorMessage && <p className="text-sm text-muted-foreground">Loading...</p>}
      {errorMessage && <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage}</p>}
    </>
  );

  if (view === 'users') {
    return (
      <Card title="User rights" icon={<ShieldCheck className="h-5 w-5" />}>
        <p className="mb-4 text-xs text-muted-foreground">
          A user either has their own rights, or gets the rights of the groups they belong to (every right any of their groups has).
          Administrators can do everything. Built-in administrators cannot be changed.
        </p>
        {users && groups && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">User</th>
                  <th className="py-2 pr-4 font-normal">Rights from</th>
                  <th className="py-2 pr-4 font-normal">Groups</th>
                  <th className="py-2 pr-4 font-normal">Administrator</th>
                  <th className="py-2 font-normal">Can edit settings</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const fromGroups = user.rightsMode === 'groups';
                  const locked = user.isHardcodedAdmin || busy === user.id;
                  const names = groups.filter((g) => user.groupIds.includes(g.id)).map((g) => g.name);
                  return (
                    <tr key={user.id} className="border-t border-border/60" data-email={user.email}>
                      <td className="py-2.5 pr-4">
                        <div className="text-foreground">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}{user.isHardcodedAdmin ? ' (built-in administrator)' : ''}</div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <select
                          aria-label={`${user.email} rights from`} className={inputClass} value={user.rightsMode} disabled={locked}
                          onChange={(event) => void patchUser(user, { rightsMode: event.target.value })}
                        >
                          <option value="own">Own rights</option>
                          <option value="groups">Groups</option>
                        </select>
                      </td>
                      <td className="py-2.5 pr-4">
                        <details className="relative">
                          <summary className="cursor-pointer whitespace-nowrap text-xs text-muted-foreground" aria-label={`${user.email} groups`}>
                            {names.length ? names.join(', ') : 'None'}
                          </summary>
                          <div className="absolute z-10 mt-1 min-w-40 rounded-lg border border-border bg-card p-2 shadow-lg">
                            {groups.length === 0 && <p className="text-xs text-muted-foreground">No groups yet.</p>}
                            {groups.map((group) => (
                              <label key={group.id} className="flex items-center gap-2 py-0.5 text-xs">
                                <input
                                  type="checkbox" checked={user.groupIds.includes(group.id)} disabled={user.isHardcodedAdmin || busy === user.id}
                                  aria-label={`${user.email} in ${group.name}`}
                                  onChange={(event) => void patchUser(user, { groupIds: toggle(user.groupIds, group.id, event.target.checked) })}
                                />
                                {group.name}
                              </label>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td className="py-2.5 pr-4">
                        <input
                          type="checkbox" aria-label={`${user.email} is administrator`} checked={user.isAdmin}
                          disabled={locked || fromGroups}
                          onChange={(event) => void patchUser(user, { role: event.target.checked ? 'admin' : 'user' })}
                        />
                      </td>
                      <td className="py-2.5">
                        <input
                          type="checkbox" aria-label={`${user.email} can edit settings`} checked={user.effectiveCanEditSettings}
                          disabled={locked || fromGroups || user.isAdmin}
                          onChange={(event) => void patchUser(user, { canEditSettings: event.target.checked })}
                        />
                        {fromGroups && !user.isHardcodedAdmin && <span className="ml-2 text-xs text-muted-foreground">via groups</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {status}
      </Card>
    );
  }

  return (
    <Card title="Groups" icon={<Users className="h-5 w-5" />}>
      <p className="mb-4 text-xs text-muted-foreground">
        A group gives its rights to every member whose rights come from groups (set in the Users tab). Members who use their own rights keep them.
      </p>
      <form
        className="mb-5 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run('new', async () => { await call('/api/admin/groups', 'POST', { name: newName }); setNewName(''); });
        }}
      >
        <input aria-label="New group name" className={inputClass} placeholder="New group name" value={newName} maxLength={50} onChange={(event) => setNewName(event.target.value)} />
        <button type="submit" className={buttonClass} disabled={busy === 'new' || newName.trim() === ''}>Create group</button>
      </form>
      {users && groups && (
        <div className="space-y-4">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet.</p>}
          {groups.map((group) => (
            <fieldset key={group.id} className="rounded-lg border border-border/70 p-4" data-group={group.name} disabled={busy === group.id}>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  aria-label={`Name of group ${group.name}`} className={inputClass} defaultValue={group.name} maxLength={50}
                  onBlur={(event) => { if (event.target.value.trim() !== group.name) void patchGroup(group, { name: event.target.value }); }}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`${group.name} grants administrator`} checked={group.isAdmin} onChange={(event) => void patchGroup(group, { isAdmin: event.target.checked })} />
                  Administrator
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`${group.name} grants edit settings`} checked={group.isAdmin || group.canEditSettings} disabled={group.isAdmin} onChange={(event) => void patchGroup(group, { canEditSettings: event.target.checked })} />
                  Can edit settings
                </label>
                <button
                  type="button" className={`${buttonClass} ml-auto`}
                  onClick={() => {
                    if (confirmDelete !== group.id) { setConfirmDelete(group.id); return; }
                    setConfirmDelete(null);
                    void run(group.id, () => call(`/api/admin/groups/${group.id}`, 'DELETE'));
                  }}
                >
                  {confirmDelete === group.id ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
              <p className="mt-3 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">Members ({group.memberIds.length})</p>
              <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {users.map((user) => (
                  <label key={user.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" aria-label={`${user.email} member of ${group.name}`} checked={group.memberIds.includes(user.id)} disabled={user.isHardcodedAdmin}
                      onChange={(event) => void patchGroup(group, { memberIds: toggle(group.memberIds, user.id, event.target.checked) })}
                    />
                    <span className="truncate">{user.email}</span>
                    {user.rightsMode === 'own' && group.memberIds.includes(user.id) && <span className="text-xs text-muted-foreground">(uses own rights)</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {status}
    </Card>
  );
}
