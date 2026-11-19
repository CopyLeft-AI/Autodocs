-- Allow analyses to be paused and cancelled (issue #1). Idempotent; apply to
-- existing databases that already ran 004_processing_jobs.sql.
ALTER TABLE terminal_session_jobs DROP CONSTRAINT IF EXISTS terminal_session_jobs_status_check;
ALTER TABLE terminal_session_jobs ADD CONSTRAINT terminal_session_jobs_status_check
  CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled'));
