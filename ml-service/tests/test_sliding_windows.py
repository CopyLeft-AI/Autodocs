"""Sliding windows over earlier answers: sizing, Model 0 verdict history, Model 1 neighbors."""

import asyncio
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import context_window
import model0
import model1


def chunks(count: int) -> list[model0.Chunk]:
    return [model0.Chunk(ts=f"{n}.0", text=f'<system_output timestamp="{n}.0">line {n}</system_output>') for n in range(count)]


# --- window sizing ---------------------------------------------------------

def test_newest_entries_win_and_order_is_kept():
    lines = [f"entry {n}" for n in range(20)]
    kept = context_window.newest_that_fit(lines, budget_tokens=15)
    assert kept == lines[-len(kept):] and kept[-1] == "entry 19" and 0 < len(kept) < 20


def test_window_is_everything_when_it_fits_and_empty_without_budget():
    lines = ["a", "b", "c"]
    assert context_window.newest_that_fit(lines, 1000) == lines
    assert context_window.newest_that_fit(lines, 0) == []
    assert context_window.newest_that_fit([], 100) == []


def test_budget_shrinks_with_prompt_and_never_goes_negative(monkeypatch):
    monkeypatch.setenv("AUTODOCS_CONTEXT_TOKENS", "4096")
    assert context_window.history_budget(1000, 500) == 2596
    assert context_window.history_budget(9000, 500) == 0


def test_bad_context_setting_falls_back(monkeypatch):
    monkeypatch.setenv("AUTODOCS_CONTEXT_TOKENS", "lots")
    assert context_window.context_tokens() == context_window.DEFAULT_CONTEXT_TOKENS


@pytest.mark.parametrize("setting,backend,expected", [
    (None, "cloudtemple", True), (None, "ollama", False), (None, "llamacpp", False),
    ("on", "ollama", True), ("off", "cloudtemple", False), ("auto", "cloudtemple", True),
])
def test_boundary_history_switch(monkeypatch, setting, backend, expected):
    if setting is None:
        monkeypatch.delenv("AUTODOCS_BOUNDARY_HISTORY", raising=False)
    else:
        monkeypatch.setenv("AUTODOCS_BOUNDARY_HISTORY", setting)
    assert context_window.boundary_history_enabled(backend) is expected


# --- Model 0 ---------------------------------------------------------------

def test_prompt_without_decisions_is_unchanged():
    assert "EARLIER DECISIONS" not in model0.build_prompt(chunks(5), 4)
    assert "EARLIER DECISIONS" not in model0.build_prompt(chunks(5), 0, [])


def test_prompt_lists_earlier_verdicts_before_the_target():
    prompt = model0.build_prompt(chunks(5), 3, [True, False, False])
    section = prompt.split("### EARLIER DECISIONS")[1].split("### TARGET LINE")[0]
    assert "0.0 new event\n1.0 old event\n2.0 old event" in section
    assert "3.0 " not in section  # the target itself is never listed


def test_prompt_verdict_window_slides_when_budget_is_small(monkeypatch):
    many = chunks(400)
    monkeypatch.setenv("AUTODOCS_CONTEXT_TOKENS", "3000")
    prompt = model0.build_prompt(many, 399, [False] * 399)
    section = prompt.split("### EARLIER DECISIONS")[1].split("### TARGET LINE")[0]
    assert section.rstrip().endswith("398.0 old event") and "\n0.0 old event" not in section and "\n1.0 old event" not in section
    assert model0.estimate_tokens(prompt) <= 3000


def run_stream(monkeypatch, mode: str, count: int = 6):
    monkeypatch.setenv("AUTODOCS_BOUNDARY_HISTORY", mode)
    seen: list[str] = []

    async def fake_classify(client, prompt):
        seen.append(prompt)
        return "new" if len(seen) % 3 == 1 else "old"

    monkeypatch.setattr(model0, "classify_chunk", fake_classify)

    async def collect():
        return [item async for item in model0.stream_boundary_decisions(chunks(count), None, concurrency=4)]

    return asyncio.run(collect()), seen


def test_history_mode_feeds_each_verdict_into_the_next_prompt(monkeypatch):
    results, seen = run_stream(monkeypatch, "on")
    assert [r[2] for r in results] == [True, False, False, True, False, False]
    assert "EARLIER DECISIONS" not in seen[0]
    assert "0.0 new event\n1.0 old event" in seen[2]
    assert "3.0 new event" in seen[5]


def test_history_mode_forces_one_request_at_a_time(monkeypatch):
    monkeypatch.setenv("AUTODOCS_BOUNDARY_HISTORY", "on")
    assert model0.boundary_concurrency(8) == 1


def test_history_off_keeps_parallel_requests_and_old_prompts(monkeypatch):
    monkeypatch.setenv("AUTODOCS_BOUNDARY_HISTORY", "off")
    monkeypatch.setenv("AUTODOCS_INFERENCE_LOCATION", "remote")
    assert model0.boundary_concurrency(8) == 8
    _, seen = run_stream(monkeypatch, "off")
    assert all("EARLIER DECISIONS" not in prompt for prompt in seen)


# --- Model 1 ---------------------------------------------------------------

def annotated(count: int) -> list[model1.Event]:
    return [model1.Event(idx=n, xml=f"<event>{n}</event>", depth_xml=0, summary_xml=f"Step {n}") for n in range(count)]


def test_instruction_contains_neighbor_tail_only_when_there_are_neighbors():
    events = annotated(4)
    alone = model1.build_instruction(model1.make_flush_package(events, 0, neighbor_budget_tokens=500))
    assert "<neighbor_tail>" not in alone
    with_tail = model1.build_instruction(model1.make_flush_package(events, 3, neighbor_budget_tokens=500))
    assert "- id=0 depth=0  summary=Step 0" in with_tail and "- id=2 depth=0  summary=Step 2" in with_tail
    tail = with_tail.split("<neighbor_tail>")[1].split("</neighbor_tail>")[0]
    assert "id=3" not in tail  # the target is not its own neighbor


def test_neighbor_window_is_sized_by_budget_not_a_fixed_count():
    events = annotated(200)
    small = model1.make_flush_package(events, 199, neighbor_budget_tokens=60)["neighbor_info"]
    large = model1.make_flush_package(events, 199, neighbor_budget_tokens=100000)["neighbor_info"]
    assert 0 < len(small) < 20 and small[-1].startswith("- id=198")
    assert len(large) == 199  # everything so far, more than the old limit of 10


def test_annotate_one_sends_earlier_summaries_and_shrinks_on_overflow(monkeypatch):
    monkeypatch.setattr(model1, "MAX_NEW_TOKENS", 100)
    events = annotated(600)
    sizes: list[int] = []

    async def fake_generate(client, instruction):
        sizes.append(instruction.count("summary=Step"))
        if len(sizes) == 1:
            request = httpx.Request("POST", "http://x")
            raise httpx.HTTPStatusError("too long", request=request, response=httpx.Response(400, request=request, text="context length exceeded"))
        return '{"annotation": "Did it", "depth": 0}'

    monkeypatch.setattr(model1, "generate", fake_generate)
    result = asyncio.run(model1.annotate_one(events, 599, None))
    assert result == {"depth": 0, "summary": "Did it"}
    assert sizes[0] > sizes[1] > 0  # window halved after the overflow
