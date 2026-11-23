# AutoDocs local CPU ML service

This optional FastAPI service replaces the hosted Colab/ngrok endpoint with a
local Ollama-backed pipeline. It preserves the legacy `POST /` response
contract, and additionally provides durable `/jobs` endpoints for the web
app's opt-in progress UI.

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

Boundary detection classifies each terminal chunk independently, so those
requests run in parallel (remote API only) while results are consumed in
order. An event is handed to summarization the moment the next boundary shows
where it ends, so summaries start while later chunks are still being checked.
Summaries themselves stay sequential: each one uses the depth and summaries of
the events before it, so the output is identical to a fully sequential run.
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
Sample recordings: `last-Iteration/data/model_0/raw/*.cast`. Run the tests with
`pytest ml-service/tests`.
