# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Pause, resume and cancel buttons for local CPU analyses, with matching `ml-service` endpoints.
- ETA estimate and local CPU/GPU usage readout on the analysis progress panel.
- Several analyses can run in parallel (`AUTODOCS_MAX_CONCURRENT_JOBS`, default 2); the upload zone no longer blocks while one runs.
- Delete button on session tiles.
- Migration `autodocs-app/db/init/005_job_controls.sql` for the new `paused` and `cancelled` job states.

### Changed
- `GET /api/terminal-session-jobs` returns `jobs` (a list) instead of a single `job`.
- Failed or cancelled analyses can be deleted from their own panel.

### Fixed
- The share panel in the session detail view now has a close button.
