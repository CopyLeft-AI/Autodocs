-- User rights (issue #5 follow-up). Idempotent; apply to existing databases.
-- role: 'admin' can do everything and manage other users' rights.
-- can_edit_settings: lets a non-admin change the analysis settings.
-- The hardcoded admin emails in app/lib/server/permissions.ts are admins
-- regardless of these columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_settings BOOLEAN NOT NULL DEFAULT FALSE;
