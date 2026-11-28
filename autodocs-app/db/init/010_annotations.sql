-- Annotations as records, with provenance and history. Idempotent; apply to existing databases.
ALTER TABLE terminal_sessions ADD COLUMN IF NOT EXISTS recording TEXT;
ALTER TABLE terminal_sessions ADD COLUMN IF NOT EXISTS legacy_imported BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE terminal_session_access ADD COLUMN IF NOT EXISTS can_annotate BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE terminal_session_jobs ADD COLUMN IF NOT EXISTS target_session_id UUID REFERENCES terminal_sessions(id) ON DELETE CASCADE;
ALTER TABLE terminal_session_jobs ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS annotation_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_session_id UUID NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS annotation_layers_session_idx ON annotation_layers(terminal_session_id, position);

-- origin says who first wrote the annotation; edited_by_* records the last human change.
CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_session_id UUID NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES annotation_layers(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  depth INTEGER,
  origin TEXT NOT NULL CHECK (origin IN ('ai', 'human', 'imported')),
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  ai_backend TEXT,
  ai_model TEXT,
  boundary_backend TEXT,
  boundary_model TEXT,
  edited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  edited_by_name TEXT,
  edited_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_ms >= start_ms)
);
CREATE INDEX IF NOT EXISTS annotations_session_idx ON annotations(terminal_session_id, start_ms);

-- Append-only: annotation_id has no foreign key so the history of deleted rows survives.
CREATE TABLE IF NOT EXISTS annotation_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  terminal_session_id UUID NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  annotation_id UUID,
  action TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS annotation_revisions_session_idx ON annotation_revisions(terminal_session_id, id DESC);
