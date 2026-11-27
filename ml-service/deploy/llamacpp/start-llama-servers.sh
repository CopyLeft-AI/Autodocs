#!/usr/bin/env bash
# Serve both analysis models with llama.cpp. Stops both when either one exits.
# Required: MODEL0_GGUF, MODEL1_GGUF (paths to model files).
# Optional: LLAMA_SERVER (llama-server), LISTEN_HOST (127.0.0.1), MODEL0_PORT (8080),
#           MODEL1_PORT (8081), CONTEXT_TOKENS (8192), THREADS (llama.cpp default).
set -euo pipefail

: "${MODEL0_GGUF:?set MODEL0_GGUF to the Model 0 GGUF file}"
: "${MODEL1_GGUF:?set MODEL1_GGUF to the annotation model GGUF file}"
server=${LLAMA_SERVER:-llama-server}
host=${LISTEN_HOST:-127.0.0.1}
context=${CONTEXT_TOKENS:-8192}
command -v "$server" >/dev/null || { echo "$server not found; set LLAMA_SERVER" >&2; exit 1; }
for file in "$MODEL0_GGUF" "$MODEL1_GGUF"; do
    [[ -r $file ]] || { echo "Cannot read $file" >&2; exit 1; }
done

common=(--host "$host" --ctx-size "$context")
[[ -n ${THREADS:-} ]] && common+=(--threads "$THREADS")

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
"$server" "${common[@]}" --model "$MODEL0_GGUF" --alias model0 --port "${MODEL0_PORT:-8080}" &
pids+=($!)
"$server" "${common[@]}" --model "$MODEL1_GGUF" --alias annotator --port "${MODEL1_PORT:-8081}" &
pids+=($!)
wait -n
