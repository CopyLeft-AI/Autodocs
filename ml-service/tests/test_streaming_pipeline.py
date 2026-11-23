"""Parallel boundary requests, incremental event grouping, and the streamed job pipeline."""

import asyncio
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import model0
import model1
import parser0
import restructure
from concurrency import effective_concurrency
from event_stream import EventSplitter
from job_runner import JobRunner, run_together
from job_store import JobStore


def cast_text(commands: int) -> str:
    """A recording with `commands` shell commands, each a prompt, a keystroke and output."""
    lines = [json.dumps({"version": 2, "width": 80, "height": 24})]
    now = 0.0
    for number in range(commands):
        lines += [
            json.dumps([now + 0.01, "o", "demo@test:~$ "]),
            json.dumps([now + 0.10, "i", "x\r"]),
            json.dumps([now + 0.20, "o", f"output {number}\r\n"]),
        ]
        now += 1.0
    return "\n".join(lines)


def is_command_start(prompt: str) -> str:
    """Fake model 0: a user_input right after system_output starts a command."""
    context, _, target = prompt.rpartition("### TARGET LINE (Extract")
    kinds = [m for m in ("user_input", "system_output") if m in context]
    last = max(kinds, key=context.rfind) if kinds else None
    starts = target.partition("\n")[2].lstrip().startswith("<user_input") and last == "system_output"
    return "new" if starts else "old"


# --- concurrency policy ----------------------------------------------------

def test_local_inference_is_always_sequential(monkeypatch):
    monkeypatch.setenv("AUTODOCS_INFERENCE_LOCATION", "local")
    assert effective_concurrency(8) == 1


def test_remote_inference_uses_setting_default_and_limits(monkeypatch):
    monkeypatch.setenv("AUTODOCS_INFERENCE_LOCATION", "remote")
    monkeypatch.delenv("AUTODOCS_REMOTE_API_CONCURRENCY", raising=False)
    assert effective_concurrency(None) == 8
    assert effective_concurrency(3) == 3
    assert effective_concurrency(500) == 32
    monkeypatch.setenv("AUTODOCS_REMOTE_API_CONCURRENCY", "4")
    assert effective_concurrency(None) == 4


# --- parallel, ordered boundary decisions ----------------------------------

def test_decisions_arrive_in_order_while_requests_overlap(monkeypatch):
    chunks = model0.extract_chunks(parser0.cast_to_xml(cast_text(6), strip_annotations=True))
    in_flight = peak = 0

    async def fake_classify(client, prompt):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        # Earlier chunks answer slower, so completion order is reversed.
        await asyncio.sleep(0.2 - 0.01 * len(prompt) / 1000)
        in_flight -= 1
        return is_command_start(prompt)

    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", fake_classify)

    async def collect(concurrency):
        return [(i, new) async for i, _, new in model0.stream_boundary_decisions(chunks, None, concurrency)]

    parallel = asyncio.run(collect(4))
    assert peak == 4
    assert [i for i, _ in parallel] == list(range(len(chunks)))
    peak = 0
    assert asyncio.run(collect(1)) == parallel
    assert peak == 1


def test_a_failed_request_stops_the_stream_and_cancels_the_rest(monkeypatch):
    chunks = model0.extract_chunks(parser0.cast_to_xml(cast_text(4), strip_annotations=True))
    started = 0

    async def fake_classify(client, prompt):
        nonlocal started
        started += 1
        if started == 2:
            raise RuntimeError("boom")
        await asyncio.sleep(0.05)
        return "old"

    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", fake_classify)

    async def consume():
        return [d async for d in model0.stream_boundary_decisions(chunks, None, 2)]

    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(consume())
    assert started < len(chunks)


def test_before_request_hook_gates_every_model_call(monkeypatch):
    chunks = model0.extract_chunks(parser0.cast_to_xml(cast_text(2), strip_annotations=True))
    gate_calls = 0

    async def gate():
        nonlocal gate_calls
        gate_calls += 1

    async def fake_classify(client, prompt):
        return "old"

    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", fake_classify)

    async def consume():
        return [d async for d in model0.stream_boundary_decisions(chunks, None, 3, gate)]

    asyncio.run(consume())
    assert gate_calls == len(chunks)


