"""Model 0: sliding-window boundary detection.

Direct port of the inference loop in model0/EndToEndProcessWhole_file.ipynb
(cells 2-3), with the in-notebook `model.generate(...)` call replaced by an
HTTP call to a local Ollama (or llama.cpp server) endpoint serving the
merged+quantized model0 GGUF. All prompt text, regexes, and truncation
constants are copied verbatim from the notebook -- do not "clean up" the
formatting, it must match what the LoRA was trained/evaluated against.
"""
import asyncio
import re
from dataclasses import dataclass
from typing import AsyncIterator, Awaitable, Callable, List, Optional, Tuple

import httpx

from cloudtemple import chat_completion
from concurrency import RequestLimiter, effective_concurrency
from config import StepConfig, load_config
from context_window import (
    BOUNDARY_ANSWER_TOKENS,
    boundary_history_enabled,
    estimate_tokens,
    history_budget,
    newest_that_fit,
)
from xml.etree import ElementTree as ET

SYSTEM_PROMPT = """Your task is to analyze terminal XML logs and determine whether the timestamp in the TARGET LINE belongs to a "new event" or an "old event".

### DEFINITION OF A NEW EVENT:
1. **Explicit Prompts:** The very first `<user_input>` that immediately follows a shell prompt (e.g., `demo@faiserver:~$`).
2. **Phase Transitions:** In automated logs, moving from one major build stage to another (e.g., from 'fai-mirror finished' to 'Copying the nfsroot').
3. **Internal Logic:** Shifts from downloading to processing.

### WHAT IS *NOT* A NEW EVENT (OLD EVENT):
- **User Input / Keystrokes:** A user typing a command, including pressing the Enter key (a newline `\\n`), is just the completion of the input phase.
- **Incomplete Tasks:** Continuous system output without a clear phase shift.

CRITICAL INSTRUCTION: You must classify ONLY the timestamp found in the "### TARGET LINE" section. Do NOT extract timestamps from the "### CONTEXT" section. Output only the timestamp and the classification. Do NOT use brackets, periods, explanations, or markdown formatting."""

CHUNK_RE = re.compile(r"<(user_input|system_output)\b[^>]*?(?:/>|>.*?</\1>)", flags=re.DOTALL)
TIME_RE = re.compile(r'timestamp="([\d\.]+)"')

WINDOW_SIZE = 15


@dataclass
class Chunk:
    ts: str
    text: str


def get_timestamp(chunk_text: str) -> str:
    match = TIME_RE.search(chunk_text)
    return match.group(1) if match else ""


def truncate_single_chunk(raw_text: str, tag_type: str, max_lines: int = 15) -> str:
    if tag_type != "system_output" or raw_text.endswith("/>"):
        return raw_text
    first_close = raw_text.find(">")
    last_open = raw_text.rfind("</")
    if first_close == -1 or last_open == -1:
        return raw_text

    opening_tag = raw_text[: first_close + 1]
    closing_tag = raw_text[last_open:]
    inner_text = raw_text[first_close + 1 : last_open]

    lines = inner_text.split("\n")
    if len(lines) > max_lines:
        head = "\n".join(lines[:5])
        tail = "\n".join(lines[-5:])
        removed = len(lines) - 10
        return f"{opening_tag}{head}\n\n... [TRUNCATED {removed} LINES] ...\n\n{tail}{closing_tag}"
    return raw_text


def compress_context_window(chunks: List[Chunk], max_total_lines: int = 25) -> str:
    total_lines = sum(len(c.text.split("\n")) for c in chunks)
    if total_lines <= max_total_lines:
        return "\n".join(c.text for c in chunks)

    result = []
    for idx, c in enumerate(chunks):
        raw_text = c.text
        if idx < 5 or idx >= len(chunks) - 5:
            result.append(raw_text)
        elif "<system_output" in raw_text and not raw_text.endswith("/>"):
            first_close = raw_text.find(">")
            last_open = raw_text.rfind("</")
            if first_close != -1 and last_open != -1:
                opening_tag = raw_text[: first_close + 1]
                closing_tag = raw_text[last_open:]
                result.append(f"{opening_tag}... [TRUNCATED TO SAVE SPACE] ...{closing_tag}")
            else:
                result.append(raw_text)
        else:
            result.append(raw_text)
    return "\n".join(result)


