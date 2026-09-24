"""The late guard pass never offers a wrap-up the candidate did not hear.

Every spoken turn runs the reply guard twice: tts_node on the model's text, then
transcription_node on the text the TTS actually spoke, and only then the record.
The reframe claims the turn on the first pass (``_speech_fixed``), so whatever
the second pass returns, the candidate hears the first pass's line.

When the reframe's REWRITE of an ordinary question tripped a detector on the
second pass — a presupposition, a hybrid token, or a duplicate P4 could not
replace — that pass reached the wrap-up branch once ten agent lines were
recorded, and wrote an offer nobody heard into memory: ``wrap_up_offered``, the
wind-down line, ``asked_questions`` and the turn log. The next turn that was not
tied to the active question then got the final closing: the interview ended
without the candidate ever hearing «أكو شي تحب تضيفه؟», with competencies of the
blueprint still unasked. Found by reading the code and reproduced here; none of
the measured interviews hit it.

The other things that late pass can still do (an anchor or a bridge nobody
hears, a duplicate swapped for a competency) are separate items and are not
covered here.

Synthetic interview: invented role, competencies, answers and rewrites.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from p4_replay_sessions import _router

from voice_interview.active_question import MODE_ASK, TurnPlan
from voice_interview.assistant import (
    _FINAL_CLOSING_AR,
    _WRAP_UP_PROMPT_AR,
    InterviewAssistant,
)
from voice_interview.turn_log import TurnLogSink

_COMPETENCIES = [
    ("تنظيم الجداول", "اذكرلي موقف رتّبت بيه جدول مزدحم، شلون نظمته؟"),
    ("التواصل مع العملاء", "اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟"),
    ("إدارة المخزون", "اذكرلي مرة نظّمت بيها مخزون، وشنو كانت النتيجة؟"),
    ("السلامة المهنية", "اذكرلي موقف بيه خطر بالموقع، شلون تصرفت؟"),
    ("إعداد التقارير", "اذكرلي تقرير عملته للإدارة، شنو كان محتواه؟"),
    ("إدارة الوقت", "اذكرلي يوم كان بيه ضغط شغل كبير، شلون رتبت أولوياتك؟"),
    ("حل النزاعات", "اذكرلي خلاف بين زملاء، شلون ساعدت بحله؟"),
    ("التدريب والتطوير", "اذكرلي مرة دربت بيها موظف جديد، شلون كانت الطريقة؟"),
    ("الميزانية والمصاريف", "اذكرلي مرة قللت بيها مصاريف، شنو كان الأثر؟"),
    ("تقييم الموردين", "اذكرلي مرة قارنت بين موردين، شلون اخترت؟"),
    ("إدارة سجلات التوريد", "اذكرلي مرة رتبت بيها سجلات توريد، شلون ضبطتها؟"),
    ("خدمة ما بعد البيع", "اذكرلي عميل رجع بشكوى بعد البيع، شلون تعاملت؟"),
    ("التفاوض ويا الشركاء", "اذكرلي مرة تفاوضت ويا شريك عمل، شلون وصلتوا لاتفاق؟"),
    ("متابعة العقود", "اذكرلي عقد تابعت تنفيذه، شلون ضمنت الالتزام؟"),
    ("جودة المنتج", "اذكرلي مشكلة جودة لاحظتها بمنتج، شلون تعاملت وياها؟"),
]
_GREETING = "حياك الله ألف باء، نبدأ من خبرتك العملية."
# States an outcome, so no result follow-up is due: every turn asks the next
# competency, and the tenth agent line is reached on the tenth question.
_ANSWER = (
    "بشركتي السابقة كان عندي دور بهالموضوع وكانت النتيجة جيدة وتحسن الأداء "
    "بنسبة عشرين بالمية تقريباً."
)


@pytest.fixture(autouse=True)
def _production_thresholds(monkeypatch):
    """Production's values (no override is deployed). ``config.py`` loads a local
    ``.env.local`` over the environment, so both are pinned: a lower hard cap
    (MAX) would end these interviews before the tenth line."""
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MIN_QUESTIONS", "10")
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MAX_QUESTIONS", "20")


def _presupposing(agent: InterviewAssistant, bare: str) -> str:
    return "بخصوص شغلك اليومي، " + bare.rstrip("؟?") + "، وشنو الخطوات اللي سويتها؟"


def _hybrid(agent: InterviewAssistant, bare: str) -> str:
    return "بخصوص شغلك ويا نظام الـERP وHRIS، " + bare  # noqa: RUF001 — the token


def _repeat(agent: InterviewAssistant, bare: str) -> str:
    return agent._memory.asked_questions[-1]


#: (rewrite, blueprint size). Fifteen competencies leave five unasked at the
#: tenth line; with ten, P4 has nothing left to put in a duplicate's place.
_CASES = {
    "presupposing": (_presupposing, 15),
    "hybrid": (_hybrid, 15),
    "duplicate": (_repeat, 10),
}


@dataclass
class _Turn:
    turn: int
    plan: TurnPlan | None
    spoken: str = ""
    recorded: str = ""
    rewrite: str = ""  # what the reframe returned on this turn, if anything
    silent: bool = False


def _agent(size: int) -> InterviewAssistant:
    agent = InterviewAssistant(
        tts_router=_router(),
        session_language="ar",
        position="Office Coordinator",
        bank_questions=[],
        bank_key="blueprint",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "competencyKey": f"k{i:02d}",
                "title": title,
                "priority": "high",
                "questionObjective": objective,
                "expectedEvidence": ["مثال محدد"],
                "followUpRules": ["شنو صار بعدها؟"],
            }
            for i, (title, objective) in enumerate(_COMPETENCIES[:size])
        ],
        career_level="mid",
    )
    agent._turn_log_sink = TurnLogSink(object())
    return agent


def _reply(agent: InterviewAssistant, model_text: str) -> tuple[str, str]:
    """Production's order: tts_node's pass is heard, transcription_node's is recorded."""
    spoken = asyncio.run(
        agent.reframe_bare_question(agent._apply_guard_to_agent_text(model_text))
    )
    recorded = asyncio.run(
        agent.reframe_bare_question(agent._apply_guard_to_agent_text(spoken))
    )
    agent.record_agent_reply(recorded)
    return spoken, recorded


