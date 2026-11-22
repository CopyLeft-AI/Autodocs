"use client";

import { useEffect, useState } from 'react';
import { IconLogin } from '@tabler/icons-react';
import { SsoProviderCard } from '@/app/components/SsoProviderCard';
import type { SsoAdminOverview, SsoAdminProvider } from '@/app/lib/server/sso/admin-view';

/** Administrators choose which identity providers can sign people in, and enter their credentials. */
export function SsoProvidersAdmin() {
  const [overview, setOverview] = useState<SsoAdminOverview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/admin/sso/providers', { credentials: 'include', cache: 'no-store' });
        const data = (await response.json().catch(() => ({}))) as SsoAdminOverview & { message?: string };
        if (!response.ok) throw new Error(data.message ?? `Request failed with status ${response.status}`);
        setOverview(data);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load the single sign-on settings.');
      }
    };
    void load();
  }, []);

  const replaceProvider = (saved: SsoAdminProvider) =>
    setOverview((current) => (current ? { ...current, providers: current.providers.map((entry) => (entry.id === saved.id ? saved : entry)) } : current));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">Single sign-on</p>
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><IconLogin size={22} aria-hidden /></div>
          <div className="min-w-0 flex-1 space-y-2 text-sm text-muted-foreground">
            <p>Let people sign in with an account they already have. Create an OAuth client in the provider&apos;s console, register the redirect URL shown in its card, then enter the client ID and secret here.</p>
            {overview && (
              <p>
                Redirect URLs start with <span className="font-mono text-foreground">{overview.baseUrl}</span>.
                {!overview.baseUrlConfigured && ' This address is guessed from the request: set APP_BASE_URL on the server to the public address of the site so it stays correct behind a proxy.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      {!overview && !errorMessage && <p className="text-sm text-muted-foreground">Loading...</p>}
      {overview?.providers.map((provider) => (
        <SsoProviderCard key={provider.id} provider={provider} onChange={replaceProvider} />
      ))}
    </div>
  );
}
