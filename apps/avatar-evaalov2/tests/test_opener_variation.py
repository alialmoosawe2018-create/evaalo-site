"""Tests for opener-stem tracking and the varied-question picker (Layers 1-2)."""

from __future__ import annotations

from voice_interview.active_question import (
    MODE_ASK,
    MODE_WAIT,
    TurnPlan,
    _question_stem,
    make_bank_question_id,
)
from voice_interview.assistant import (
    InterviewAssistant,
    InterviewMemory,
    TtsRouteContext,
)
from voice_interview.entity_policy import (
    DIFFICULTY_FOLLOWUP_POOL,
    ENTITY_APPLY_POOL,
    pick_varied,
)
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
        position="Petroleum Engineer",
        has_domain_guidance=True,
    )


def test_question_stem_first_token_ar_en() -> None:
    assert _question_stem("شنو استخدمت من أدوات؟") == "شنو"
    assert _question_stem("بخصوص LinkedIn، شلون تواصلت؟") == "بخصوص"
    assert _question_stem("How did you handle it?") == "how"
    assert _question_stem("") == ""


def test_record_agent_reply_tracks_opener_stems() -> None:
    agent = _make_assistant()
    agent._turn_plan = TurnPlan(
        question="شنو استخدمت؟", response_mode=MODE_ASK, source="bank"
    )
    agent.record_agent_reply("شنو استخدمت من أدوات؟")
    assert agent._memory.recent_opener_stems == ["شنو"]

    agent._turn_plan = TurnPlan(
        question="احچيلي عن مرّة؟", response_mode=MODE_ASK, source="bank"
    )
    agent.record_agent_reply("احچيلي عن مرّة صعبة؟")
    assert agent._memory.recent_opener_stems == ["شنو", "احچيلي"]


def test_recent_opener_stems_fifo_cap_3() -> None:
    mem = InterviewMemory()
    for s in ["a", "b", "c", "d"]:
        mem.record_opener_stem(s)
    assert mem.recent_opener_stems == ["b", "c", "d"]


def test_wait_reply_records_no_stem() -> None:
    agent = _make_assistant()
    agent._turn_plan = TurnPlan(
        question=None, response_mode=MODE_WAIT, source="wait_for_completion"
    )
    agent.record_agent_reply("أكيد، خذ راحتك وكمل فكرتك.")
    assert agent._memory.recent_opener_stems == []


# ── Layer 5: sent question is registered immediately, never re-asked ─────────


def test_sent_bank_anchor_not_reselected_even_if_left_open() -> None:
    a1 = "شنو أهم مشروع اشتغلت عليه؟"
    a2 = "شلون تتعامل مع ضغط الوقت؟"
    agent = _make_assistant(bank=[a1, a2])

    # Send anchor 1 with an ASK plan, but never close it (answer stays "open").
    agent._turn_plan = TurnPlan(
        question=a1,
        response_mode=MODE_ASK,
        source="bank",
        question_id=make_bank_question_id("default", normalize_text(a1)[:80]),
    )
    agent.record_agent_reply(a1)

    # Registered at send time regardless of open/closed status.
    assert normalize_text(a1) in agent._memory.asked_question_keys
    assert agent._memory.active_question_status  # still open (never answered)

    # The next anchor pick must move on to a2, not loop back to a1.
    nxt = agent._pick_next_bank_anchor()
    assert nxt == a2
    # And a1 must never come back even after a2 is also consumed.
    agent._memory.asked_question_keys.add(normalize_text(a2))
    assert agent._pick_next_bank_anchor() is None


# ── Layer 1: varied phrasing picker (behavioural / situational) ──────────────


def test_pick_varied_fills_placeholder_and_ends_with_question() -> None:
    q = pick_varied(ENTITY_APPLY_POOL, InterviewMemory(), key="GPS")
    assert "GPS" in q
    assert q.endswith("؟")


def test_pick_varied_avoids_recent_openers_across_turns() -> None:
    mem = InterviewMemory()
    picks = []
    for _ in range(3):
        q = pick_varied(ENTITY_APPLY_POOL, mem, key="GPS")
        picks.append(q)
        mem.record_opener_stem(_question_stem(q))  # simulate the turn recording it
    stems = [_question_stem(p) for p in picks]
    assert len(set(stems)) == 3  # three distinct openers, no repeat head
    assert all("GPS" in p for p in picks)


def test_pick_varied_produces_situational_and_behavioural() -> None:
    mem = InterviewMemory()
    seen = set()
    for _ in range(5):
        q = pick_varied(ENTITY_APPLY_POOL, mem, key="Excel")
        seen.add(_question_stem(q))
        mem.record_opener_stem(_question_stem(q))
    assert "لو" in seen  # situational opener surfaced
    assert len(seen & {"احچيلي", "خذني", "شنو", "وين"}) >= 1  # behavioural too


def test_pick_varied_empty_pool_returns_empty() -> None:
    assert pick_varied([], InterviewMemory()) == ""


def test_pick_varied_difficulty_pool_no_placeholder() -> None:
    q = pick_varied(DIFFICULTY_FOLLOWUP_POOL, InterviewMemory())
    assert q in DIFFICULTY_FOLLOWUP_POOL
    assert q.endswith("؟")
