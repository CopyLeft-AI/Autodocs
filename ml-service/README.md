# AutoDocs local CPU ML service

This optional FastAPI service replaces the hosted Colab/ngrok endpoint with a
local Ollama-backed pipeline. It preserves the legacy `POST /` response
contract, and additionally provides durable `/jobs` endpoints for the web
app's opt-in progress UI.

## Configuration file

Which model and inference source each analysis step uses lives in one JSON
file, `ml-service/config.json` (git-ignored; override the path with
`AUTODOCS_CONFIG_FILE`). Copy `config.example.json` to start. The web app's
Settings page edits the same file through `GET/PUT /config`; hand edits work
too and are read when the next job starts. The file is written with owner-only
permissions and API keys are never returned by the API.

| Step | `steps.boundaries` (where events split) and `steps.annotate` (depth and summary of each event) |
| --- | --- |
| `backend` | `ollama`, `llamacpp`, `openai` (any OpenAI-compatible `/chat/completions` API, http or https) or `cloudtemple` |
| `model`, `baseUrl`, `apiKey` | Model name, server URL, API key (chat backends) |
| `timeoutSeconds`, `maxTokens` | Request timeout and output limit |
| `alternativeModels` | Comma-separated model names that users of the web app may pick instead of `model` |
| `numThread` | Ollama only |
| `maxAttempts` | Chat backends: retries on 429/5xx |
| `reasoningEffort` | `annotate` with Ollama: `low`, `medium` or `high` |
| `summaryWordLimit` | `annotate`: words per summary |

`processing` holds `remoteApiConcurrency`, `maxConcurrentJobs` (read at service
start) and `inferenceLocation` (`auto`, `local`, `remote`).

Resolution order for every value: config file, then the legacy environment
variable (`LLM_BACKEND`, `MODEL0_NAME`, `MODEL1_NAME`, `OLLAMA_URL`,
`LLAMACPP_BASE_URL`, `CLOUDTEMPLE_*`, `MAX_NEW_TOKENS`, `SUMMARY_WORD_LIMIT`,
...), then the built-in default. Existing env-only setups keep working. A key
from the environment (`OPENAI_API_KEY`, `CLOUDTEMPLE_API_KEY`) is used when the
step has none; `OPENAI_API_KEY` is only ever sent to `api.openai.com`. A running
job keeps the settings it started with. Chat backends (`openai`, `cloudtemple`)
also use the shell-prompt rule to keep a prompt with its first command.

`GET /config` returns `stored` (what the file says), `effective` (resolved
values), `apiKeySet`/`apiKeyInFile`, and a `schema` with allowed values and
limits. `PUT /config` merges a partial body: `null` resets a value to its
default, omitting `apiKey` keeps the stored key, `""` removes it, invalid
values return 422 and write nothing. The service has no login of its own;
anyone who can reach it can read and change the configuration, so keep it on a
private network (the web app requires a signed-in user for its settings API).

## Choosing models per analysis

`POST /` and `POST /jobs` accept an optional `options` object: `boundaryModel`,
`annotateModel`, `summaryWordLimit` (5 to 500) and `reasoningEffort`. It never
changes the backend, server address or key. Results report the models used in
`models`. To serve both models with llama.cpp, see
[`deploy/llamacpp`](deploy/llamacpp/README.md).

## Prerequisites

- Python 3.11 or later.
- Ollama reachable at `OLLAMA_URL` (default: `http://127.0.0.1:11434`).
- A Model 0 GGUF registered in Ollama as `model0`, built from the project's
  fine-tuned adapter and served in raw-completion mode.
- `gpt-oss:20b` available in Ollama for Model 1 annotation.

The model names and CPU thread count are configurable. The service does not
download, merge, or quantize model artifacts itself.

## Start the service

From the repository root:

```bash
python3 -m venv ml-service/.venv
ml-service/.venv/bin/pip install -r ml-service/requirements.txt

export OLLAMA_URL="http://127.0.0.1:11434"
export MODEL0_NAME="model0"
export MODEL1_NAME="gpt-oss:20b"
export OLLAMA_NUM_THREAD="$(nproc)"
export AUTODOCS_JOB_DIRECTORY="$(pwd)/ml-service/jobs"

ml-service/.venv/bin/uvicorn app:app --app-dir ml-service --host 127.0.0.1 --port 8500
```

Optional: `AUTODOCS_MAX_CONCURRENT_JOBS` (default `2`) sets how many jobs run
at the same time; further uploads wait in the queue. Lower it to `1` on a
machine where parallel inference starves each job.

`AUTODOCS_REMOTE_API_CONCURRENCY` (default `8`, range 1 to 32) is how many
model requests one job may run in parallel when inference uses a remote API.
The web app overrides it per user (Settings, "Parallel API requests") through
the `parallelRequests` field of `POST /jobs`. Summaries run alongside, so a
remote job can have that many boundary requests plus one summary request in
flight. Local inference (Ollama or llama.cpp on this machine) always uses one
request at a time across both models. A failed request stops the job's other
requests at once. Detection is
automatic; set `AUTODOCS_INFERENCE_LOCATION=remote` or `local` to force it.