# --- incremental grouping equals restructure --------------------------------

def event_signature(element: ET.Element) -> list[tuple[str, str]]:
    return [(child.tag, (child.get("timestamp") or "") + "|" + "".join(child.itertext())) for child in element]


def test_splitter_matches_restructure():
    xml = parser0.cast_to_xml(cast_text(5), strip_annotations=True)
    chunks = model0.extract_chunks(xml)
    decisions = [is_command_start(model0.build_prompt(chunks, i)) == "new" for i in range(len(chunks))]
    boundaries = [c.ts for c, new in zip(chunks, decisions) if new]

    expected = ET.fromstring(restructure.restructure_xml_to_events(xml, boundaries)).findall("event")

    splitter = EventSplitter(xml)
    streamed = []
    for chunk, new in zip(chunks, decisions):
        closed = splitter.advance(chunk.ts, new)
        if closed:
            streamed.append(closed)
    last = splitter.finish()
    if last:
        streamed.append(last)

    assert len(streamed) == len(expected) > 1
    for got, want in zip(streamed, expected):
        assert event_signature(ET.fromstring(got)) == event_signature(want)


def test_splitter_closes_an_event_as_soon_as_the_next_boundary_arrives():
    xml = parser0.cast_to_xml(cast_text(2), strip_annotations=True)
    chunks = model0.extract_chunks(xml)
    splitter = EventSplitter(xml)
    closed_at = [i for i, c in enumerate(chunks) if splitter.advance(c.ts, c is chunks[3])]
    assert closed_at == [3]  # Known at chunk 3, long before the last chunk.


def test_splitter_splits_only_where_told_when_timestamps_repeat():
    xml = ('<recording><user_input timestamp="1.0">a</user_input><system_output timestamp="1.0">b</system_output>'
           '<user_input timestamp="2.0">c</user_input></recording>')
    splitter = EventSplitter(xml)
    assert splitter.advance("1.0", False) is None
    assert splitter.advance("1.0", True) is not None  # Boundary at the second 1.0 child only.
    assert splitter.advance("2.0", False) is None
    assert "c" in (splitter.finish() or "")


# --- the streamed job pipeline ----------------------------------------------

def test_failure_stops_new_requests_even_when_an_earlier_chunk_is_slow(monkeypatch):
    chunks = [model0.Chunk(ts=f"{n}.0", text=f'<system_output timestamp="{n}.0">x</system_output>') for n in range(40)]
    started: list[int] = []

    async def fake_classify(client, prompt):
        number = int(prompt.rsplit('timestamp="', 1)[1].split(".")[0])
        started.append(number)
        if number == 0:
            await asyncio.sleep(1.0)  # The first chunk is slow...
        elif number == 3:
            raise RuntimeError("provider 500")  # ...and a later one fails at once.
        else:
            await asyncio.sleep(0.05)
        return "old"

    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", fake_classify)

    async def consume():
        started_at = asyncio.get_running_loop().time()
        with pytest.raises(RuntimeError, match="provider 500"):
            async for _ in model0.stream_boundary_decisions(chunks, None, 4):
                pass
        return asyncio.get_running_loop().time() - started_at

    elapsed = asyncio.run(consume())
    assert len(started) < 10  # Not all 40 requests are sent after the failure.
    assert elapsed < 0.5  # The error does not wait for the slow first chunk.


def test_external_cancellation_still_cancels_the_stream(monkeypatch):
    chunks = [model0.Chunk(ts=f"{n}.0", text=f'<system_output timestamp="{n}.0">x</system_output>') for n in range(6)]

    async def slow_classify(client, prompt):
        await asyncio.sleep(10)
        return "old"

    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", slow_classify)

    async def consume():
        task = asyncio.create_task(_drain(chunks))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    async def _drain(items):
        async for _ in model0.stream_boundary_decisions(items, None, 2):
            pass

    asyncio.run(consume())