def extract_chunks(xml_content: str) -> List[Chunk]:
    """Regex-scan the flat XML into (timestamp, chunk-text) pairs, applying
    the same pre-truncation the notebook applies before windowing."""
    chunks: List[Chunk] = []
    for match in CHUNK_RE.finditer(xml_content):
        tag_type = match.group(1)
        raw_text = match.group(0)

        if len(raw_text) > 4000:
            raw_text = raw_text[:2000] + "\n...[MASSIVE LINE TRUNCATED]...\n" + raw_text[-2000:]

        processed_text = truncate_single_chunk(raw_text, tag_type, max_lines=15)
        ts_str = get_timestamp(processed_text)
        if ts_str:
            chunks.append(Chunk(ts=ts_str, text=processed_text))
    return chunks


def history_enabled(step: Optional[StepConfig] = None) -> bool:
    """Whether boundary decisions see the earlier ones (see context_window)."""
    step = step or load_config().steps["boundaries"]
    return boundary_history_enabled(step.backend)


def boundary_concurrency(requested: Optional[int] = None, step: Optional[StepConfig] = None, config=None) -> int:
    """Parallel boundary requests: one while each decision needs the previous."""
    config = config or load_config()
    step = step or config.steps["boundaries"]
    return 1 if history_enabled(step) else effective_concurrency(requested, step, config)


def format_decision(chunk: Chunk, is_new: bool) -> str:
    """One earlier verdict, worded like the model's own answer."""
    return f"{chunk.ts} {'new event' if is_new else 'old event'}"


def build_prompt(all_chunks: List[Chunk], i: int, decisions: Optional[List[bool]] = None) -> str:
    """Build the exact training/eval prompt string for chunk index i.

    `decisions` (verdicts for chunks 0..i-1, in order) adds a sliding window of
    earlier verdicts; without it the prompt is the one the model was trained on.
    """
    start_idx = max(0, i - WINDOW_SIZE + 1)
    window_chunks = all_chunks[start_idx : i + 1]

    context_chunks = window_chunks[:-1]
    target_chunk = window_chunks[-1]

    if context_chunks:
        context_text = compress_context_window(context_chunks, max_total_lines=25)
    else:
        context_text = "No previous context available."

    target_text = target_chunk.text

    if len(context_text) > 8000:
        context_text = "... [EARLIER CONTEXT TRUNCATED] ...\n" + context_text[-8000:]
    if len(target_text) > 2000:
        target_text = target_text[:1000] + "\n... [TARGET MIDDLE TRUNCATED] ...\n" + target_text[-1000:]

    input_data = f"### CONTEXT (Previous Events):\n{context_text}\n\n"
    if decisions:
        fixed = f"{SYSTEM_PROMPT}\n\n{input_data}### TARGET LINE (Extract and Classify THIS Timestamp):\n{target_text}"
        earlier = [format_decision(all_chunks[n], verdict) for n, verdict in enumerate(decisions[:i])]
        window = newest_that_fit(earlier, history_budget(estimate_tokens(fixed), BOUNDARY_ANSWER_TOKENS))
        if window:
            input_data += (
                "### EARLIER DECISIONS (your own answers for the chunks before the target, oldest first; "
                "use them for consistency, but classify only the TARGET LINE):\n"
                + "\n".join(window) + "\n\n"
            )
    input_data += f"### TARGET LINE (Extract and Classify THIS Timestamp):\n{target_text}"
    combined_user_text = f"{SYSTEM_PROMPT}\n\n{input_data}"

    return f"<|im_start|>user<|im_sep|>{combined_user_text}<|im_end|><|im_start|>assistant<|im_sep|>"


def is_new_event(model_result: str) -> bool:
    return "new" in model_result.lower()


