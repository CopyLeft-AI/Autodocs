-- Per-user processing settings (issue #3). Idempotent; apply to existing databases.
-- remote_api_concurrency: model requests one analysis may run in parallel when
-- inference uses a remote API. Ignored for local inference.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  remote_api_concurrency INTEGER NOT NULL DEFAULT 8
    CHECK (remote_api_concurrency BETWEEN 1 AND 32),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
