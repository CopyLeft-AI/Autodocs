"use client";

import { useState } from 'react';
import { IconChevronDown, IconCopy, IconExternalLink } from '@tabler/icons-react';
import { providerIcon } from '@/app/components/sso-provider-icons';
import type { SsoAdminProvider, SsoConnectionTestResult, SsoProviderUpdate } from '@/app/lib/server/sso/admin-view';

const inputClass = 'w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60';
const buttonClass = 'inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60';

/** Everything typed in one provider's form. The secret is empty unless the administrator types a new one. */
interface Draft {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  clearClientSecret: boolean;
  settings: Record<string, string>;
  trustProviderEmail: boolean;
  allowNewUsers: boolean;
  linkExistingAccounts: boolean;
  allowedEmailDomains: string;
}

function toDraft(provider: SsoAdminProvider): Draft {
  return {
    enabled: provider.enabled,
    clientId: provider.clientId,
    clientSecret: '',
    clearClientSecret: false,
    settings: Object.fromEntries(provider.fields.map((field) => [field.key, field.value])),
    trustProviderEmail: provider.trustProviderEmail,
    allowNewUsers: provider.allowNewUsers,
    linkExistingAccounts: provider.linkExistingAccounts,
    allowedEmailDomains: provider.allowedEmailDomains.join(', '),
  };
}

function toUpdate(draft: Draft): SsoProviderUpdate {
  return {
    enabled: draft.enabled,
    clientId: draft.clientId,
    ...(draft.clientSecret !== '' ? { clientSecret: draft.clientSecret } : {}),
    ...(draft.clearClientSecret ? { clearClientSecret: true } : {}),
    settings: draft.settings,
    trustProviderEmail: draft.trustProviderEmail,
    allowNewUsers: draft.allowNewUsers,
    linkExistingAccounts: draft.linkExistingAccounts,
    allowedEmailDomains: draft.allowedEmailDomains.split(/[\s,;]+/).filter((entry) => entry !== ''),
  };
}

async function request(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `Request failed with status ${response.status}`);
  return data;
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
      <span className="text-sm text-foreground">{label}<span className="block text-[11px] text-muted-foreground">{hint}</span></span>
    </label>
  );
}

