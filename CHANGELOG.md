# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Sliding windows over earlier answers: boundary detection (Model 0) sees its previous new/old verdicts, and annotation (Model 1) sees the id, depth and summary of earlier events. Both windows are sized from the context buffer (`AUTODOCS_CONTEXT_TOKENS`); Model 0's is `AUTODOCS_BOUNDARY_HISTORY` (auto: on for Cloud Temple, off for the fine-tuned local model) and makes boundary requests sequential while on.
- Single sign-on: administrators enable and configure Google, Microsoft, GitHub, GitLab, Okta, Auth0, Keycloak, Amazon Cognito, LinkedIn, Discord and custom OpenID Connect providers (client ID, write-only encrypted client secret, provider fields, account policy) in a new administrator-only Settings "Single sign-on" tab. Enabled providers get buttons on the login and signup pages. See `autodocs-app/README.md`, "Single sign-on". Apply `autodocs-app/db/init/009_sso.sql` to existing databases; new optional variables `APP_BASE_URL`, `SSO_SECRET_KEY`, `SSO_ALLOW_INSECURE_HTTP`.
- `npm test` (Bun) with unit tests for the single sign-on code, and the `jose` dependency.
- Interactive API documentation (Swagger UI): `/api/docs` for the web app's API (a hand-written OpenAPI description served at `/api/openapi.json`, kept in step with the routes by a test) and `/ml-service/docs` for the analysis service, which the app proxies under `/ml-service/*` for administrators only. The ML service's endpoints now have tags and summaries. Closes issue #9.
- User groups: administrators create groups in a new Settings "Groups" tab, give them rights (administrator, edit settings) and choose their members. Each user, in the "Users" tab, either keeps their own rights or inherits every right their groups have. Apply `autodocs-app/db/init/008_user_groups.sql` to existing databases (existing users keep their own rights).
- User rights: every account is a user or an administrator, and users can be allowed to edit settings. `wolf.arthur@gmail.com` and `julia.longtin@gmail.com` are built-in administrators (hardcoded in `autodocs-app/app/lib/server/permissions.ts`). Administrators get a "Users" tab in Settings to promote users and grant the settings right. Without the right, the Inference and Analysis settings are read-only and their update APIs return 403. Apply `autodocs-app/db/init/007_user_rights.sql` to existing databases.
- Per-step inference configuration: choose the inference source (Ollama, llama.cpp, OpenAI-compatible API, Cloud Temple), model, URL, API key, timeout, token limit and related settings separately for boundary detection and event summaries, in `ml-service/config.json` (see `config.example.json`). Environment variables keep working as defaults.
- Settings page "Inference" section that reads and edits that file through new `GET/PUT /config` on `ml-service` and `GET/PUT /api/settings/inference` in the app. API keys are write-only.
- Generic `openai` backend for any OpenAI-compatible chat API, over http or https.
- Parallel model requests when inference uses a remote API: boundary detection sends up to N requests at once (default 8, setting "Parallel API requests" on the Settings page, 1 to 32; `AUTODOCS_REMOTE_API_CONCURRENCY` sets the service default). Local inference stays at one request at a time, across boundary detection and summaries. The first failed request cancels the job's other requests immediately.
- Event summaries start as soon as an event's end is known, while later boundaries are still being detected. The progress panel shows both stages running, with the event count marked `~` until it is final.
- `ml-service/dev/dummy_inference.py`: a dummy inference server for running and testing the backend without models or API keys.
- Migration `autodocs-app/db/init/006_user_settings.sql` (per-user settings table).
- Pause, resume and cancel buttons for local analyses, with matching `ml-service` endpoints.
- ETA estimate and local processing usage readout on the analysis progress panel.
- Several analyses can run in parallel (`AUTODOCS_MAX_CONCURRENT_JOBS`, default 2); the upload zone no longer blocks while one runs.
- Delete button on session tiles.
- Migration `autodocs-app/db/init/005_job_controls.sql` for the new `paused` and `cancelled` job states.

### Changed
- Accounts may now have no password (people created by single sign-on). Password login, password change and email change refuse them with a clear message.
- Model code no longer reads environment variables at import; each job takes a snapshot of the configuration when it starts.
- A user's own "Parallel API requests" is now optional; without it the configured service default applies (it used to always send 8).
- The "Grouping terminal events" stage is gone; events are grouped while boundaries are found.
- A failed model call now reports its real HTTP error instead of `ResponseNotRead` (llama.cpp streaming path).
- `GET /api/terminal-session-jobs` returns `jobs` (a list) instead of a single `job`.
- Failed or cancelled analyses can be deleted from their own panel.

### Fixed
- Annotation prompts never contained the earlier events' summaries (they were computed but not inserted); they now do, in the `neighbor_tail` format the few-shot examples already show.
- The share panel in the session detail view now has a close button.
