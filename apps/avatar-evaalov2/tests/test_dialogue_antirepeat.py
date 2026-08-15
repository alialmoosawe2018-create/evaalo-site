"""Anti-repetition guards: no verbatim re-ask + rotated/capped continuation nudges.

Regression tests for a real interview (session AJ_oK8ZEFUjYyHt) where the agent,
faced with short candidate answers, re-asked the identical bank question three
turns running and emitted the exact same "خذ راحتك" nudge five times.
"""

from __future__ import annotations

from voice_interview.active_question import (
    MODE_ASK,
    MODE_WAIT,
    TurnPlan,
)
from voice_interview.assistant import (
    InterviewAssistant,
    TtsRouteContext,
    _max_consecutive_waits,
)
from voice_interview.entity_policy import CONTINUATION_POOL
from voice_interview.heuristics import normalize_text


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _make_assistant(bank: list[str] | None = None) -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(),
        arabic_voice_id="ar",
        english_voice_id="en",
        supports_override=False,
        cooldown_ms=0,
        initial_voice_id="ar",
        initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=bank or [],
        bank_key="test",
        position="HR Business Partner",
        has_domain_guidance=True,
    )


# ── Continuation pool shape ──────────────────────────────────────────────────


def test_continuation_pool_is_statements_with_varied_heads() -> None:
    assert len(CONTINUATION_POOL) >= 3
    # Nudges are statements, never questions (must not read as a new question
    # nor record an opener stem).
    assert all("؟" not in p for p in CONTINUATION_POOL)
    heads = {normalize_text(p).split(" ", 1)[0] for p in CONTINUATION_POOL}
    assert len(heads) >= 3  # distinct openers so pick_varied can rotate


# ── Verbatim re-ask guard ────────────────────────────────────────────────────


def test_record_agent_reply_tracks_last_sent_question() -> None:
    agent = _make_assistant()
    agent._turn_plan = TurnPlan(
        question="شنو أهم مشروع اشتغلت عليه؟", response_mode=MODE_ASK, source="bank"
    )
    agent.record_agent_reply("شنو أهم مشروع اشتغلت عليه؟")
    assert agent._memory.last_sent_question_norm  # non-empty


def test_verbatim_reask_advances_to_next_anchor() -> None:
    a1 = "Walk through an HR process you improved?"
    a2 = "How do you protect confidentiality with employee data?"
    agent = _make_assistant(bank=[a1, a2])
    # a1 was already asked and registered last turn.
    agent._memory.last_sent_question_norm = normalize_text(a1)
    agent._memory.asked_question_keys.add(normalize_text(a1))
    # The decision layer tries to ask a1 again verbatim → must not repeat it.
    out = agent._set_turn_recommendation(a1, source="bank", response_mode=MODE_ASK)
    assert normalize_text(out) != normalize_text(a1)
    assert out == a2  # advanced to the next unused anchor


def test_verbatim_reask_rephrases_when_no_anchor_left() -> None:
    a1 = "Walk through an HR process you improved?"
    agent = _make_assistant(bank=[a1])  # no other anchor to advance to
    agent._memory.last_sent_question_norm = normalize_text(a1)
    agent._memory.asked_question_keys.add(normalize_text(a1))
    out = agent._set_turn_recommendation(a1, source="bank", response_mode=MODE_ASK)
    assert out is not None
    assert normalize_text(out) != normalize_text(a1)  # rephrased, not verbatim


def test_first_ask_is_not_altered() -> None:
    q = "شنو أهم مشروع اشتغلت عليه؟"
    agent = _make_assistant(bank=[q])
    # No prior question → guard must not fire.
    out = agent._set_turn_recommendation(q, source="bank", response_mode=MODE_ASK)
    assert out == q


# ── Continuation nudge: rotation + cap ───────────────────────────────────────


def test_wait_nudge_uses_continuation_pool() -> None:
    agent = _make_assistant()
    agent._memory.consecutive_wait_count = 0
    out = agent._active_question_locked_pick({"is_incomplete_turn": True}, agent._memory, {})
    assert out in CONTINUATION_POOL


def test_wait_nudges_vary_across_turns() -> None:
    agent = _make_assistant()
    mem = agent._memory
    outs = []
    for _ in range(3):
        mem.consecutive_wait_count = 0  # keep under the cap
        outs.append(agent._active_question_locked_pick({"is_incomplete_turn": True}, mem, {}))
    assert len(set(outs)) >= 2  # not the same nudge every time


def test_wait_cap_advances_instead_of_nudging() -> None:
    agent = _make_assistant()
    mem = agent._memory
    mem.consecutive_wait_count = _max_consecutive_waits()
    out = agent._active_question_locked_pick({"is_incomplete_turn": True}, mem, {})
    assert out is None  # cap reached → caller advances to a fresh question


def test_consecutive_wait_count_increments_then_resets() -> None:
    agent = _make_assistant()
    agent._turn_plan = TurnPlan(
        question=None, response_mode=MODE_WAIT, source="wait_for_completion"
    )
    agent.record_agent_reply("خذ راحتك، كمل فكرتك.")
    assert agent._memory.consecutive_wait_count == 1
    agent.record_agent_reply("تمام، أكمل لو سمحت.")
    assert agent._memory.consecutive_wait_count == 2
    # A real question resets the streak.
    agent._turn_plan = TurnPlan(
        question="شنو رأيك؟", response_mode=MODE_ASK, source="bank"
    )
    agent.record_agent_reply("شنو رأيك؟")
    assert agent._memory.consecutive_wait_count == 0
