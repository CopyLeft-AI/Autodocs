"use client";

import { useEffect, useState } from 'react';
import { providerIcon } from '@/app/components/sso-provider-icons';

interface LoginProvider {
  id: string;
  label: string;
}

/** What the person sees for each refusal code the server puts in `?sso_error=`. */
const ERROR_MESSAGES: Record<string, string> = {
  provider_disabled: 'This sign-in method is not available.',
  provider_unreachable: 'The sign-in provider could not be reached. Try again later.',
  invalid_state: 'The sign-in attempt expired or was not started from this browser. Please try again.',
  access_denied: 'The sign-in was cancelled.',
  exchange_failed: 'The provider did not confirm your identity. Please try again.',
  email_missing: 'The provider did not share an email address, which this site needs.',
  email_unverified: 'The provider has not verified your email address. Verify it there and try again.',
  domain_not_allowed: 'Accounts with this email domain may not sign in here.',
  signups_disabled: 'No account exists for this email, and new accounts cannot be created with this provider.',
  linking_disabled: 'An account with this email already exists. Sign in with your password instead.',
  unexpected: 'Sign-in failed. Please try again.',
};

/** Buttons that start a single sign-on login for every provider an administrator enabled, plus the reason of a refused attempt. */
export function SsoButtons({ action }: { action: 'Sign in' | 'Sign up' }) {
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setErrorCode(new URLSearchParams(window.location.search).get('sso_error'));
      try {
        const response = await fetch('/api/auth/sso/providers', { cache: 'no-store' });
        if (response.ok) setProviders(((await response.json()) as { providers: LoginProvider[] }).providers);
      } catch {
        setProviders([]);
      }
    };
    void load();
  }, []);

  if (providers.length === 0 && errorCode === null) return null;

  return (
    <div className="mt-5">
      {errorCode !== null && (
        <div
          role="alert"
          className="font-mono text-xs px-3 py-2 rounded-md mb-4"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          ✗ {ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.unexpected}
        </div>
      )}
      {providers.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-4 text-muted-foreground font-mono text-xs">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex flex-col gap-2">
            {providers.map((provider) => {
              const ProviderIcon = providerIcon(provider.id);
              return (
                <a
                  key={provider.id}
                  href={`/api/auth/sso/${provider.id}/start`}
                  className="flex items-center justify-center gap-2.5 rounded-lg border border-border px-4 py-2.5 font-mono text-[13px] text-foreground transition-colors hover:bg-muted"
                >
                  <ProviderIcon size={18} stroke={1.75} aria-hidden />
                  {action} with {provider.label}
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