async def classify_chunk(client: httpx.AsyncClient, prompt: str, step: Optional[StepConfig] = None, *, defer_long_retries: bool = False) -> str:
    """Ask the configured boundary model whether the target chunk starts an event.

    `step` is the boundary step configuration (default: the current config).
    Ollama and llama.cpp receive the raw (untemplated) prompt so the literal
    <|im_start|>/<|im_sep|>/<|im_end|> tokens from training are sent as-is,
    bypassing their own chat templating. Chat backends (openai, cloudtemple)
    receive the prompt as a user message.
    """
    step = step or load_config().steps["boundaries"]

    if step.is_chat:
        prefix = "<|im_start|>user<|im_sep|>"
        suffix = "<|im_end|><|im_start|>assistant<|im_sep|>"

        if not prompt.startswith(prefix) or not prompt.endswith(suffix):
            raise ValueError("Unexpected model0 prompt format")

        user_prompt = prompt[len(prefix):-len(suffix)]
        result = await chat_completion(
            client,
            model=step.model,
            prompt=user_prompt,
            max_tokens=step.max_tokens,
            timeout_seconds=step.timeout_seconds,
            base_url=step.base_url,
            api_key=step.api_key,
            max_attempts=step.max_attempts,
            defer_long_retries=defer_long_retries,
        )
        return result.lower()

    if step.backend == "llamacpp":
        if not step.base_url:
            raise ValueError("The boundaries step needs a base URL for llama.cpp")

        resp = await client.post(
            f"{step.base_url}/completions",
            json={
                "model": step.model,
                "prompt": prompt,
                "stream": False,
                "temperature": 0,
                "top_k": 1,
                "top_p": 1.0,
                "repeat_penalty": 1.0,
                "max_tokens": step.max_tokens,
            },
            timeout=httpx.Timeout(
                connect=30.0,
                read=step.timeout_seconds,
                write=120.0,
                pool=30.0,
            ),
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict):
            choices = data.get("choices")

            if (
                isinstance(choices, list)
                and choices
                and isinstance(choices[0], dict)
                and isinstance(choices[0].get("text"), str)
            ):
                return choices[0]["text"].strip().lower()

            content = data.get("content")
            if "choices" not in data and isinstance(content, str):
                return content.strip().lower()

            details = (
                f"JSON keys={list(data)}; "
                f"error={repr(data.get('error'))[:500]}"
            )
        else:
            details = f"JSON type={type(data).__name__}"

        raise RuntimeError(
            f"Unexpected llama.cpp /completions response "
            f"(HTTP {resp.status_code}): {details}"
        )

    if step.backend != "ollama":
        raise ValueError(f"Unsupported backend: {step.backend}")

    resp = await client.post(
        f"{step.base_url}/api/generate",
        json={
            "model": step.model,
            "prompt": prompt,
            "raw": True,
            "stream": False,
            "options": {
                # Greedy decoding to match the notebook's model.generate(...)
                # call, which never passes do_sample=True -- HF defaults to
                # greedy argmax there. Ollama's own defaults (temp=0.1,
                # top_k=40, top_p=0.9) sample instead.
                "temperature": 0,
                "repeat_penalty": 1.0,
                "top_k": 1,
                "top_p": 1.0,
                "num_predict": step.max_tokens,
                # Ollama defaults to n_threads=1 unless told otherwise, which
                # made one call take minutes; it must be passed per request.
                "num_thread": step.num_thread,
            },
        },
        timeout=step.timeout_seconds,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip().lower()


ProgressCallback = Callable[[int, int, int], Awaitable[None]]



_SHELL_PROMPT_RE = re.compile(
    r"(?:^|[\r\n])[\w.-]+@[\w.-]+(?::[^\r\n]*)?[#$]\s*$"
)


def _follows_shell_prompt(previous: Chunk, current: Chunk) -> bool:
    """Recognize user input directly following a common shell prompt."""
    if not previous.text.lstrip().startswith("<system_output"):
        return False

    if not current.text.lstrip().startswith("<user_input"):
        return False

    try:
        element = ET.fromstring(previous.text)
    except ET.ParseError:
        return False

    return bool(_SHELL_PROMPT_RE.search("".join(element.itertext())))


def plan_decisions(chunks: List[Chunk], step: StepConfig) -> List[Optional[bool]]:
    """Decide up front which chunks need no model call.

    Returns one entry per chunk: True/False when the decision is fixed by the
    shell-prompt rule (chat backends only), None when the model must be
    asked. The rule depends only on the chunks, never on model answers, so it
    can be settled before any request is sent.
    """
    plan: List[Optional[bool]] = []
    seen_user_input = False
    for i, chunk in enumerate(chunks):
        if step.is_chat and i == 0:
            plan.append(False)  # The first chunk already starts the first event.
        elif step.is_chat and _follows_shell_prompt(chunks[i - 1], chunk):
            # Keep the initial prompt together with the first command.
            # Subsequent commands start separate events.
            plan.append(seen_user_input)
        else:
            plan.append(None)
        if chunk.text.lstrip().startswith("<user_input"):
            seen_user_input = True
    return plan


async def stream_boundary_decisions(
    chunks: List[Chunk],
    client: httpx.AsyncClient,
    concurrency: int = 1,
    before_request: Optional[Callable[[], Awaitable[None]]] = None,
    step: Optional[StepConfig] = None,
    *,
    defer_long_retries: bool = False,
    limiter: Optional[RequestLimiter] = None,
) -> AsyncIterator[Tuple[int, Chunk, bool]]:
    """Yield (index, chunk, is_new_event) in chunk order as decisions arrive.

    Up to `concurrency` model calls are in flight at once. Every chunk is
    classified independently from its own context window, so the calls can run
    in parallel while results are still handed out strictly in order. This lets
    the caller start work on the first events before later chunks are decided.
    `before_request` is awaited before each model call (used for pause).
    `defer_long_retries` lets the provider layer hand long back-offs to the job runner.
    `limiter` replaces the per-call-site limit of `concurrency`, so a job can share
    one limit between this stage and another (local inference: one request at a time
    across both models).

    The first failed request stops everything at once: requests not yet sent are
    never sent, the ones in flight are cancelled, and the original error is raised
    without waiting for earlier, slower chunks to finish.
    """
    step = step or load_config().steps["boundaries"]
    plan = plan_decisions(chunks, step)
    # Passed only when set, so the plain call stays the one callers and tests know.
    retry_options = {"defer_long_retries": True} if defer_long_retries else {}
    limiter = limiter or RequestLimiter(concurrency)
    if history_enabled(step):
        # Each verdict is built from the previous ones, so this cannot be parallel.
        decisions: List[bool] = []
        for i, chunk in enumerate(chunks):
            verdict = plan[i]
            if verdict is None:
                async with limiter.slot(RequestLimiter.BOUNDARY_PRIORITY):
                    if before_request:
                        await before_request()
                    verdict = is_new_event(await classify_chunk(client, build_prompt(chunks, i, decisions), step, **retry_options))
            decisions.append(verdict)
            yield i, chunk, verdict
        return
    failed = asyncio.Event()
    first_error: List[BaseException] = []

    async def decide(i: int) -> bool:
        fixed = plan[i]
        if fixed is not None:
            return fixed
        try:
            async with limiter.slot(RequestLimiter.BOUNDARY_PRIORITY):  # Earlier chunks first.
                if before_request:
                    await before_request()
                return is_new_event(await classify_chunk(client, build_prompt(chunks, i), step, **retry_options))
        except Exception as error:
            if not first_error:
                first_error.append(error)
                failed.set()  # Wakes the ordered loop at once; its finally block cancels the rest.
            raise

    tasks = [asyncio.create_task(decide(i)) for i in range(len(chunks))]
    try:
        for i, task in enumerate(tasks):
            watcher = asyncio.create_task(failed.wait())
            try:
                await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                watcher.cancel()
            if first_error:
                raise first_error[0]
            yield i, chunks[i], task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def find_new_event_timestamps(
    xml_content: str,
    client: httpx.AsyncClient,
    progress_callback: Optional[ProgressCallback] = None,
    concurrency: Optional[int] = None,
    step: Optional[StepConfig] = None,
    *,
    defer_long_retries: bool = False,
) -> List[str]:
    config = load_config()
    step = step or config.steps["boundaries"]
    all_chunks = extract_chunks(xml_content)
    collected_new_events: List[str] = []
    async for i, chunk, is_new in stream_boundary_decisions(
        all_chunks, client, boundary_concurrency(concurrency, step, config), step=step,
        defer_long_retries=defer_long_retries,
    ):
        if is_new:
            collected_new_events.append(chunk.ts)
        if progress_callback:
            await progress_callback(i + 1, len(all_chunks), len(collected_new_events))
    return collected_new_events
