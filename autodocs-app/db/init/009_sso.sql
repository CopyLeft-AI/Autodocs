-- Single sign-on (SSO). Idempotent; apply to existing databases.
--
-- sso_providers: one row per identity provider, edited by administrators in
--   Settings > Single sign-on. The client secret is stored encrypted
--   (AES-256-GCM, see app/lib/server/sso/secret-box.ts), never in clear text.
-- oauth_accounts: links a local user to an identity at a provider.
-- users.password_hash becomes nullable: accounts created through SSO have no password.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS sso_providers (
  provider_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  client_id TEXT NOT NULL DEFAULT '',
  client_secret_encrypted TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  trust_provider_email BOOLEAN NOT NULL DEFAULT FALSE,
  allow_new_users BOOLEAN NOT NULL DEFAULT TRUE,
  link_existing_accounts BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_email_domains TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS oauth_accounts_user_id_idx ON oauth_accounts (user_id);