def _interview(
    size: int, rewrite, *, model_repeats: bool = False, after: int = 2
) -> tuple[InterviewAssistant, list[_Turn], int]:
    """Run until ``after`` turns past the first reply with ten lines recorded.

    That reply is the target: the reframe rewrites it with ``rewrite`` (or, with
    ``model_repeats``, the model itself repeats the last question and nothing is
    rewritten). Every other reply is the plan's own question, kept as written.
    """
    agent = _agent(size)
    mem = agent._memory
    target: dict[str, int | None] = {"turn": None}
    rewrites: dict[int, str] = {}

    async def reword(bare: str) -> str:
        if mem.turn_index == target["turn"] and not model_repeats:
            rewrites[mem.turn_index] = rewrite(agent, bare)
            return rewrites[mem.turn_index]
        return ""

    agent._regenerate_framed_question = reword
    agent.mark_verbatim(_GREETING)
    agent.record_agent_reply(_GREETING)
    turns: list[_Turn] = []
    try:
        for _ in range(40):
            try:
                asyncio.run(
                    agent.on_user_turn_completed(
                        ChatContext.empty(),
                        ChatMessage(role="user", content=[_ANSWER]),
                    )
                )
            except StopResponse:
                turns.append(_Turn(mem.turn_index, None, silent=True))
                break
            if target["turn"] is None and len(mem.asked_questions) >= 10:
                target["turn"] = mem.turn_index
            plan = agent._turn_plan
            model_text = (plan.question if plan else "") or "شنو تحب تضيف؟"
            if model_repeats and mem.turn_index == target["turn"]:
                model_text = mem.asked_questions[-1]
            spoken, recorded = _reply(agent, model_text)
            turns.append(
                _Turn(
                    mem.turn_index,
                    plan,
                    spoken,
                    recorded,
                    rewrites.get(mem.turn_index, ""),
                )
            )
            if target["turn"] is not None and mem.turn_index >= target["turn"] + after:
                break
    finally:
        agent._cancel_wait_timeout()
    assert target["turn"] is not None
    return agent, turns, target["turn"]


def _at(turns: list[_Turn], turn: int) -> _Turn:
    return next(t for t in turns if t.turn == turn)


def _record_for(agent: InterviewAssistant, turn: int) -> dict:
    return next(r for r in agent._turn_log_sink.records if r["turnIndex"] == turn)


# ── The late pass leaves the heard line alone ────────────────────────────────


