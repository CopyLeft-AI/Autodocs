# AutoDocs App

Next.js frontend and API server for AutoDocs. The app uses Postgres for users, auth sessions, and terminal sessions, and calls the AI service to transform uploaded terminal recordings into the summarized event format the UI displays.

## Environment

Required values in `autodocs-app/.env.local`:

```env
DATABASE_URL="postgresql://autodocs:autodocs@localhost:5432/autodocs"
JWT_SECRET="paste-generated-value-here"
ML_URL="https://your-ml-service-url/"
# Optional: enables the durable local-CPU upload job protocol.
AUTODOCS_PROCESSING_MODE="local-cpu-jobs"
```

- `DATABASE_URL`: Postgres connection string for the app database.
- `JWT_SECRET`: secret used to sign auth/session JWTs.
- `APP_BASE_URL` (optional): public address of the site, such as `https://docs.example.com`. Single sign-on redirect URLs are built from it; without it they are guessed from the request headers, which is wrong behind some proxies.
- `SSO_SECRET_KEY` (optional): key that encrypts the single sign-on client secrets stored in the database. Defaults to `JWT_SECRET`; changing either one makes the saved client secrets unreadable (enter them again).
- `SSO_ALLOW_INSECURE_HTTP` (optional, development only): set to `true` to accept `http://` identity providers such as a local Keycloak.
- `ML_URL`: URL for the AI service called by `POST /api/terminal-sessions`.
- `AUTODOCS_PROCESSING_MODE`: omit this variable for the existing synchronous
  Colab/ngrok-compatible upload path. Set it to `local-cpu-jobs` only when
  `ML_URL` points at this repository's `ml-service`, which implements `/jobs`.

Generate a strong local secret with:

```bash
openssl rand -base64 64
```

## Local Postgres Setup

The project includes a Docker Postgres service and init SQL scripts at `db/init/001_init.sql`, `db/init/002_sessions.sql`, and `db/init/003_terminal_sessions.sql`.

On first startup of a fresh DB volume, Postgres creates:

- `users`
- `sessions`
- `terminal_sessions`
- `terminal_session_access`

It also seeds two users:

- `hello@example.com`
- `jane@example.com`

Both seeded users use password `12345678`.

Start Postgres:

```bash
npm run db:up
```

If you already started Postgres before adding or changing init SQL, reset the volume once:

```bash
npm run db:reset
```

Then verify the schema:

```bash
docker exec -it autodocs-postgres psql -U autodocs -d autodocs -c "\d users"
docker exec -it autodocs-postgres psql -U autodocs -d autodocs -c "\d sessions"
docker exec -it autodocs-postgres psql -U autodocs -d autodocs -c "\d terminal_sessions"
docker exec -it autodocs-postgres psql -U autodocs -d autodocs -c "\d terminal_session_access"
```

## Annotating recordings

Uploading stores the `.cast` file (asciicast v1, v2 or v3, 50 MB at most) and
asks how to annotate it: by hand in the editor, or with a model whose name and
settings you choose. People without the settings right can pick the configured
models and those listed under "Other models users may pick". Each model run adds
a timeline; nothing is overwritten.

The editor is at `/sessions/<id>`. Mark A and B, press C and type. F shows only
what the selected range wrote to the terminal. Every annotation keeps its origin
(person, model or imported file) and last editor, and the History tab lists all
changes. The owner can share a session read-only or allow annotating.

| API | Purpose |
| --- | --- |
| `GET/DELETE /api/terminal-sessions/<id>` | Session with timelines and annotations; delete |
| `GET .../recording[?annotations=1]` | Download the file, optionally with annotations in its header |
| `POST .../analysis`, `GET /api/analysis-options` | Run a model; list the choices |
| `.../annotations`, `.../layers`, `.../history` | Edit annotations and timelines; read changes |

Existing databases need `db/init/010_annotations.sql`. Sessions created before it
have no stored file: their replay is rebuilt from the stored events, without
colours. Sessions with no stored events cannot be replayed.

Where things live: `app/lib/cast` reads recordings, `app/lib/terminal` replays
and colours them, `app/lib/editor` and `app/components/editor` are the editor,
`app/lib/annotations` holds shared types and file formats, and
`app/lib/server/recordings` owns storage, permissions and analyses.

## LDAP groups (optional)

Administrators can copy group memberships from an LDAP directory (Settings,
"LDAP"). A person is found by email; their groups are refreshed at each sign-in
and by "Synchronise everyone now". Directory groups are created without rights,
and a directory group whose name matches a local group is ignored, so grant
rights in the Groups tab. Rights apply only to users set to take rights from
groups. Because signup does not verify email addresses, switch a user to group
rights only once their account is known to be theirs. Use `ldaps://` or StartTLS.
The bind password is stored encrypted with the same key as single sign-on
secrets. Existing databases need `db/init/011_ldap.sql`.

## User rights

