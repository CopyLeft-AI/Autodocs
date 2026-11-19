# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Parallel model requests when inference uses a remote API: boundary detection sends up to N requests at once (default 8, setting "Parallel API requests" on the Settings page, 1 to 32; `AUTODOCS_REMOTE_API_CONCURRENCY` sets the service default). Local inference stays at one request at a time.
- Event summaries start as soon as an event's end is known, while later boundaries are still being detected. The progress panel shows both stages running, with the event count marked `~` until it is final.
- `ml-service/dev/dummy_inference.py`: a dummy inference server for running and testing the backend without models or API keys.
- Migration `autodocs-app/db/init/006_user_settings.sql` (per-user settings table).
- Pause, resume and cancel buttons for local analyses, with matching `ml-service` endpoints.
- ETA estimate and local processing usage readout on the analysis progress panel.
- Several analyses can run in parallel (`AUTODOCS_MAX_CONCURRENT_JOBS`, default 2); the upload zone no longer blocks while one runs.
- Delete button on session tiles.
- Migration `autodocs-app/db/init/005_job_controls.sql` for the new `paused` and `cancelled` job states.

### Changed
- The "Grouping terminal events" stage is gone; events are grouped while boundaries are found.
- A failed model call now reports its real HTTP error instead of `ResponseNotRead` (llama.cpp streaming path).
- `GET /api/terminal-session-jobs` returns `jobs` (a list) instead of a single `job`.
- Failed or cancelled analyses can be deleted from their own panel.

### Fixed
- The share panel in the session detail view now has a close button.
