"use client";

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  canEditSettings: boolean;
  isAdmin: boolean;
  isHardcodedAdmin: boolean;
  effectiveCanEditSettings: boolean;
}

/** Administrators make other users admins and choose who may edit settings. */
export function UserRightsCard() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch('/api/admin/users', { credentials: 'include' });
      const data = (await response.json().catch(() => ({}))) as { users?: ManagedUser[]; message?: string };
      if (!response.ok || !data.users) throw new Error(data.message ?? `Request failed with status ${response.status}`);
      setUsers(data.users);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load users.');
    }
  };

  useEffect(() => { void load(); }, []);

  const change = async (user: ManagedUser, changes: { role?: 'user' | 'admin'; canEditSettings?: boolean }) => {
    setBusyId(user.id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(changes),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? `Request failed with status ${response.status}`);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">User rights</p>
      <div className="flex gap-4 items-start">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-4 text-xs text-muted-foreground">
            Administrators can do everything and manage these rights. Other users can edit the analysis settings only if you allow it.
            Built-in administrators cannot be changed.
          </p>
          {!users && !errorMessage && <p className="text-sm text-muted-foreground">Loading...</p>}
          {users && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="py-2 pr-4 font-normal">User</th>
                    <th className="py-2 pr-4 font-normal">Administrator</th>
                    <th className="py-2 font-normal">Can edit settings</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-border/60" data-email={user.email}>
                      <td className="py-2.5 pr-4">
                        <div className="text-foreground">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}{user.isHardcodedAdmin ? ' (built-in administrator)' : ''}</div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <input
                          type="checkbox" aria-label={`${user.email} is administrator`} checked={user.isAdmin}
                          disabled={user.isHardcodedAdmin || busyId === user.id}
                          onChange={(event) => void change(user, { role: event.target.checked ? 'admin' : 'user' })}
                        />
                      </td>
                      <td className="py-2.5">
                        <input
                          type="checkbox" aria-label={`${user.email} can edit settings`} checked={user.effectiveCanEditSettings}
                          disabled={user.isAdmin || busyId === user.id}
                          onChange={(event) => void change(user, { canEditSettings: event.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {errorMessage && <p className="mt-3 text-sm text-destructive">{errorMessage}</p>}
        </div>
      </div>
    </div>
  );
}
