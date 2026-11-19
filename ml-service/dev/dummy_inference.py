"""Dummy inference server for developing and testing ml-service without models.

Speaks the three wire formats ml-service can call, so no GPU, Ollama or API key
is needed:

  llama.cpp   POST /completions, POST /chat/completions (streamed)
  Ollama      POST /api/generate, POST /api/chat
  OpenAI      POST /v1/chat/completions (not streamed; Bearer key is recorded, not checked)

Answers are deterministic and cheap: model 0 says "new" when a command starts
(a user_input directly after system_output), model 1 returns a short canned
summary. It also records how many requests ran at the same time, so tests can
prove that parallel requests really overlap.

  GET  /stats        {"requests", "inFlight", "maxInFlight", "model0", "model1"}
  POST /stats/reset  zero the counters

Run:  DUMMY_LATENCY_MS=200 python ml-service/dev/dummy_inference.py --port 8600
Then: LLM_BACKEND=llamacpp LLAMACPP_BASE_URL=http://127.0.0.1:8600
      AUTODOCS_INFERENCE_LOCATION=remote   (treat it as a remote API)

Env: DUMMY_LATENCY_MS (default 100) delay added to every answer;
     DUMMY_FAIL_EVERY=N makes every Nth request return HTTP 500.
"""

import argparse
import asyncio
import json
import os
import re
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

app = FastAPI(title="autodocs-dummy-inference")
stats = {"requests": 0, "inFlight": 0, "maxInFlight": 0, "model0": 0, "model1": 0, "models": {}, "lastAuthorization": None}


def latency_seconds() -> float:
    return float(os.getenv("DUMMY_LATENCY_MS", "100")) / 1000


@asynccontextmanager
async def tracked(kind: str):
    """Count the request, hold it for the configured latency, track overlap."""
    stats["requests"] += 1
    stats[kind] += 1
    every = int(os.getenv("DUMMY_FAIL_EVERY", "0"))
    if every and stats["requests"] % every == 0:
        raise HTTPException(status_code=500, detail="dummy failure (DUMMY_FAIL_EVERY)")
    stats["inFlight"] += 1
    stats["maxInFlight"] = max(stats["maxInFlight"], stats["inFlight"])
    try:
        await asyncio.sleep(latency_seconds())
        yield
    finally:
        stats["inFlight"] -= 1


def model0_answer(prompt: str) -> str:
    """'new' when the target chunk is a user_input right after system output."""
    # rpartition: the system prompt itself also mentions "### TARGET LINE".
    head, _, target = prompt.rpartition("### TARGET LINE (Extract")
    context = head.rpartition("### CONTEXT")[2]
    tags = re.findall(r"<(user_input|system_output)\b", context)
    follows_output = bool(tags) and tags[-1] == "system_output"
    target_chunk = target.partition("\n")[2].lstrip()
    return "new" if target_chunk.startswith("<user_input") and follows_output else "old"


def model1_answer(prompt: str) -> str:
    """Canned annotation naming the target event, in the format model 1 must use."""
    match = re.search(r'<target id="(\d+)">', prompt)
    index = int(match.group(1)) if match else 0
    depth = -1 if index == 0 else 0
    return f'<think>Dummy reasoning for event {index}.</think>\n{json.dumps({"annotation": f"Dummy summary of event {index}", "depth": depth})}'


@app.get("/stats")
async def get_stats():
    return stats


@app.post("/stats/reset")
async def reset_stats():
    stats.update(requests=0, inFlight=0, maxInFlight=0, model0=0, model1=0, models={}, lastAuthorization=None)
    return stats


@app.post("/completions")
async def llamacpp_completions(request: Request):
    body = await request.json()
    async with tracked("model0"):
        stats["models"][body["model"]] = stats["models"].get(body["model"], 0) + 1
        return {"choices": [{"text": model0_answer(body["prompt"])}]}


@app.post("/chat/completions")
async def llamacpp_chat(request: Request):
    body = await request.json()
    async with tracked("model1"):
        stats["models"][body["model"]] = stats["models"].get(body["model"], 0) + 1
        text = model1_answer(body["messages"][-1]["content"])

    def stream():
        yield f"data: {json.dumps({'choices': [{'delta': {'content': text}}]})}\n\n"
        yield f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/v1/chat/completions")
async def openai_chat(request: Request):
    """OpenAI wire format; tells the two steps apart by their prompts."""
    body = await request.json()
    prompt = body["messages"][-1]["content"]
    stats["lastAuthorization"] = request.headers.get("authorization")
    is_summary = "<task>" in prompt and "<target id=" in prompt
    async with tracked("model1" if is_summary else "model0"):
        stats["models"][body["model"]] = stats["models"].get(body["model"], 0) + 1
        text = model1_answer(prompt) if is_summary else model0_answer(prompt)
    return {"choices": [{"finish_reason": "stop", "message": {"content": text}}]}


@app.post("/api/generate")
async def ollama_generate(request: Request):
    body = await request.json()
    async with tracked("model0"):
        stats["models"][body["model"]] = stats["models"].get(body["model"], 0) + 1
        return {"response": model0_answer(body["prompt"])}


@app.post("/api/chat")
async def ollama_chat(request: Request):
    body = await request.json()
    async with tracked("model1"):
        stats["models"][body["model"]] = stats["models"].get(body["model"], 0) + 1
        text = model1_answer(body["messages"][-1]["content"])
        thinking, _, content = text.partition("</think>")
        return {"message": {"thinking": thinking.removeprefix("<think>"), "content": content.strip()}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8600)
    arguments = parser.parse_args()
    uvicorn.run(app, host=arguments.host, port=arguments.port, log_level="warning")
