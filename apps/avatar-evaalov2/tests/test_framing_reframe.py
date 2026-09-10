"""Wiring for the framing guard: a bare question is regenerated, once per turn.

⚠️ The one that matters: ``_apply_guard_to_agent_text`` runs TWICE per turn —
once from ``transcription_node`` and once from ``tts_node``. If the reframe ran
on both, the interview would pay two LLM round-trips and, worse, the SPOKEN
question and the RECORDED transcript could differ — and the recorded one is what
the evaluation scores. So the result is memoised per ``turn_index``, the same way
the wind-down state machine already is.

The candidate never reads the chat in production (transcript is a dev-only
surface), so audio and the recorded transcript are the two things that must
agree. They both come from this method.

Run: uv run pytest tests/test_framing_reframe.py
"""

from __future__ import annotations

import asyncio

from voice_interview.active_question import (
    MODE_ASK,
    MODE_CLARIFY,
    MODE_FOLLOW_UP,
    TurnPlan,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext


class _StubTts:
    def update_options(self, **kwargs):
        pass


def _assistant() -> InterviewAssistant:
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
        bank_questions=["شنو قنوات الاستقطاب اللي تعتمد عليها؟"],
        bank_key="test",
        position="HR Recruiter",
        candidate_gender="female",
        has_domain_guidance=True,
        domain_pack_key="hr_recruiter",
    )


def _stub_regen(agent: InterviewAssistant, reply: str) -> list[str]:
    """Replace the LLM round-trip; return the list of inputs it was called with."""
    seen: list[str] = []

    async def _fake(bare: str) -> str:
        seen.append(bare)
        return reply

    agent._regenerate_framed_question = _fake  # type: ignore[method-assign]
    return seen


FRAMED = "بخصوص شغلك بالفرز، أريد مثال محدد. شنو أكثر موقف صعب مرّ عليك؟"
BARE = "شلون تستخدم البيانات؟"


def test_bare_ask_question_is_regenerated():
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, FRAMED)
    out = asyncio.run(agent.reframe_bare_question(BARE))
    assert out == FRAMED
    assert seen == [BARE]


def test_already_framed_question_is_left_alone():
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, "SHOULD NOT BE USED")
    out = asyncio.run(agent.reframe_bare_question(FRAMED))
    assert out == FRAMED
    assert seen == []  # no LLM round-trip for a question that is already clear


def test_clarify_and_followup_are_never_reframed():
    for mode in (MODE_CLARIFY, MODE_FOLLOW_UP):
        agent = _assistant()
        agent._turn_plan = TurnPlan(question="", response_mode=mode)
        seen = _stub_regen(agent, FRAMED)
        out = asyncio.run(agent.reframe_bare_question(BARE))
        assert out == BARE, f"{mode} intentionally echoes the active question"
        assert seen == []


def test_regenerates_at_most_once_per_turn():
    """The guard runs twice a turn; the second call must reuse the first result."""
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, FRAMED)

    async def _twice() -> tuple[str, str]:
        first = await agent.reframe_bare_question(BARE)
        second = await agent.reframe_bare_question(BARE)
        return first, second

    first, second = asyncio.run(_twice())
    assert first == second == FRAMED
    assert len(seen) == 1, "a second LLM round-trip in the same turn"


def test_a_new_turn_reframes_again():
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, FRAMED)

    async def _two_turns() -> None:
        await agent.reframe_bare_question(BARE)
        agent._memory.turn_index += 1
        await agent.reframe_bare_question(BARE)

    asyncio.run(_two_turns())
    assert len(seen) == 2


def test_failed_regeneration_keeps_the_original():
    """A dead LLM must never take the interview down with it."""
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)

    async def _boom(bare: str) -> str:
        raise RuntimeError("llm unreachable")

    agent._regenerate_framed_question = _boom  # type: ignore[method-assign]
    out = asyncio.run(agent.reframe_bare_question(BARE))
    assert out == BARE


def test_empty_regeneration_keeps_the_original():
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    _stub_regen(agent, "   ")
    out = asyncio.run(agent.reframe_bare_question(BARE))
    assert out == BARE


def test_regeneration_is_trimmed_to_a_single_question():
    """The rewrite must not smuggle in a second question."""
    agent = _assistant()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    _stub_regen(agent, "بخصوص شغلك بالفرز. شنو أكثر موقف صعب؟ وشلون تعاملت وياه؟")
    out = asyncio.run(agent.reframe_bare_question(BARE))
    assert out.count("؟") == 1
