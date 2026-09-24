"""A hard-cap wrap-up counts as offered only once it was recorded as spoken.

Production, first interview after the cap fix: the cap fired, the candidate's
sentence had been split by a short pause, and its second half opened a new turn
1.7 s later — before the reply to the cap turn existed. LiveKit cancelled that
reply: its LLM never finished, so neither guard pass ran and nothing was
recorded. The next turn saw ``wrap_up_offered`` and closed the interview, and
«أكو شي تحب تضيفه؟» was never spoken.

The delivery boundary is ``record_agent_reply``. It runs at the end of
``transcription_node``, which LiveKit creates only after it authorised the reply
(candidate silent, speech scheduled) and which ends when the TTS has produced the
whole transcript. ``tts_node`` is NOT a boundary: it runs as soon as the LLM
finishes, before authorisation, and a reply cancelled then was never played.

Until that record, every new user turn plans the wrap-up again (no competency,
anchor, bank question or follow-up); after it, the next turn closes as before.

Synthetic interview: invented role, competencies and answers.
"""

from __future__ import annotations

import asyncio

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from p4_replay_sessions import _router

from voice_interview.active_question import MODE_ASK, TurnPlan
from voice_interview.assistant import (
    _FINAL_CLOSING_AR,
    _WRAP_UP_PROMPT_AR,
    InterviewAssistant,
    _wrap_up_max_questions,
)

_COMPETENCIES = [
    ("تنظيم الجداول", "اذكرلي موقف رتّبت بيه جدول مزدحم، شلون نظمته؟"),
    ("التواصل مع العملاء", "اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟"),
    ("إدارة المخزون", "اذكرلي مرة نظّمت بيها مخزون، شنو سويت؟"),
    ("السلامة المهنية", "اذكرلي موقف بيه خطر بالموقع، شلون تصرفت؟"),
    ("إعداد التقارير", "اذكرلي تقرير عملته للإدارة، شنو كان محتواه؟"),
    ("حل النزاعات", "اذكرلي خلاف بين زملاء، شلون ساعدت بحله؟"),
    ("الميزانية والمصاريف", "اذكرلي مرة قللت بيها مصاريف، شنو سويت؟"),
    ("تقييم الموردين", "اذكرلي مرة قارنت بين موردين، شلون اخترت؟"),
]
_WITH_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع وكانت النتيجة جيدة وتحسن الأداء "
    "بنسبة عشرين بالمية تقريباً."
)
_NO_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع ورتبت الأمور ويا الفريق خطوة بخطوة "
    "حسب الأولويات المطلوبة يومياً."
)
_DONE = "هذا كلشي عندي، شكراً."
#: The second half of a sentence split by a short pause.
_SPLIT = "وهذا اللي صار بالضبط."
_INCOMPLETE = "يعني اول شي سويت. لان."

#: How far a reply got before the next user turn (LiveKit 1.3 agent_activity.py):
#: "none" — cancelled before the LLM finished (neither guard pass ran);
#: "tts"  — tts_node's guard pass ran, cancelled before authorisation;
#: "full" — authorised: both passes ran and record_agent_reply recorded it.
_NONE, _TTS, _FULL = "none", "tts", "full"


@pytest.fixture(autouse=True)
def _small_cap(monkeypatch):
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MIN_QUESTIONS", "3")
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MAX_QUESTIONS", "6")


def _agent() -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Office Coordinator",
        bank_questions=[],
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "competencyKey": f"k{i}",
                "title": title,
                "priority": "high",
                "questionObjective": objective,
                "expectedEvidence": ["مثال محدد"],
                "followUpRules": ["شنو صار بعدها؟"],
            }
            for i, (title, objective) in enumerate(_COMPETENCIES)
        ],
        career_level="mid",
    )

    async def keep(_bare: str) -> str:
        return ""

    agent._regenerate_framed_question = keep
    return agent


def _turn(agent, told, said: str, stage: str) -> dict:
    told.clear()
    try:
        asyncio.run(
            agent.on_user_turn_completed(
                ChatContext.empty(), ChatMessage(role="user", content=[said])
            )
        )
    except StopResponse:
        return {"silent": True, "plan": None, "heard": None}
    plan = agent._turn_plan
    text = told.get("text") or (plan.question if plan else "") or "شنو تحب تضيف؟"
    row = {"silent": False, "plan": plan, "heard": None}
    if stage == _NONE:
        return row
    first = asyncio.run(
        agent.reframe_bare_question(agent._apply_guard_to_agent_text(text))
    )
    row["tts_chose"] = first
    if stage == _FULL:
        second = asyncio.run(
            agent.reframe_bare_question(agent._apply_guard_to_agent_text(first))
        )
        agent.record_agent_reply(second)
        row["heard"] = first
    return row


def _interview(after_cap: list[tuple[str, str]]):
    """Deliver ordinary turns up to the cap, then play ``after_cap``: (words, stage)."""
    agent = _agent()
    mem = agent._memory
    told: dict[str, str | None] = {}
    wrap = agent._wrap_decision_frame

    def spy(body, diag, m, link_policy, recommended):
        told["text"] = recommended
        return wrap(body, diag, m, link_policy, recommended)

    agent._wrap_decision_frame = spy
    agent.mark_verbatim("حياك الله ألف باء، نبدأ.")
    agent.record_agent_reply("حياك الله ألف باء، نبدأ.")
    try:
        while len(mem.asked_questions) < _wrap_up_max_questions():
            _turn(agent, told, _WITH_RESULT, _FULL)
        before = {
            "attempted": set(mem.asked_competency_keys),
            "delivered": set(mem.delivered_competency_keys),
            "asked": len(mem.asked_questions),
        }
        rows = [_turn(agent, told, said, stage) for said, stage in after_cap]
    finally:
        agent._cancel_wait_timeout()
    return agent, before, rows