The job directory stores raw uploaded recordings and status snapshots with
owner-only permissions. Keep it on private storage and do not serve it over
HTTP. Set `AUTODOCS_JOB_DIRECTORY` to a durable private location when running
under a service manager.

## Connect the web app

Set these values in `autodocs-app/.env.local`:

```env
ML_URL="http://127.0.0.1:8500"
AUTODOCS_PROCESSING_MODE="local-cpu-jobs"
```

Apply `autodocs-app/db/init/004_processing_jobs.sql` to existing Postgres
databases before enabling this mode. See the [web app README](../autodocs-app/README.md#local-cpu-inference-option)
for the full migration and behavior notes.

## API documentation

FastAPI generates the OpenAPI description and a Swagger page: open `http://127.0.0.1:8500/docs`
(raw description at `/openapi.json`) when you run the service directly. In a deployment the web app shows
the same page at `/ml-service/docs` to administrators and proxies the calls, so the service does not need
to be reachable from browsers.

## Compatibility

`AUTODOCS_PROCESSING_MODE` is deliberately opt-in. When it is absent, the web
app continues to call its original `/api/terminal-sessions` route, and this
service's `POST /` endpoint remains compatible with that route. Only the
`local-cpu-jobs` setting uses `POST /jobs` and `GET /jobs/{id}`.

## Job endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /jobs` | Create and queue a job. |
| `GET /jobs/{id}` | Status, stages, timeline, plus live `etaSeconds` and `resources`. |
| `POST /jobs/{id}/pause` | Pause a running job after its current model call (409 otherwise). |
| `POST /jobs/{id}/resume` | Resume a paused job. |
| `POST /jobs/{id}/cancel` | Cancel a queued, running or paused job. |
| `DELETE /jobs/{id}` | Delete a failed or cancelled job and its recording. |

Job statuses: `queued`, `running`, `paused`, `completed`, `failed`, `cancelled`.
`resources` reports machine-wide CPU (and GPU via `nvidia-smi`) load and is
`null` when the LLM backend is remote (`LLM_BACKEND=cloudtemple` or a
non-loopback Ollama URL).

## Processing pipeline

Both steps see a sliding window of their own earlier answers, so each decision
can build on how the previous ones were made:

- **Boundaries (Model 0)** get an "EARLIER DECISIONS" section listing the
  new/old verdict of the chunks before the target. Each verdict depends on the
  one before it, so while this is on the boundary requests run one at a time.
  `AUTODOCS_BOUNDARY_HISTORY` is `auto` (default: on for the `cloudtemple` chat
  backend, off for Ollama/llama.cpp, whose fine-tuned Model 0 was trained
  without that section), `on` or `off`. With it off, chunks are classified
  independently, in parallel on a remote API, as before.
- **Summaries (Model 1)** get a `neighbor_tail` listing the id, depth and
  summary of the events before the current one, plus the running depth.

The window is the smaller of two sizes: the context buffer
(`AUTODOCS_CONTEXT_TOKENS`, default 8192; keep it at or below the server's real
context, e.g. Ollama's `num_ctx`) minus the fixed prompt and the room kept for
the answer, or everything decided so far. The newest entries are kept. Token
counts are estimated at 3 characters per token, so the window errs small. If
the server still reports an overlong prompt, Model 1 retries with a smaller
window.

An event is handed to summarization the moment the next boundary shows where it
ends, so summaries start while later chunks are still being checked: the two
models run at the same time. Summaries themselves stay sequential.
The job reports two overlapping running stages (`boundaries`, `annotate`);
`annotate.estimated` is true while its event total is still a guess.

## Dummy inference server

`dev/dummy_inference.py` answers like llama.cpp (and Ollama) without any model
or API key, with canned deterministic output. Use it to run and test the
service end to end.

```bash
DUMMY_LATENCY_MS=150 ml-service/.venv/bin/python ml-service/dev/dummy_inference.py --port 8600
LLM_BACKEND=llamacpp LLAMACPP_BASE_URL=http://127.0.0.1:8600 \
  AUTODOCS_INFERENCE_LOCATION=remote AUTODOCS_JOB_DIRECTORY=/path/to/scratch/jobs \
  ml-service/.venv/bin/uvicorn app:app --app-dir ml-service --port 8501
```

`GET /stats` reports `maxInFlight`, the highest number of simultaneous
requests, which shows whether parallelism works. `DUMMY_FAIL_EVERY=N` makes
every Nth request fail with HTTP 500. `AUTODOCS_INFERENCE_LOCATION=remote` is
needed because a loopback server otherwise counts as local inference.
Sample recordings: `last-Iteration/data/model_0/raw/*.cast`. Point a step at it with the settings page, or in `config.json`:
`openai` with base URL `http://127.0.0.1:8600/v1` (it records the model name and
Bearer key it receives in `/stats`), `llamacpp` with `http://127.0.0.1:8600`, or
`ollama` with the same URL. Run the tests with `pytest ml-service/tests`.
