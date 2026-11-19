"use client";

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Gauge, KeyRound } from 'lucide-react';
import { RightsAdmin } from '@/app/components/RightsAdmin';
import { usePermissions } from '@/app/lib/use-permissions';
import { InferenceSettingsCard } from '@/app/components/InferenceSettingsCard';

const MASKED_PASSWORD = '........';

function ChangeButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-border bg-primary/10 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/20 sm:self-center"
    >
      <KeyRound className="h-4 w-4" />
      <span>Change</span>
    </button>
  );
}

interface ProcessingSettings {
  /** null: the user has no limit of their own and the service default applies. */
  remoteApiConcurrency: number | null;
  limits: { min: number; max: number };
  message?: string;
}

/** Edits how many model requests one analysis may send in parallel to a remote API. */
function ProcessingSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<ProcessingSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/settings/processing', { credentials: 'include' });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        const data = (await response.json()) as ProcessingSettings;
        setSaved(data);
        setDraft(data.remoteApiConcurrency === null ? '' : String(data.remoteApiConcurrency));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load settings.');
      }
    };
    void load();
  }, []);

  const parsed = draft.trim() === '' ? null : Number(draft);
  const limits = saved?.limits;
  const isValid = Boolean(limits) && (parsed === null || Number.isInteger(parsed)) && (parsed === null || (parsed >= (limits?.min ?? 1) && parsed <= (limits?.max ?? 32)));
  const isUnchanged = saved !== null && parsed === saved.remoteApiConcurrency;

  const handleSave = async () => {
    if (!isValid) return;
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/settings/processing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ remoteApiConcurrency: parsed }),
      });
      const data = (await response.json().catch(() => ({}))) as ProcessingSettings;
      if (!response.ok) throw new Error(data.message ?? `Request failed with status ${response.status}`);
      setSaved(data);
      setDraft(data.remoteApiConcurrency === null ? '' : String(data.remoteApiConcurrency));
      setStatusMessage('Saved. It applies to analyses you start from now on.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 hover:bg-accent/10 transition-colors">
      <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">
        Analysis
      </p>

      {statusMessage && (
        <div className="mb-5 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {statusMessage}
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Gauge className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="remote-api-concurrency" className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Parallel API requests
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            How many requests one analysis sends at the same time when it uses a remote API
            (from {limits?.min ?? 1} to {limits?.max ?? 32}; leave empty to use the service default shown under Inference). Analyses
            that run on this machine ignore it and work one request at a time.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              id="remote-api-concurrency"
              type="number"
              inputMode="numeric"
              min={limits?.min ?? 1}
              max={limits?.max ?? 32}
              step={1}
              value={draft}
              placeholder="default"
              disabled={!saved || isSaving || !canEdit}
              onChange={(event) => setDraft(event.target.value)}
              className="w-24 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEdit || isSaving || !isValid || isUnchanged}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {saved && !isValid && (
            <p className="mt-2 text-sm text-destructive">Enter a whole number from {limits?.min} to {limits?.max}.</p>
          )}
          {errorMessage && <p className="mt-2 text-sm text-destructive">{errorMessage}</p>}
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const permissions = usePermissions();
  const [tab, setTab] = useState<'general' | 'users' | 'groups'>('general');
  const canEdit = permissions?.canEditSettings ?? false;
  const [isEditing, setIsEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const resetEditor = () => {
    setIsEditing(false);
    setCurrentPassword('');
    setNewPassword('');
    setShowNewPassword(false);
    setErrorMessage(null);
  };

  const openEditor = () => {
    setIsEditing(true);
    setCurrentPassword('');
    setNewPassword('');
    setShowNewPassword(false);
    setErrorMessage(null);
    setStatusMessage(null);
  };

  const handleSave = async () => {
    if (!currentPassword || !newPassword) return;

    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? `Request failed with status ${response.status}`);
      }

      setStatusMessage(data.message ?? 'Password updated successfully.');
      resetEditor();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update password.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveDisabled = isSaving || !currentPassword || !newPassword;

  return (
    <section className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-foreground mb-1">Settings</h1>
        <p className="text-muted-foreground">
          Manage analysis processing, security and account access.
        </p>
      </div>

      {permissions?.isAdmin && (
        <div className="mb-5 flex gap-2" role="tablist">
          {(['general', 'users', 'groups'] as const).map((id) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${tab === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {id === 'general' ? 'General' : id === 'users' ? 'Users' : 'Groups'}
            </button>
          ))}
        </div>
      )}

      {permissions?.isAdmin && tab !== 'general' && <RightsAdmin key={tab} view={tab} />}

      <div className="space-y-5" hidden={permissions?.isAdmin === true && tab !== 'general'}>
        <InferenceSettingsCard canEdit={canEdit} />

        <ProcessingSettingsCard canEdit={canEdit} />

        <div className="bg-card rounded-xl border border-border p-6 hover:bg-accent/10 transition-colors">
          <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">
            Security
          </p>

          {statusMessage && (
            <div className="mb-5 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
              {statusMessage}
            </div>
          )}

          <div
            className={`flex flex-col gap-4 sm:flex-row sm:justify-between ${
              isEditing ? 'sm:items-start' : 'sm:items-center'
            }`}
          >
            <div className={`flex flex-1 gap-4 ${isEditing ? 'items-start' : 'items-center'}`}>
              <div className="flex h-11 w-11 shrink-0 self-start items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">Password</p>
                {!isEditing && (
                  <p className="mt-2 text-base tracking-[0.28em] text-foreground">{MASKED_PASSWORD}</p>
                )}

                {isEditing && (
                  <div className="mt-2 space-y-2.5">
                    <p className="text-xs text-muted-foreground">
                      Enter your current password and choose a new password.
                    </p>

                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder="Current password"
                      className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                    />

                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="New password"
                        className="w-full rounded-lg border border-border bg-muted px-3 py-2 pr-11 text-sm text-foreground outline-none transition focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((current) => !current)}
                        className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {errorMessage && (
                      <p className="text-sm text-destructive">{errorMessage}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saveDisabled}
                        className="inline-flex items-center justify-center self-start rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={resetEditor}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center self-start rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!isEditing && <ChangeButton onClick={openEditor} />}
          </div>
        </div>
      </div>
    </section>
  );
}