Each user is either a user or an administrator, and users have a separate
"can edit settings" right (new accounts: off). Administrators can do everything.
`wolf.arthur@gmail.com` and `julia.longtin@gmail.com` are always administrators
(list in `app/lib/server/permissions.ts`, compared case-insensitively). Other
rights are stored in `users.role` and `users.can_edit_settings` and managed by
administrators in Settings, "Users" tab (`GET /api/admin/users`,
`PATCH /api/admin/users/<id>`).

Groups (Settings, "Groups" tab; `GET/POST /api/admin/groups`,
`PATCH/DELETE /api/admin/groups/<id>`) carry the same two rights. Each user has a
"rights from" choice: `own` (the user's own role and settings right, the default)
or `groups` (every right at least one of their groups has; their own columns are
ignored). Deleting a group removes its rights from its members. Built-in
administrators are not affected by groups. Editing the inference settings or your own
parallel-request limit needs the settings right; everyone signed in can read
them. Existing databases need `db/init/007_user_rights.sql` and `008_user_groups.sql`.

Signup does not verify email addresses, so register the built-in administrator
accounts before exposing the app, or anyone can claim those addresses.

## Single sign-on

Administrators choose how people can sign in, in Settings, "Single sign-on" tab
(`GET /api/admin/sso/providers`, `PUT/DELETE /api/admin/sso/providers/<id>`,
`POST /api/admin/sso/providers/<id>/test`). The tab and these APIs need the
administrator right. Supported providers: Google, Microsoft (Entra ID), GitHub
(including GitHub Enterprise Server), GitLab (including self-hosted), Okta, Auth0,
Keycloak, Amazon Cognito, LinkedIn, Discord, and any OpenID Connect provider
("Custom OpenID Connect").

For each provider, create an OAuth client in its console, register the redirect URL
shown in the provider's card (`<site address>/api/auth/sso/<id>/callback`), then
enter the client ID, client secret and the provider-specific fields (for example the
Okta domain). A provider appears on the login and signup pages once it is enabled.
Client secrets are stored encrypted, are write-only, and are never returned by any API.
"Test connection" checks that the provider's discovery document can be reached.

Per provider, administrators also choose whether new accounts may be created, whether
a sign-in may link to an existing account with the same email, whether to trust an
email the provider does not mark as verified, and an allowed email-domain list. Only
verified emails are accepted by default. People who sign up through single sign-on
have no password: those accounts sign in through their provider, and the password and
email change APIs refuse them.

Existing databases need `db/init/009_sso.sql`. Notes:

- OpenID Connect providers use the authorization-code flow with PKCE, `state` and
  `nonce`, and ID tokens are verified against the provider's published keys.
  Microsoft only marks emails as verified when the optional claims `email` and
  `xms_edov` are enabled on the app registration.
- The server contacts the discovery addresses administrators enter. Only administrators
  can set them, and they must be `https://` unless `SSO_ALLOW_INSECURE_HTTP=true`.
- SAML and Sign in with Apple are not included.

## Local CPU inference option

The original `ML_URL` behavior remains the default: running a model calls the
legacy `POST /` ML endpoint and waits for its response. This is compatible with the
hosted Colab/ngrok pipeline.

To opt into local CPU inference with durable, observable uploads:

1. Install and start [`../ml-service`](../ml-service/README.md) on the same
   host or a private network endpoint. It requires Ollama with a Model 0 GGUF
   registered as `model0` and `gpt-oss:20b` (both names are configurable).
2. Apply `db/init/004_processing_jobs.sql` and then `db/init/005_job_controls.sql` and `db/init/006_user_settings.sql`
   (adds the `paused` and `cancelled` job states) to an existing Postgres
   database. On a new Docker volume they are applied automatically with the
   other init scripts; do not reset an existing volume merely to apply these
   migrations.
3. Set the web app environment values:

   ```env
   ML_URL="http://127.0.0.1:8500"
   AUTODOCS_PROCESSING_MODE="local-cpu-jobs"
   ```

4. Start the web app normally. Model runs return immediately with a persisted
   job ID, and the UI shows parsing, boundary detection, event grouping,
   annotation, and finalization progress with a timestamped event log.

Each upload becomes its own job, so you can start several analyses without
waiting for the current one. The ML service runs up to
`AUTODOCS_MAX_CONCURRENT_JOBS` jobs at once (default 2) and queues the rest.
Every job panel offers:

- **Pause / Resume**: the job stops after the model call in progress and keeps
  its place. Time spent paused is not counted in the ETA.
- **Cancel**: interrupts the job immediately. A cancelled or failed job can then
  be deleted, which also removes its uploaded recording.
- **ETA**: shown once at least 5% of the work and 30 seconds of running time
  give enough data for a linear estimate.
- **Local resource usage**: machine-wide CPU load (percent and busy cores) and,
  when `nvidia-smi` is available, GPU load. Hidden when inference uses a remote
  API such as Cloud Temple.

Reloading the page resumes the display of every unfinished job. If the ML
service restarts while a job is running or paused, that job is marked failed
explicitly rather than reported as still running.

## Running Locally

From the `autodocs-app` folder:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API Overview

### Interactive documentation (Swagger)

Wherever the app is deployed, two pages document and let you try the APIs:

| Page | Documents | Who can open it |
| --- | --- | --- |
| `/api/docs` | This app's own HTTP API | anyone (it describes the API, it exposes no data); "Try it out" uses your signed-in session |
| `/ml-service/docs` | The analysis (ML) service | administrators only |

The ML service has no login of its own, so the app proxies it: `/ml-service/openapi.json` and every other
`/ml-service/*` path forward to `ML_URL` (read at runtime) and require the administrator right. The page's
"Try it out" calls go through this proxy, so `ML_URL` can stay a private address.

The app's description is written by hand in `app/lib/server/openapi/` (one module per area) and served at
`/api/openapi.json`. `bun test` fails when a route file under `app/api/` and that description disagree, so
when you add or change a route, update the description in the same change. The ML service's description is
generated by FastAPI (`<ML_URL>/openapi.json`; its own `/docs` works too when you reach it directly).

Authentication is cookie-based. Routes that require auth expect the existing session cookies set by `POST /api/auth/signup` or `POST /api/auth/login`.

### Auth APIs

#### `POST /api/auth/signup`

Creates a user and immediately signs them in.

Request body:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "12345678"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `POST /api/auth/login`

Signs in an existing user and sets auth cookies.

Request body:

```json
{
  "email": "jane@example.com",
  "password": "12345678"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `GET /api/auth/me`

Returns the authenticated user. If the access token is expired but the refresh token is still valid, the session is rotated and fresh cookies are issued.

Success response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `POST /api/auth/logout`

Revokes the refresh session when present and clears auth cookies.

Response:

```json
{
  "ok": true
}
```

#### `PATCH /api/auth/name`

Updates the authenticated user's display name.

Request body:

```json
{
  "name": "Jane Smith"
}
```

Response:

```json
{
  "message": "Name updated successfully.",
  "user": {
    "id": "uuid",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `PATCH /api/auth/email`

Updates the authenticated user's email address. Requires the current password.

Request body:

```json
{
  "email": "new-email@example.com",
  "currentPassword": "12345678"
}
```

Response:

```json
{
  "message": "Email updated successfully.",
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "new-email@example.com",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `PATCH /api/auth/password`

Updates the authenticated user's password.

Request body:

```json
{
  "currentPassword": "12345678",
  "newPassword": "new-password-123"
}
```

Response:

```json
{
  "message": "Password updated successfully."
}
```

### Terminal Session APIs

All terminal session routes require authentication.

#### `GET /api/terminal-sessions`

Returns terminal sessions owned by the authenticated user.

Response:

```json
{
  "terminalSessions": [
    {
      "id": "uuid",
      "title": "Model 1 Example",
      "durationSeconds": 932,
      "content": "...",
      "createdAt": "2026-03-11T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/terminal-sessions`

Creates a terminal session for the authenticated user.

Request body:

```json
{
  "title": "session-name",
  "durationSeconds": 932,
  "content": "raw .cast file contents"
}
```

How it works:

- The uploaded `content` is sent to `ML_URL` (AI service).
- The AI service is expected to accept `POST` JSON with `title` and `content`.
- The AI service response must include a `content` array whose entries are JSON strings containing summary/depth data.
- The API rewrites that output into the newline-delimited `summary\ndepth` format currently expected by the frontend, then stores it in Postgres.

Response:

```json
{
  "terminalSession": {
    "id": "uuid",
    "title": "session-name",
    "durationSeconds": 932,
    "content": "...transformed AI service output...",
    "createdAt": "2026-03-11T12:00:00.000Z"
  }
}
```

#### `DELETE /api/terminal-sessions/:terminalSessionId`

Deletes an owned terminal session. The authenticated user must be the owner.

Response:

```json
{
  "message": "Terminal session deleted successfully."
}
```

#### `POST /api/terminal-sessions/share`

Shares an owned terminal session with another user by `targetUserEmail` or `targetUserId`.

Request body example:

```json
{
  "terminalSessionId": "uuid",
  "targetUserEmail": "jane@example.com"
}
```

Alternate request body:

```json
{
  "terminalSessionId": "uuid",
  "targetUserId": "uuid"
}
```

Response:

```json
{
  "message": "Session shared successfully.",
  "sharedWith": {
    "id": "uuid",
    "email": "jane@example.com",
    "name": "Jane Doe"
  }
}
```

#### `GET /api/terminal-sessions/shared`

Returns sessions shared with the authenticated user.

Response:

```json
{
  "terminalSessions": [
    {
      "id": "uuid",
      "title": "Model 1 Example",
      "durationSeconds": 932,
      "content": "...",
      "createdAt": "2026-03-11T12:00:00.000Z",
      "sharedAt": "2026-03-12T09:30:00.000Z",
      "ownerId": "uuid",
      "ownerName": "Jane Doe",
      "ownerEmail": "jane@example.com"
    }
  ]
}
```
