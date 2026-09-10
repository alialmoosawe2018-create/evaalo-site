"""Detect a question delivered without the framing sentence the prompt demands.

⚠️ 2026-09-10, from real interviews: the agent's question was sometimes unclear
enough that the candidate had to ask «شنو تقصدين؟».

The instruction was never missing. `assistant.py` already demands a framing
sentence *"so the candidate never has to ask شنو تقصدين؟"*, and
`active_question.py` was already patched once to stop STRIPPING that framing.
What nothing did was check the framing EXISTS. Two paths still deliver a bare
question:

  1. the model skips the lead-in, and a single-question turn passes through
     `enforce_single_question_response` untouched (it only trims EXTRA
     questions); and
  2. the reply-guard swaps a duplicate/presupposing question for a raw bank
     anchor — and the bank is context-free one-liners such as
     "How do you decide what to prioritize when goals conflict?", handed over
     without ever meeting the model's framing instruction.

Path 2 explains the "sometimes": the question reads well when the model wrote
it, and bare when the guard replaced it.

⚠️ Deliberately narrow. It fires only on a SINGLE interrogative sentence with no
sentence before it — exactly the shape `assistant.py` calls "not acceptable". It
does NOT try to judge whether a lead-in is *good*; that is the model's job. A
cheap structural test that never misfires is worth more here than a clever one
that sometimes rejects a fine question, because every hit costs a regeneration
and a regeneration costs interview latency.
"""

from __future__ import annotations

import re

# A sentence boundary that is not the question itself. Arabic full stop is the
# same "." as Latin; "؛" is the Arabic semicolon. A comma (، or ,) is NOT here on
# purpose: "price, quality, delivery time" is one bare sentence carrying a list,
# not a framed question, and the prompt's bar is two-to-three SENTENCES.
_TERMINATOR_RE = re.compile(r"[.!؟?؛]")

_QUESTION_MARK_RE = re.compile(r"[؟?]")

# Bare acknowledgments the prompt already allows before a question. They name
# nothing concrete, so a turn that opens with one is still an unframed question.
# Matched only at the very start, followed by a comma or space.
_ACK_PREFIX_RE = re.compile(
    r"^\s*(?:تمام|طيب|زين|أوكي|اوكي|حسناً|حسنا|ok|okay|alright|great|thanks|thank you|understood|sure)"
    r"\s*[،,]?\s*",
    re.IGNORECASE,
)


def needs_framing(text: str | None) -> bool:
    """True when `text` is a question with no sentence framing it.

    Caller is responsible for restricting this to turns that ASK something new —
    clarify and follow-up intentionally echo the active question and must never
    be judged by it.
    """
    raw = (text or "").strip()
    if not raw:
        return False

    # Nothing to frame if the turn does not ask anything.
    if not _QUESTION_MARK_RE.search(raw):
        return False

    # An opening acknowledgment is not framing — strip it before measuring, or
    # "تمام، شنو أكثر تحدي؟" would read as two segments and pass.
    body = _ACK_PREFIX_RE.sub("", raw, count=1).strip()
    if not body:
        return False

    # Framed when SOME sentence ends before the final one. Count terminators and
    # ignore the last, which closes the question itself.
    terminators = _TERMINATOR_RE.findall(body)
    return len(terminators) <= 1
