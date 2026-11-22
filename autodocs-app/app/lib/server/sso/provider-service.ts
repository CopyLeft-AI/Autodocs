// Ours
import { redirectUriFor } from '@/app/lib/server/sso/base-url';
import { getProviderDefinition, listProviderDefinitions, providerDisplayLabel } from '@/app/lib/server/sso/provider-definitions';
import { deleteStoredProvider, getStoredProvider, listStoredProviders, saveStoredProvider } from '@/app/lib/server/sso/provider-store';
import type { ParsedProviderUpdate } from '@/app/lib/server/sso/provider-input';
import { decryptSecret, encryptSecret } from '@/app/lib/server/sso/secret-box';
import type { SsoAdminOverview, SsoAdminProvider } from '@/app/lib/server/sso/admin-view';
import type { RuntimeSsoProvider, SsoProviderDefinition, SsoProviderId, StoredSsoProvider } from '@/app/lib/server/sso/types';

/** Whether a stored provider has everything a sign-in needs: client ID, a readable secret and each required field. */
function isComplete(definition: SsoProviderDefinition, stored: StoredSsoProvider): boolean {
  if (stored.clientId === '' || stored.clientSecretEncrypted === null) return false;
  if (decryptSecret(stored.clientSecretEncrypted, stored.providerId) === null) return false;
  return definition.fields.every((field) => !field.required || (stored.settings[field.key] ?? '') !== '');
}

/**
 * A provider ready for a sign-in, with its secret decrypted; null when it is not configured, incomplete, or
 * (unless `requireEnabled` is false, as when an administrator tests a draft) disabled.
 */
export async function loadRuntimeProvider(id: SsoProviderId, options: { requireEnabled: boolean } = { requireEnabled: true }): Promise<RuntimeSsoProvider | null> {
  const stored = await getStoredProvider(id);
  if (!stored || (options.requireEnabled && !stored.enabled)) return null;
  const definition = getProviderDefinition(id);
  if (!isComplete(definition, stored) || stored.clientSecretEncrypted === null) return null;
  const clientSecret = decryptSecret(stored.clientSecretEncrypted, id);
  if (clientSecret === null) return null;
  return {
    definition,
    clientId: stored.clientId,
    clientSecret,
    settings: stored.settings,
    policy: {
      trustProviderEmail: stored.trustProviderEmail,
      allowNewUsers: stored.allowNewUsers,
      linkExistingAccounts: stored.linkExistingAccounts,
      allowedEmailDomains: stored.allowedEmailDomains,
    },
  };
}

/** The providers the login page offers: enabled and complete. Only ids and labels leave the server. */
export async function listLoginProviders(): Promise<Array<{ id: SsoProviderId; label: string }>> {
  const stored = await listStoredProviders();
  const active: Array<{ id: SsoProviderId; label: string }> = [];
  for (const definition of listProviderDefinitions()) {
    const row = stored.find((entry) => entry.providerId === definition.id);
    if (row && row.enabled && isComplete(definition, row)) active.push({ id: definition.id, label: providerDisplayLabel(definition, row.settings) });
  }
  return active;
}

/** Every known provider with its saved configuration (never the secret) for the administrator's page. */
export async function buildAdminOverview(baseUrl: { url: string; configured: boolean }): Promise<SsoAdminOverview> {
  const stored = await listStoredProviders();
  const providers: SsoAdminProvider[] = listProviderDefinitions().map((definition) => {
    const row = stored.find((entry) => entry.providerId === definition.id);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      protocol: definition.protocol,
      consoleUrl: definition.consoleUrl,
      fields: definition.fields.map((field) => ({
        key: field.key, label: field.label, placeholder: field.placeholder, help: field.help, required: field.required,
        value: row?.settings[field.key] ?? '',
      })),
      enabled: row?.enabled ?? false,
      clientId: row?.clientId ?? '',
      hasClientSecret: row?.clientSecretEncrypted != null,
      redirectUri: redirectUriFor(baseUrl.url, definition.id),
      isActive: row !== undefined && row.enabled && isComplete(definition, row),
      trustProviderEmail: row?.trustProviderEmail ?? false,
      allowNewUsers: row?.allowNewUsers ?? true,
      linkExistingAccounts: row?.linkExistingAccounts ?? true,
      allowedEmailDomains: row?.allowedEmailDomains ?? [],
      updatedAt: row?.updatedAt ?? null,
    };
  });
  return { baseUrl: baseUrl.url, baseUrlConfigured: baseUrl.configured, providers };
}

/** Persist a validated update; the secret is encrypted before it reaches the database. */
export async function saveProviderUpdate(id: SsoProviderId, update: ParsedProviderUpdate, actorUserId: string): Promise<void> {
  const existing = await getStoredProvider(id);
  let clientSecretEncrypted = existing?.clientSecretEncrypted ?? null;
  if (update.secret.action === 'clear') clientSecretEncrypted = null;
  if (update.secret.action === 'replace') clientSecretEncrypted = encryptSecret(update.secret.value, id);
  await saveStoredProvider(
    { providerId: id, enabled: update.enabled, clientId: update.clientId, clientSecretEncrypted, settings: update.settings, ...update.policy },
    actorUserId,
  );
}

/** Remove a provider's configuration entirely. */
export async function removeProvider(id: SsoProviderId): Promise<void> {
  await deleteStoredProvider(id);
}

/** The stored row of a provider, for validation that depends on what is already saved. */
export async function readStoredProvider(id: SsoProviderId): Promise<StoredSsoProvider | null> {
  return getStoredProvider(id);
}