async def run_job(tmp_path, concurrency, monkeypatch, commands=5, observer=None, location="remote", slow_first_input=False):
    """Run a whole job with fake models. `observer(event, runner, job_id)` sees each model call."""
    order: list[str] = []
    deferred: list[bool] = []
    store = JobStore(str(tmp_path))
    job_id = str(uuid4())
    await store.create(job_id, "T", cast_text(commands), concurrency)
    assert await store.running(job_id)
    runner = JobRunner(store)

    async def fake_classify(client, prompt, *, defer_long_retries=False):
        deferred.append(defer_long_retries)
        if observer:
            observer("boundary:start", runner, job_id, prompt)
        # The request for the first command's input (it closes the first event) is slow.
        await asyncio.sleep(0.3 if slow_first_input and 'timestamp="0.1"' in prompt.rpartition("### TARGET LINE")[2] else 0.01)
        order.append("boundary")
        if observer:
            observer("boundary:end", runner, job_id, prompt)
        return is_command_start(prompt)

    async def fake_generate(client, instruction, *, defer_long_retries=False):
        deferred.append(defer_long_retries)
        order.append("annotation")
        if observer:
            observer("annotation:start", runner, job_id, instruction)
        await asyncio.sleep(0.01)
        if observer:
            observer("annotation:end", runner, job_id, instruction)
        index = instruction.split('<target id="')[1].split('"')[0]
        return f'</think>{{"annotation": "Summary {index}", "depth": 0}}'

    monkeypatch.setenv("AUTODOCS_INFERENCE_LOCATION", location)
    monkeypatch.setattr(model0, "LLM_BACKEND", "ollama")
    monkeypatch.setattr(model0, "classify_chunk", fake_classify)
    monkeypatch.setattr(model1, "generate", fake_generate)

    await runner._run(job_id)
    # Job runs hand long provider back-offs to the runner (persistent retries).
    assert deferred and all(deferred)
    return await store.status(job_id), order


def test_annotation_starts_before_all_boundaries_are_found(tmp_path, monkeypatch):
    state, order = asyncio.run(run_job(tmp_path, 4, monkeypatch))
    assert state["status"] == "completed"
    assert state["parallelRequests"] == 4
    assert order.index("annotation") < len(order) - 1 - order[::-1].index("boundary")


def test_streamed_result_matches_sequential_result(tmp_path, monkeypatch):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    parallel, _ = asyncio.run(run_job(tmp_path / "a", 8, monkeypatch))
    sequential, _ = asyncio.run(run_job(tmp_path / "b", 1, monkeypatch))
    summaries = lambda s: [(json.loads(c)["idx"], json.loads(c)["summary"], json.loads(c)["depth"]) for c in s["result"]["content"]]
    assert summaries(parallel) == summaries(sequential)
    assert len(summaries(parallel)) == 6  # The first prompt, then one event per command.


def test_progress_is_monotonic_and_stages_finish(tmp_path, monkeypatch):
    state, _ = asyncio.run(run_job(tmp_path, 4, monkeypatch))
    assert state["percent"] == 100
    assert all(stage["status"] == "completed" and not stage["estimated"] for stage in state["stages"])
    assert [stage["id"] for stage in state["stages"]] == ["parse", "boundaries", "annotate", "finalize"]


def test_progress_never_moves_backwards_when_an_estimate_is_revised(tmp_path):
    async def scenario():
        store = JobStore(str(tmp_path))
        job_id = str(uuid4())
        await store.create(job_id, "T", "x")
        await store.running(job_id)
        await store.stage(job_id, "annotate", 0, "")
        await store.progress(job_id, "annotate", 5, 10, "", estimated=True)
        high = (await store.status(job_id))["percent"]
        await store.progress(job_id, "annotate", 5, 40, "", estimated=True)  # Estimate grew.
        return high, (await store.status(job_id))["percent"]

    high, after = asyncio.run(scenario())
    assert after >= high > 0


