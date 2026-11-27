-- Optional: copy group memberships from an LDAP directory. Safe to run twice.
CREATE TABLE IF NOT EXISTS ldap_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  bind_password_encrypted TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 'ldap' groups have their members managed by the directory.
ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE user_groups DROP CONSTRAINT IF EXISTS user_groups_source_check;
ALTER TABLE user_groups ADD CONSTRAINT user_groups_source_check CHECK (source IN ('local', 'ldap'));
