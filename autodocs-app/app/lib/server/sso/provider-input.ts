// Ours
import { checkFieldValue, parseEmailDomains } from '@/app/lib/server/sso/field-validation';
import type { SsoProviderUpdate } from '@/app/lib/server/sso/admin-view';
import type { SsoAccountPolicy, SsoProviderDefinition, SsoProviderSettings, StoredSsoProvider } from '@/app/lib/server/sso/types';

const MAX_CLIENT_ID_LENGTH = 512;
const MAX_CLIENT_SECRET_LENGTH = 2048;

/** A validated administrator update, with the secret decision made explicit. */
export interface ParsedProviderUpdate {
  enabled: boolean;
  clientId: string;
  /** `keep` the stored secret, `clear` it, or `replace` it with a new one. */
  secret: { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };
  settings: SsoProviderSettings;
  policy: SsoAccountPolicy;
}

export type ParseResult = { ok: true; value: ParsedProviderUpdate } | { ok: false; message: string };

function readBoolean(body: Record<string, unknown>, key: string): boolean | string {
  const value = body[key];
  return typeof value === 'boolean' ? value : `${key} must be true or false.`;
}

/**
 * Validate the body of an administrator's save request against the provider definition.
 * Drafts can be saved while disabled; enabling needs a client ID, a client secret and every required field.
 */
export function parseProviderUpdate(definition: SsoProviderDefinition, rawBody: unknown, existing: StoredSsoProvider | null): ParseResult {
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) return { ok: false, message: 'The request body must be a JSON object.' };
  const body = rawBody as Partial<Record<keyof SsoProviderUpdate, unknown>> & Record<string, unknown>;

  const flags: Record<'enabled' | 'trustProviderEmail' | 'allowNewUsers' | 'linkExistingAccounts', boolean> = {
    enabled: false, trustProviderEmail: false, allowNewUsers: false, linkExistingAccounts: false,
  };
  for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
    const value = readBoolean(body, key);
    if (typeof value === 'string') return { ok: false, message: value };
    flags[key] = value;
  }

  if (typeof body.clientId !== 'string') return { ok: false, message: 'clientId must be a string.' };
  const clientId = body.clientId.trim();
  if (clientId.length > MAX_CLIENT_ID_LENGTH) return { ok: false, message: 'The client ID is too long.' };

  let secret: ParsedProviderUpdate['secret'] = { action: 'keep' };
  if (body.clearClientSecret === true) secret = { action: 'clear' };
  if (body.clientSecret !== undefined) {
    if (typeof body.clientSecret !== 'string') return { ok: false, message: 'clientSecret must be a string.' };
    if (body.clientSecret.length > MAX_CLIENT_SECRET_LENGTH) return { ok: false, message: 'The client secret is too long.' };
    if (body.clientSecret !== '') secret = { action: 'replace', value: body.clientSecret };
  }

  const rawSettings = body.settings;
  if (typeof rawSettings !== 'object' || rawSettings === null || Array.isArray(rawSettings)) return { ok: false, message: 'settings must be an object.' };
  const settings: SsoProviderSettings = {};
  for (const field of definition.fields) {
    const raw = (rawSettings as Record<string, unknown>)[field.key];
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, message: `${field.label} must be text.` };
    const text = (raw ?? '').trim();
    if (text === '') continue;
    const checked = checkFieldValue(field.kind, text);
    if (!checked.ok) return { ok: false, message: `${field.label} ${checked.message}.` };
    settings[field.key] = checked.value;
  }

  if (!Array.isArray(body.allowedEmailDomains) || body.allowedEmailDomains.some((entry) => typeof entry !== 'string')) {
    return { ok: false, message: 'allowedEmailDomains must be a list of text values.' };
  }
  const domains = parseEmailDomains((body.allowedEmailDomains as string[]).join(' '));
  if (!domains.ok) return { ok: false, message: domains.message };

  if (flags.enabled) {
    if (clientId === '') return { ok: false, message: 'Enter the client ID before enabling this provider.' };
    const willHaveSecret = secret.action === 'replace' || (secret.action === 'keep' && existing?.clientSecretEncrypted != null);
    if (!willHaveSecret) return { ok: false, message: 'Enter the client secret before enabling this provider.' };
    const missing = definition.fields.find((field) => field.required && settings[field.key] === undefined);
    if (missing) return { ok: false, message: `${missing.label} is required to enable this provider.` };
  }

  return {
    ok: true,
    value: {
      enabled: flags.enabled,
      clientId,
      secret,
      settings,
      policy: {
        trustProviderEmail: flags.trustProviderEmail,
        allowNewUsers: flags.allowNewUsers,
        linkExistingAccounts: flags.linkExistingAccounts,
        allowedEmailDomains: domains.domains,
      },
    },
  };
}