def test_run_together_cancels_the_sibling_on_failure():
    cancelled = False

    async def sibling():
        nonlocal cancelled
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled = True
            raise

    async def failing():
        await asyncio.sleep(0.01)
        raise ValueError("bad")

    with pytest.raises(ValueError):
        asyncio.run(run_together(sibling(), failing()))
    assert cancelled


def test_local_inference_never_overlaps_the_two_models(tmp_path, monkeypatch):
    in_flight = {"now": 0, "max": 0}

    def observe(event, runner, job_id, detail=""):
        in_flight["now"] += 1 if event.endswith(":start") else -1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])

    state, order = asyncio.run(run_job(tmp_path, 8, monkeypatch, observer=observe, location="local"))
    assert state["status"] == "completed"
    assert in_flight["max"] == 1  # One request at a time across boundaries and summaries.
    # Summaries are not starved by the boundary requests already waiting.
    assert order.index("annotation") < len(order) - 1 - order[::-1].index("boundary")


def test_remote_inference_lets_summaries_overlap_boundary_requests(tmp_path, monkeypatch):
    in_flight = {"now": 0, "max": 0}

    def observe(event, runner, job_id, detail=""):
        in_flight["now"] += 1 if event.endswith(":start") else -1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])

    asyncio.run(run_job(tmp_path, 2, monkeypatch, observer=observe))
    assert 2 < in_flight["max"] <= 3  # N boundary requests plus one summary.


def test_pause_stops_the_annotator_from_starting_a_request(tmp_path, monkeypatch):
    paused_calls: list[str] = []

    def observe(event, runner, job_id, detail=""):
        control = runner._control(job_id)
        loop = asyncio.get_running_loop()
        if event == "boundary:start" and 'timestamp="0.1"' in detail.rpartition("### TARGET LINE")[2]:
            # The slow request that closes the first event is in flight: pause, resume later.
            loop.call_later(0.1, control.pause)
            loop.call_later(0.6, control.resume)
        if event == "annotation:start" and not control._running.is_set():
            paused_calls.append(event)  # No summary may start through the pause.

    result, _ = asyncio.run(run_job(tmp_path, 4, monkeypatch, observer=observe, slow_first_input=True))
    assert result["status"] == "completed"
    assert paused_calls == []


def test_a_job_queued_before_an_upgrade_starts_with_the_current_stages(tmp_path):
    async def scenario():
        store = JobStore(str(tmp_path))
        job_id = str(uuid4())
        await store.create(job_id, "T", cast_text(1), None)
        path = store._state_path(job_id)
        state = json.loads(path.read_text())
        # What an older version wrote: a "restructure" stage and some progress.
        state["stages"] = [{"id": "parse"}, {"id": "boundaries"}, {"id": "restructure"}, {"id": "annotate"}, {"id": "finalize"}]
        state["percent"] = 40
        path.write_text(json.dumps(state))
        assert await store.running(job_id)
        return await store.status(job_id)

    state = asyncio.run(scenario())
    assert [stage["id"] for stage in state["stages"]] == [stage["id"] for stage in JobStore._stages()]
    assert "restructure" not in [stage["id"] for stage in state["stages"]]
    assert state["percent"] == 0


def test_request_limiter_serves_urgent_callers_first_and_survives_cancellation():
    from concurrency import RequestLimiter

    async def scenario():
        limiter = RequestLimiter(1)
        served: list[str] = []

        async def use(name: str, priority: int):
            async with limiter.slot(priority):
                served.append(name)
                await asyncio.sleep(0.01)

        async with limiter.slot(1):  # Hold the only slot while others queue up.
            tasks = [
                asyncio.create_task(use("boundary-1", 1)),
                asyncio.create_task(use("boundary-2", 1)),
                asyncio.create_task(use("summary", 0)),
                asyncio.create_task(use("cancelled", 0)),
            ]
            await asyncio.sleep(0.01)
            tasks[3].cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        async with limiter.slot(1):  # The slot is free again (nothing leaked).
            served.append("after")
        return served

    assert asyncio.run(scenario()) == ["summary", "boundary-1", "boundary-2", "after"]
