"""Sliding windows over a model's own earlier answers.

Both analysis steps decide better when they know what was decided before:
Model 0 (event boundaries) sees its earlier new/old verdicts, Model 1
(annotation) sees the depth and summary of the events before the current one.
This module holds the policy shared by both: how big the window may be, and
which of the earlier entries fit. It does no I/O and calls no model.

The window is the smaller of two sizes: what the context buffer leaves after
the fixed prompt and the room reserved for the answer, or everything decided so
far. The newest entries win, so the window "slides" forward with the recording.
"""

import os
from typing import List, Sequence

# Context buffer of the models, in tokens. Keep it at or below what the
# inference server really allows (Ollama's own default is much smaller than
# most models support: raise num_ctx there before raising this).
DEFAULT_CONTEXT_TOKENS = 8192
# Terminal text and JSON tokenize densely; assuming 3 characters per token errs
# on the safe side (a larger estimate means a smaller window, never an overflow).
CHARS_PER_TOKEN = 3
# Room kept free for Model 0's answer (a timestamp and one word, plus slack).
BOUNDARY_ANSWER_TOKENS = 512


def context_tokens() -> int:
    """Size of the context buffer to plan for, from AUTODOCS_CONTEXT_TOKENS."""
    try:
        return max(1024, int(os.getenv("AUTODOCS_CONTEXT_TOKENS", str(DEFAULT_CONTEXT_TOKENS))))
    except ValueError:
        return DEFAULT_CONTEXT_TOKENS


def estimate_tokens(text: str) -> int:
    """Cheap, deliberately pessimistic token count (no tokenizer needed)."""
    return -(-len(text) // CHARS_PER_TOKEN)


def history_budget(prompt_tokens: int, reserved_answer_tokens: int) -> int:
    """Tokens left for earlier answers once the fixed prompt and the answer fit."""
    return max(0, context_tokens() - prompt_tokens - reserved_answer_tokens)


def newest_that_fit(lines: Sequence[str], budget_tokens: int) -> List[str]:
    """The most recent `lines` whose total size fits the budget, oldest first."""
    kept: List[str] = []
    used = 0
    for line in reversed(lines):
        cost = estimate_tokens(line) + 1  # +1: the newline between lines.
        if used + cost > budget_tokens:
            break
        kept.append(line)
        used += cost
    kept.reverse()
    return kept


def boundary_history_enabled(backend: str) -> bool:
    """Whether Model 0 sees its earlier verdicts (AUTODOCS_BOUNDARY_HISTORY).

    `on` and `off` force the choice. `auto` (default) turns it on for the chat
    backend (a general-purpose model that reads any prompt) and off for
    Ollama/llama.cpp, which serve the fine-tuned Model 0 whose training prompt
    had no such section. Because each verdict then depends on the previous one,
    boundary requests run one at a time while it is on.
    """
    setting = os.getenv("AUTODOCS_BOUNDARY_HISTORY", "auto").strip().lower()
    if setting in ("on", "true", "1", "yes"):
        return True
    if setting in ("off", "false", "0", "no"):
        return False
    return backend == "cloudtemple"
