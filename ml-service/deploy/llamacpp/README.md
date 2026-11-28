# Running the analysis on a llama.cpp host

Runs both analysis models with `llama-server` instead of Ollama or a hosted
service, for a machine such as a student inference host.

| File | Purpose |
| --- | --- |
| `build-model0-gguf.sh`, `merge_adapter.py` | Make the Model 0 GGUF from the fine-tuned adapter |
| `start-llama-servers.sh` | Serve both models (ports 8080 and 8081) |
| `config.json` | Service settings pointing at those two servers |

## 1. Build the Model 0 file (once, on any large machine)

Needs the adapter folder (`adapter_config.json`, `adapter_model.safetensors`
and tokenizer files; model weights are not in this repository), a built
[llama.cpp](https://github.com/ggml-org/llama.cpp) checkout, and a Python
environment with `torch`, `transformers`, `peft` and llama.cpp's
`requirements.txt`. Merging loads the full-precision base model: expect more
than 60 GB of memory and free disk space for the download and the 16-bit file.

```bash
ml-service/deploy/llamacpp/build-model0-gguf.sh /path/to/adapter /path/to/llama.cpp /path/to/work
```

The result is `/path/to/work/model0.Q4_K_M.gguf`; copy it to the inference host.

## 2. Start the model servers (on the inference host)

Any chat model in GGUF form can describe the events; the project has used
`gpt-oss-20b`.

```bash
MODEL0_GGUF=/models/model0.Q4_K_M.gguf MODEL1_GGUF=/models/gpt-oss-20b.gguf \
  ml-service/deploy/llamacpp/start-llama-servers.sh
```

The servers listen on `127.0.0.1` only. When the analysis service runs on
another machine, forward both ports over SSH rather than opening them:

```bash
ssh -N -L 8080:127.0.0.1:8080 -L 8081:127.0.0.1:8081 user@inference-host
```

With forwarded ports, set `inferenceLocation` to `local` as in `config.json`:
the other end is a single machine, so requests are sent one at a time.

## 3. Start the analysis service

```bash
cp ml-service/deploy/llamacpp/config.json ml-service/config.json
```

Then follow "Start the service" in [the service README](../../README.md); the
`OLLAMA_*` variables are not needed. Upload a recording and run a model from the
web app; each annotation records `llamacpp` and the model names above.

## Status

Checked on an ordinary x86 PC, CPU only, with llama.cpp build 6097:
`start-llama-servers.sh` and `config.json` (ports changed) served a stock 4B
Qwen3 instruct model for both steps, and the analysis service completed a
two-command recording (4 boundary chunks, 4 summaries). It ran at lowered
scheduling priority on a shared machine, so its duration is not a speed figure.

Not run: merging and conversion with the real Model 0 adapter, inference with
the fine-tuned Model 0 or with `gpt-oss-20b`, and anything on the Phi. The
output quality of this check says nothing about the real models.