# ── The production race ──────────────────────────────────────────────────────


def test_the_production_race_offers_the_wrap_up_again():
    """Cap turn cancelled before its LLM finished; the next turn offers again."""
    agent, _, rows = _interview([(_SPLIT, _NONE), (_DONE, _FULL), (_DONE, _FULL)])
    assert rows[1]["heard"] == _WRAP_UP_PROMPT_AR
    assert rows[2]["heard"] == _FINAL_CLOSING_AR
    assert agent._memory.final_closing_sent is True


def test_a_reply_cancelled_after_the_tts_guard_was_not_delivered():
    """tts_node's guard ran and chose the offer, then LiveKit cancelled the reply
    before authorising it: the offer was never played, so it is offered again."""
    agent, _, rows = _interview([(_SPLIT, _TTS), (_DONE, _FULL), (_DONE, _FULL)])
    assert rows[0]["tts_chose"] == _WRAP_UP_PROMPT_AR
    assert agent._memory.asked_questions.count(_WRAP_UP_PROMPT_AR) == 1
    assert rows[1]["heard"] == _WRAP_UP_PROMPT_AR
    assert rows[2]["heard"] == _FINAL_CLOSING_AR


def test_repeated_interruptions_never_reopen_questioning():
    agent, before, rows = _interview(
        [(_SPLIT, _NONE), (_SPLIT, _NONE), (_SPLIT, _TTS), (_NO_RESULT, _FULL)]
    )
    mem = agent._memory
    # Every turn while the offer is pending plans the wrap-up and nothing else.
    assert [r["plan"] for r in rows] == [None, None, None, None]
    assert rows[3]["heard"] == _WRAP_UP_PROMPT_AR
    assert mem.final_closing_sent is False
    assert mem.asked_competency_keys == before["attempted"]
    assert mem.delivered_competency_keys == before["delivered"]
    assert len(mem.asked_questions) == before["asked"] + 1  # the offer, once


def test_a_cap_reached_on_a_waiting_turn_is_offered_when_the_candidate_speaks():
    """The cap fires on a turn the agent waits out; the candidate speaks again
    before any reply — that turn offers the wrap-up instead of closing."""
    _, _, rows = _interview([(_INCOMPLETE, _FULL), (_DONE, _FULL), (_DONE, _FULL)])
    assert rows[0]["silent"] is True
    assert rows[1]["heard"] == _WRAP_UP_PROMPT_AR
    assert rows[2]["heard"] == _FINAL_CLOSING_AR


# ── Once delivered, Always Close is unchanged ────────────────────────────────


@pytest.mark.parametrize("said", [_DONE, "شنو تقصد بالسؤال بالضبط؟", _NO_RESULT])
def test_a_delivered_cap_offer_still_always_closes(said):
    agent, _, rows = _interview([(_DONE, _FULL), (said, _FULL)])
    assert rows[0]["heard"] == _WRAP_UP_PROMPT_AR
    assert rows[1]["heard"] == _FINAL_CLOSING_AR
    assert agent._memory.final_closing_sent is True


# ── The boundary itself ──────────────────────────────────────────────────────


def _at_cap() -> InterviewAssistant:
    agent = _agent()
    agent._memory.asked_questions.extend(
        f"سؤال سابق رقم {i}؟" for i in range(_wrap_up_max_questions())
    )
    return agent


def test_only_the_record_marks_the_cap_offer_delivered():
    agent = _at_cap()
    mem = agent._memory
    assert agent._pick_recommended_question({}, mem, {}) == _WRAP_UP_PROMPT_AR
    mem.turn_index += 1  # _update_memory_post_decision
    assert agent._guard_repetition_and_language("أي نص") == _WRAP_UP_PROMPT_AR
    assert agent._cap_wrap_up_recorded is False  # the guard pass is not delivery
    agent.record_agent_reply(_WRAP_UP_PROMPT_AR)
    assert agent._cap_wrap_up_recorded is True


def test_the_guard_never_closes_on_an_unrecorded_cap_offer():
    """A turn the picker did not plan (the memo is stale) still re-offers."""
    agent = _at_cap()
    mem = agent._memory
    agent._pick_recommended_question({}, mem, {})
    mem.turn_index += 3  # e.g. turns advanced without this offer being spoken
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    assert agent._guard_repetition_and_language("سؤال جديد؟") == _WRAP_UP_PROMPT_AR
    assert mem.final_closing_sent is False
    assert agent._conclude_after_reply is False


def test_a_guard_wrap_up_is_not_affected():
    """The no-fresh-anchor wrap-up keeps its path: offered in the guard, then the
    next non-tied turn closes; the cap never re-offers over it."""
    agent = _at_cap()
    mem = agent._memory
    mem.wrap_up_offered = True
    agent._wrap_up_trigger = "no_fresh_anchor"
    agent._pick_recommended_question({"is_substantive_answer": True}, mem, {})
    assert agent._wrap_up_trigger == "no_fresh_anchor"
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    assert agent._guard_repetition_and_language("سؤال جديد؟") == _FINAL_CLOSING_AR