@pytest.mark.parametrize("case", sorted(_CASES))
def test_the_late_pass_never_offers_a_wrap_up_nobody_heard(case):
    rewrite, size = _CASES[case]
    agent, turns, target = _interview(size, rewrite, after=0)  # state right after it
    mem = agent._memory
    t = _at(turns, target)

    # What the candidate heard is the rewrite, and it is what was recorded.
    assert t.rewrite
    assert t.spoken == t.rewrite
    assert t.recorded == t.spoken
    assert t.spoken in mem.asked_questions

    # Nothing of the unheard offer reached memory or the turn log.
    assert mem.wrap_up_offered is False
    assert agent._winddown_line is None
    assert _WRAP_UP_PROMPT_AR not in mem.asked_questions
    assert _WRAP_UP_PROMPT_AR not in mem.coverage_evidence
    record = _record_for(agent, target)
    assert record["guardSwap"] is None
    assert t.spoken.startswith(record["spokenText"].rstrip("…"))


@pytest.mark.parametrize("case", sorted(_CASES))
def test_the_interview_is_not_closed_on_an_offer_nobody_heard(case):
    rewrite, size = _CASES[case]
    agent, turns, target = _interview(size, rewrite)
    mem = agent._memory
    nxt = _at(turns, target + 1)

    assert not nxt.silent
    assert nxt.spoken != _FINAL_CLOSING_AR
    assert mem.final_closing_sent is False
    assert agent._conclude_after_reply is False
    # Every wrap-up offer in memory was heard on the turn it was offered.
    for t in turns:
        if t.recorded == _WRAP_UP_PROMPT_AR:
            assert t.spoken == _WRAP_UP_PROMPT_AR, t.turn


@pytest.mark.parametrize("case", ["presupposing", "hybrid"])
def test_the_next_unasked_competency_is_asked_after_the_late_flag(case):
    """Five competencies were still unasked: the interview goes on to them."""
    rewrite, size = _CASES[case]
    agent, turns, target = _interview(size, rewrite)
    mem = agent._memory

    heard = _at(turns, target)
    assert heard.plan.competency_key == "k09"
    assert "k09" in mem.delivered_competency_keys  # its rewrite was spoken

    nxt = _at(turns, target + 1)
    assert nxt.plan.source == "competency_engine"
    assert nxt.plan.competency_key == "k10"
    assert nxt.spoken == nxt.plan.question
    assert mem.wrap_up_offered is False


@pytest.mark.parametrize("case", sorted(_CASES))
def test_the_late_flag_moves_no_bridge_rotation(case):
    """The late pass returns the heard line as is: no bridge is picked instead."""
    rewrite, size = _CASES[case]
    agent, _turns, target = _interview(size, rewrite, after=0)
    assert agent._memory.template_rotation == 0
    assert _record_for(agent, target)["guardSwap"] is None


# ── The real wrap-up is untouched ────────────────────────────────────────────


def test_a_wrap_up_decided_before_the_speech_is_fixed_is_heard_and_closes_next():
    """The model itself repeats a question with nothing left for P4: the FIRST
    pass offers the wrap-up, the candidate hears it, and the next turn closes."""
    agent, turns, target = _interview(10, _repeat, model_repeats=True, after=1)
    mem = agent._memory

    offer = _at(turns, target)
    assert offer.spoken == _WRAP_UP_PROMPT_AR
    assert offer.recorded == _WRAP_UP_PROMPT_AR
    assert _record_for(agent, target)["guardSwap"]["to"] == "wrap_up"

    closing = _at(turns, target + 1)
    assert closing.spoken == _FINAL_CLOSING_AR
    assert mem.final_closing_sent is True
    assert agent._conclude_after_reply is True


# ── The gate is this turn's fixed speech, nothing wider ─────────────────────


def _guard_at_threshold() -> InterviewAssistant:
    agent = _agent(10)
    mem = agent._memory
    mem.asked_competency_keys.update(f"k{i:02d}" for i in range(10))
    mem.asked_questions.extend(f"سؤال سابق رقم {i}؟" for i in range(10))
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    return agent


def test_the_gate_is_the_fixed_speech_of_this_turn():
    repeat = "سؤال سابق رقم 9؟"

    fixed = _guard_at_threshold()
    turn = fixed._memory.turn_index
    fixed._reframe_turn = turn
    assert fixed._guard_repetition_and_language(repeat) == repeat
    assert fixed._memory.wrap_up_offered is False
    assert fixed._winddown_line is None

    earlier = _guard_at_threshold()
    earlier._memory.turn_index = 5
    earlier._reframe_turn = 4  # the previous turn's claim, not this one's
    assert earlier._guard_repetition_and_language(repeat) == _WRAP_UP_PROMPT_AR
    assert earlier._memory.wrap_up_offered is True

    unclaimed = _guard_at_threshold()
    assert unclaimed._guard_repetition_and_language(repeat) == _WRAP_UP_PROMPT_AR
    assert unclaimed._memory.wrap_up_offered is True
