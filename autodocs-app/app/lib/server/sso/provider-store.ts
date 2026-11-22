// Ours
import { db } from '@/app/lib/server/db';
import { isSsoProviderId, type SsoProviderId, type SsoProviderSettings, type StoredSsoProvider } from '@/app/lib/server/sso/types';

interface ProviderRow {
  provider_id: string;
  enabled: boolean;
  client_id: string;
  client_secret_encrypted: string | null;
  settings: SsoProviderSettings;
  trust_provider_email: boolean;
  allow_new_users: boolean;
  link_existing_accounts: boolean;
  allowed_email_domains: string[];
  updated_at: string;
}

const COLUMNS = `provider_id, enabled, client_id, client_secret_encrypted, settings, trust_provider_email,
  allow_new_users, link_existing_accounts, allowed_email_domains, updated_at`;

function toStored(row: ProviderRow): StoredSsoProvider | null {
  if (!isSsoProviderId(row.provider_id)) return null;
  return {
    providerId: row.provider_id,
    enabled: row.enabled,
    clientId: row.client_id,
    clientSecretEncrypted: row.client_secret_encrypted,
    settings: row.settings,
    trustProviderEmail: row.trust_provider_email,
    allowNewUsers: row.allow_new_users,
    linkExistingAccounts: row.link_existing_accounts,
    allowedEmailDomains: row.allowed_email_domains,
    updatedAt: row.updated_at,
  };
}

/** Every stored provider row; rows of providers this version no longer knows are skipped. */
export async function listStoredProviders(): Promise<StoredSsoProvider[]> {
  const result = await db.query<ProviderRow>(`SELECT ${COLUMNS} FROM sso_providers`);
  return result.rows.map(toStored).filter((row): row is StoredSsoProvider => row !== null);
}

/** One stored provider, or null when an administrator never saved it. */
export async function getStoredProvider(id: SsoProviderId): Promise<StoredSsoProvider | null> {
  const result = await db.query<ProviderRow>(`SELECT ${COLUMNS} FROM sso_providers WHERE provider_id = $1`, [id]);
  return result.rows[0] ? toStored(result.rows[0]) : null;
}

/** Insert or replace a provider row. */
export async function saveStoredProvider(provider: Omit<StoredSsoProvider, 'updatedAt'>, actorUserId: string): Promise<void> {
  await db.query(
    `INSERT INTO sso_providers (provider_id, enabled, client_id, client_secret_encrypted, settings, trust_provider_email,
                                allow_new_users, link_existing_accounts, allowed_email_domains, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, NOW(), $10)
     ON CONFLICT (provider_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, client_id = EXCLUDED.client_id, client_secret_encrypted = EXCLUDED.client_secret_encrypted,
       settings = EXCLUDED.settings, trust_provider_email = EXCLUDED.trust_provider_email,
       allow_new_users = EXCLUDED.allow_new_users, link_existing_accounts = EXCLUDED.link_existing_accounts,
       allowed_email_domains = EXCLUDED.allowed_email_domains, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [
      provider.providerId, provider.enabled, provider.clientId, provider.clientSecretEncrypted, JSON.stringify(provider.settings),
      provider.trustProviderEmail, provider.allowNewUsers, provider.linkExistingAccounts, provider.allowedEmailDomains, actorUserId,
    ],
  );
}

/** Forget a provider's configuration. Accounts already linked to it stay linked. */
export async function deleteStoredProvider(id: SsoProviderId): Promise<void> {
  await db.query('DELETE FROM sso_providers WHERE provider_id = $1', [id]);
}
