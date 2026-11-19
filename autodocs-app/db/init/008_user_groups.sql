-- User groups (issue #5 follow-up). Idempotent; apply to existing databases.
-- A group carries rights; a user either keeps their own rights (rights_mode 'own')
-- or inherits the union of the rights of every group they belong to ('groups').
CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_settings BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_groups_name_lower_idx ON user_groups (lower(name));

CREATE TABLE IF NOT EXISTS user_group_members (
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS rights_mode TEXT NOT NULL DEFAULT 'own';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rights_mode_check;
ALTER TABLE users ADD CONSTRAINT users_rights_mode_check CHECK (rights_mode IN ('own', 'groups'));
