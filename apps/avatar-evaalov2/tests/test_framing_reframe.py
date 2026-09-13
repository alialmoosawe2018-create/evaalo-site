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


# ── 2026-09-12: language and bank anchors ─────────────────────────────────────
# From one Arabic interview (session …1789254551115): the reply guard swapped in
# the English anchor below and it was spoken raw (no «؟», so the framing guard
# never looked), and 5 of 5 rewrites came out MSA or English because the rewrite
# prompt carried no language. The candidate asked «Can you speak in Arabic?».


def _assistant_locked(lang: str, bank: list[str] | None = None) -> InterviewAssistant:
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
        session_language=lang,
        bank_questions=bank or ["شنو قنوات الاستقطاب اللي تعتمد عليها؟"],
        bank_key="test",
        position="Compensation and Benefits Specialist",
        candidate_gender="male",
        has_domain_guidance=True,
        domain_pack_key="hr_recruiter",
    )


ENGLISH_ANCHOR = "Describe a time you improved a process or business outcome."
ENGLISH_FRAMED = (
    "When you have multiple goals that are in conflict, how do you decide which one "
    "comes first? Please explain your thought process."
)


def test_anchor_swap_is_reframed_even_without_a_question_mark():
    agent = _assistant_locked("ar", bank=[ENGLISH_ANCHOR])
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    dup = "شنو المؤشر الأهم اللي تتابعه بعملية التوظيف؟"
    agent._memory.asked_questions.append(dup)
    swapped = agent._guard_repetition_and_language(dup)
    assert "improved a process" in swapped  # the guard swapped in the raw anchor
    seen = _stub_regen(agent, FRAMED)
    out = asyncio.run(agent.reframe_bare_question(swapped))
    assert out == FRAMED
    assert seen == [swapped]


def test_english_reply_under_arabic_lock_is_reframed_even_when_framed():
    agent = _assistant_locked("ar")
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, FRAMED)
    out = asyncio.run(agent.reframe_bare_question(ENGLISH_FRAMED))
    assert out == FRAMED
    assert seen == [ENGLISH_FRAMED]


def test_arabic_with_loanword_under_arabic_lock_is_left_alone():
    agent = _assistant_locked("ar")
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    framed = "بخصوص شغلك على نظام HRIS، أريد مثال محدد. شنو أكثر خطأ صلّحته بملف موظف؟"
    seen = _stub_regen(agent, "SHOULD NOT BE USED")
    assert asyncio.run(agent.reframe_bare_question(framed)) == framed
    assert seen == []  # loanwords are not a language switch


def test_arabic_reply_under_english_lock_is_reframed():
    agent = _assistant_locked("en")
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    english = "About your payroll work, I want one example. What was the hardest correction you made?"
    seen = _stub_regen(agent, english)
    out = asyncio.run(agent.reframe_bare_question(FRAMED))
    assert out == english
    assert seen == [FRAMED]


def test_unlocked_session_does_not_police_language():
    agent = _assistant()  # no session_language → nothing is enforced
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    seen = _stub_regen(agent, FRAMED)
    assert asyncio.run(agent.reframe_bare_question(ENGLISH_FRAMED)) == ENGLISH_FRAMED
    assert seen == []


def test_winddown_line_is_never_reframed():
    agent = _assistant_locked("en")
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    turn = agent._memory.turn_index
    agent._winddown_turn = turn
    agent._winddown_line = "شكراً على وقتك وإجاباتك. أكو شي تحب تضيفه قبل ما نختم المقابلة؟"
    seen = _stub_regen(agent, "SHOULD NOT BE USED")
    out = asyncio.run(agent.reframe_bare_question(agent._winddown_line))
    assert out == agent._winddown_line
    assert seen == []


def test_forced_reframe_ignores_the_mode_exemption():
    """A hybrid-token swap can happen on a follow-up turn; the anchor is no longer an
    echo of the active question, so the mode exemption must not shield it."""
    agent = _assistant_locked("ar", bank=[ENGLISH_ANCHOR])
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_FOLLOW_UP)
    swapped = agent._guard_repetition_and_language("شنو الشي اللي motivatesك بهذا الدور؟")
    assert "improved a process" in swapped
    seen = _stub_regen(agent, FRAMED)
    assert asyncio.run(agent.reframe_bare_question(swapped)) == FRAMED
    assert seen == [swapped]


def test_reframe_messages_carry_the_dialect_and_the_role():
    agent = _assistant_locked("ar")
    msgs = agent._build_reframe_messages(ENGLISH_ANCHOR)
    assert msgs[0][0] == "system"
    assert msgs[-1] == ("user", ENGLISH_ANCHOR)
    system = msgs[0][1]
    assert "IRAQI" in system and "never English" in system
    assert "Compensation and Benefits Specialist" in system
    assert "exactly ONE question" in system
    assert "SAME language as the input" not in system


def test_reframe_messages_english_lock_and_unlocked():
    en = _assistant_locked("en")._build_reframe_messages(FRAMED)[0][1]
    assert "spoken English" in en and "IRAQI" not in en
    unlocked = _assistant()._build_reframe_messages(FRAMED)[0][1]
    assert "SAME language as the input" in unlocked and "IRAQI" not in unlocked


def test_language_mismatch_detector():
    ar = _assistant_locked("ar")
    assert ar.reply_language_mismatch(ENGLISH_ANCHOR) is True
    assert ar.reply_language_mismatch("عندك خبرة في HR و Excel؟") is False
    assert ar.reply_language_mismatch("ok") is False  # too short to judge
    en = _assistant_locked("en")
    assert en.reply_language_mismatch(FRAMED) is True
    assert en.reply_language_mismatch(ENGLISH_ANCHOR) is False
    assert _assistant().reply_language_mismatch(ENGLISH_ANCHOR) is False