function StatusBadge({ provider }: { provider: SsoAdminProvider }) {
  const label = provider.isActive ? 'On' : provider.enabled ? 'Incomplete' : provider.clientId !== '' ? 'Off' : 'Not set up';
  const tone = provider.isActive ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground';
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-[0.14em] ${tone}`}>{label}</span>;
}

/** One identity provider: its credentials, options and a connection test. Saved explicitly, because a half-typed secret must never be stored. */
export function SsoProviderCard({ provider, onChange }: { provider: SsoAdminProvider; onChange: (provider: SsoAdminProvider) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(provider));
  const [isBusy, setIsBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SsoConnectionTestResult | null>(null);

  const Icon = providerIcon(provider.id);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(provider));
  const update = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const idFor = (name: string) => `sso-${provider.id}-${name}`;

  const run = async (task: () => Promise<void>) => {
    setIsBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await task();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const adopt = (data: Record<string, unknown>, fallbackMessage: string) => {
    const saved = data.provider as SsoAdminProvider;
    onChange(saved);
    setDraft(toDraft(saved));
    setTestResult(null);
    setConfirmRemove(false);
    setStatusMessage(typeof data.message === 'string' ? data.message : fallbackMessage);
  };

  const save = () => run(async () => adopt(await request(`/api/admin/sso/providers/${provider.id}`, 'PUT', toUpdate(draft)), 'Settings saved.'));
  const remove = () => run(async () => {
    adopt(await request(`/api/admin/sso/providers/${provider.id}`, 'DELETE'), 'Configuration removed.');
  });
  const test = () => run(async () => setTestResult((await request(`/api/admin/sso/providers/${provider.id}/test`, 'POST')) as unknown as SsoConnectionTestResult));
  const copyRedirectUri = () => run(async () => {
    await navigator.clipboard.writeText(provider.redirectUri);
    setStatusMessage('Redirect URL copied.');
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-4 p-4 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={20} stroke={1.75} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-foreground">{provider.label}</span>
          <span className="block truncate text-sm text-muted-foreground">{provider.description}</span>
        </span>
        <StatusBadge provider={provider} />
        <IconChevronDown size={18} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <Field label="Redirect URL" htmlFor={idFor('redirect')} hint={`Register exactly this address as the redirect (callback) URL in ${provider.label}'s console.`}>
            <div className="flex gap-2">
              <input id={idFor('redirect')} readOnly value={provider.redirectUri} className={`${inputClass} font-mono`} onFocus={(event) => event.target.select()} />
              <button type="button" className={buttonClass} onClick={() => void copyRedirectUri()} aria-label="Copy the redirect URL"><IconCopy size={16} aria-hidden /></button>
            </div>
          </Field>
          <a href={provider.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
            Open {provider.label} console <IconExternalLink size={14} aria-hidden />
          </a>

          <fieldset className="space-y-3" disabled={isBusy}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client ID" htmlFor={idFor('clientId')}>
                <input id={idFor('clientId')} className={inputClass} value={draft.clientId} autoComplete="off" onChange={(event) => update({ clientId: event.target.value })} />
              </Field>
              <Field label="Client secret" htmlFor={idFor('clientSecret')} hint={provider.hasClientSecret && !draft.clearClientSecret ? 'A secret is saved. Type a new one to replace it.' : 'Stored encrypted. It is never shown again.'}>
                <input
                  id={idFor('clientSecret')} type="password" className={inputClass} autoComplete="new-password" value={draft.clientSecret}
                  placeholder={provider.hasClientSecret && !draft.clearClientSecret ? '••••••••  (saved)' : ''}
                  onChange={(event) => update({ clientSecret: event.target.value, clearClientSecret: false })}
                />
              </Field>
              {provider.fields.map((field) => (
                <Field key={field.key} label={`${field.label}${field.required ? '' : ' (optional)'}`} htmlFor={idFor(field.key)} hint={field.help}>
                  <input
                    id={idFor(field.key)} className={inputClass} placeholder={field.placeholder} autoComplete="off" value={draft.settings[field.key] ?? ''}
                    onChange={(event) => update({ settings: { ...draft.settings, [field.key]: event.target.value } })}
                  />
                </Field>
              ))}
            </div>
            {provider.hasClientSecret && (
              <Toggle id={idFor('clearSecret')} label="Remove the saved client secret" hint="The provider stops working until a new secret is entered." checked={draft.clearClientSecret} onChange={(value) => update({ clearClientSecret: value, clientSecret: '' })} />
            )}

            <div className="space-y-3 rounded-lg border border-border/70 p-4">
              <p className="text-sm text-foreground">Who can sign in</p>
              <Toggle id={idFor('allowNew')} label="Create accounts for new people" hint="Off: only people who already have an account (or a linked identity) can sign in." checked={draft.allowNewUsers} onChange={(value) => update({ allowNewUsers: value })} />
              <Toggle id={idFor('link')} label="Link to an existing account with the same email" hint="Off: signing in is refused when an account with that email already exists. Passwords are not verified at signup, so leave this on only for providers you trust." checked={draft.linkExistingAccounts} onChange={(value) => update({ linkExistingAccounts: value })} />
              <Toggle id={idFor('trust')} label="Trust the email from this provider" hint="Accept the email even when the provider does not say it is verified. Only for providers where you control who can have which email." checked={draft.trustProviderEmail} onChange={(value) => update({ trustProviderEmail: value })} />
              <Field label="Allowed email domains" htmlFor={idFor('domains')} hint="Separate with commas. Empty: any domain.">
                <input id={idFor('domains')} className={inputClass} placeholder="example.com, example.org" value={draft.allowedEmailDomains} onChange={(event) => update({ allowedEmailDomains: event.target.value })} />
              </Field>
            </div>

            <Toggle id={idFor('enabled')} label={`Offer “Sign in with ${provider.label}” on the login page`} hint="Needs the client ID, the client secret and the required fields above." checked={draft.enabled} onChange={(value) => update({ enabled: value })} />
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={() => void save()} disabled={isBusy || !isDirty}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? 'Working...' : 'Save'}
            </button>
            <button type="button" className={buttonClass} disabled={isBusy || isDirty} onClick={() => void test()} title={isDirty ? 'Save first: the test checks the saved settings.' : undefined}>Test connection</button>
            {(provider.clientId !== '' || provider.hasClientSecret) && (confirmRemove ? (
              <>
                <button type="button" className={`${buttonClass} border-destructive text-destructive`} disabled={isBusy} onClick={() => void remove()}>Confirm removal</button>
                <button type="button" className={buttonClass} disabled={isBusy} onClick={() => setConfirmRemove(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className={buttonClass} disabled={isBusy} onClick={() => setConfirmRemove(true)}>Remove configuration</button>
            ))}
          </div>

          {testResult && <p className={`text-sm ${testResult.ok ? 'text-primary' : 'text-destructive'}`}>{testResult.message}</p>}
          {statusMessage && <p className="text-sm text-primary">{statusMessage}</p>}
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </div>
      )}
    </div>
  );
}
