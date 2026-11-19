# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- User groups: administrators create groups in a new Settings "Groups" tab, give them rights (administrator, edit settings) and choose their members. Each user, in the "Users" tab, either keeps their own rights or inherits every right their groups have. Apply `autodocs-app/db/init/008_user_groups.sql` to existing databases (existing users keep their own rights).
- User rights: every account is a user or an administrator, and users can be allowed to edit settings. `wolf.arthur@gmail.com` and `julia.longtin@gmail.com` are built-in administrators (hardcoded in `autodocs-app/app/lib/server/permissions.ts`). Administrators get a "Users" tab in Settings to promote users and grant the settings right. Without the right, the Inference and Analysis settings are read-only and their update APIs return 403. Apply `autodocs-app/db/init/007_user_rights.sql` to existing databases.
- Per-step inference configuration: choose the inference source (Ollama, llama.cpp, OpenAI-compatible API, Cloud Temple), model, URL, API key, timeout, token limit and related settings separately for boundary detection and event summaries, in `ml-service/config.json` (see `config.example.json`). Environment variables keep working as defaults.
- Settings page "Inference" section that reads and edits that file through new `GET/PUT /config` on `ml-service` and `GET/PUT /api/settings/inference` in the app. API keys are write-only.
- Generic `openai` backend for any OpenAI-compatible chat API, over http or https.
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
- Model code no longer reads environment variables at import; each job takes a snapshot of the configuration when it starts.
- A user's own "Parallel API requests" is now optional; without it the configured service default applies (it used to always send 8).
- The "Grouping terminal events" stage is gone; events are grouped while boundaries are found.
- A failed model call now reports its real HTTP error instead of `ResponseNotRead` (llama.cpp streaming path).
- `GET /api/terminal-session-jobs` returns `jobs` (a list) instead of a single `job`.
- Failed or cancelled analyses can be deleted from their own panel.

### Fixed
- The share panel in the session detail view now has a close button.
