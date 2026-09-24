"""At the hard question cap the candidate HEARS the wrap-up offer, then the interview closes.

``_pick_recommended_question`` offers the wrap-up once ``asked_questions`` reaches
``_wrap_up_max_questions()``. It runs inside ``on_user_turn_completed``, before
``_update_memory_post_decision`` advances ``turn_index``, and it used to stamp the
wind-down memo with that OLD index. The reply is guarded at the new index, so the
memo never matched: the post-wrap-up branch replaced the reply with the final
closing on the cap turn itself, and «أكو شي تحب تضيفه؟» was never spoken. With the
single decision pick the cap turn has no plan at all, so this happened on EVERY
cap turn.

After the cap's offer there is no "tied to the active question" exception: that
turn carries no plan, so the active question is still the last competency's, and
the exception let a clarification of THAT question, or a result follow-up on it,
be asked after «أكو شي تحب تضيفه؟». The next turn is the final closing.

Every boundary here is read from ``_wrap_up_max_questions()``; nothing assumes 20.
Synthetic interview: invented role, competencies and answers.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.agents.llm.tool_context import StopResponse
from p4_replay_sessions import _router

from voice_interview.active_question import MODE_ASK, MODE_FOLLOW_UP, TurnPlan
from voice_interview.assistant import (
    _FINAL_CLOSING_AR,
    _WRAP_UP_PROMPT_AR,
    InterviewAssistant,
    _wrap_up_max_questions,
)
from voice_interview.turn_log import TurnLogSink

_COMPETENCIES = [
    ("تنظيم الجداول", "اذكرلي موقف رتّبت بيه جدول مزدحم، شلون نظمته؟"),
    ("التواصل مع العملاء", "اذكرلي موقف تواصلت بيه ويا عميل زعلان، شلون تعاملت وياه؟"),
    ("إدارة المخزون", "اذكرلي مرة نظّمت بيها مخزون، شنو سويت؟"),
    ("السلامة المهنية", "اذكرلي موقف بيه خطر بالموقع، شلون تصرفت؟"),
    ("إعداد التقارير", "اذكرلي تقرير عملته للإدارة، شنو كان محتواه؟"),
    ("حل النزاعات", "اذكرلي خلاف بين زملاء، شلون ساعدت بحله؟"),
    ("الميزانية والمصاريف", "اذكرلي مرة قللت بيها مصاريف، شنو سويت؟"),
    ("تقييم الموردين", "اذكرلي مرة قارنت بين موردين، شلون اخترت؟"),
    ("التدريب والتطوير", "اذكرلي مرة دربت بيها موظف جديد، شلون كانت الطريقة؟"),
    ("إدارة الوقت", "اذكرلي يوم كان بيه ضغط شغل كبير، شلون رتبت أولوياتك؟"),
]
_GREETING = "حياك الله ألف باء، نبدأ من خبرتك العملية."
# States an outcome, so no result follow-up is due: every turn asks the next competency.
_WITH_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع وكانت النتيجة جيدة وتحسن الأداء "
    "بنسبة عشرين بالمية تقريباً."
)
_NO_RESULT = (
    "بشركتي السابقة كان عندي دور بهالموضوع ورتبت الأمور ويا الفريق خطوة بخطوة "
    "حسب الأولويات المطلوبة يومياً."
)
_NOTHING_TO_ADD = "هذا كلشي عندي، شكراً."
_CLARIFY = "شنو تقصد بالسؤال بالضبط؟"


@pytest.fixture(autouse=True)
def _small_cap(monkeypatch):
    """A small configured cap, so the interview reaches it in a few turns. The
    minimum is set too: the cap is ``max(minimum + 2, maximum)``."""
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MIN_QUESTIONS", "3")
    monkeypatch.setenv("INTERVIEW_WRAP_UP_MAX_QUESTIONS", "6")


@dataclass
class _Turn:
    turn: int
    asked_before: int  # len(asked_questions) when the picker ran
    plan: TurnPlan | None = None
    told: str | None = None
    spoken: str = ""
    recorded: str = ""
    silent: bool = False
    attempted: set[str] = field(default_factory=set)
    delivered: set[str] = field(default_factory=set)


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
    agent._turn_log_sink = TurnLogSink(object())

    async def keep(_bare: str) -> str:
        return ""

    agent._regenerate_framed_question = keep
    return agent


def _interview(
    after_cap: list[str], *, model_says: dict[int, str] | None = None
) -> tuple[InterviewAssistant, list[_Turn], int]:
    """Answer with an outcome until the cap fires, then give ``after_cap``.

    The model says what its decision frame told it, unless ``model_says`` maps
    a turn index to other words. Returns the agent, every turn and the cap turn.
    """
    agent = _agent()
    mem = agent._memory
    told: dict[str, str | None] = {}
    wrap = agent._wrap_decision_frame

    def spy(body, diag, m, link_policy, recommended):
        told["text"] = recommended
        return wrap(body, diag, m, link_policy, recommended)

    agent._wrap_decision_frame = spy
    agent.mark_verbatim(_GREETING)
    agent.record_agent_reply(_GREETING)
    turns: list[_Turn] = []
    cap_turn = -1
    pending = list(after_cap)
    try:
        for _ in range(3 * len(_COMPETENCIES)):
            if cap_turn >= 0 and not pending:
                break
            said = pending.pop(0) if cap_turn >= 0 else _WITH_RESULT
            told.clear()
            asked_before = len(mem.asked_questions)
            offered_before = mem.wrap_up_offered
            try:
                asyncio.run(
                    agent.on_user_turn_completed(
                        ChatContext.empty(), ChatMessage(role="user", content=[said])
                    )
                )
            except StopResponse:
                turns.append(_Turn(mem.turn_index, asked_before, silent=True))
                continue
            turn = mem.turn_index
            if not offered_before and mem.wrap_up_offered:
                cap_turn = turn
            plan = agent._turn_plan
            text = (model_says or {}).get(turn) or told.get("text")
            text = text or (plan.question if plan else "") or "شنو تحب تضيف؟"
            spoken = asyncio.run(
                agent.reframe_bare_question(agent._apply_guard_to_agent_text(text))
            )
            recorded = asyncio.run(
                agent.reframe_bare_question(agent._apply_guard_to_agent_text(spoken))
            )
            agent.record_agent_reply(recorded)
            turns.append(
                _Turn(
                    turn,
                    asked_before,
                    plan,
                    told.get("text"),
                    spoken,
                    recorded,
                    attempted=set(mem.asked_competency_keys),
                    delivered=set(mem.delivered_competency_keys),
                )
            )
    finally:
        agent._cancel_wait_timeout()
    assert cap_turn >= 0, "the interview never reached the cap"
    return agent, turns, cap_turn


def _at(turns: list[_Turn], turn: int) -> _Turn:
    return next(t for t in turns if t.turn == turn and not t.silent)


# ── Boundaries ───────────────────────────────────────────────────────────────


def test_just_below_the_cap_the_planned_question_is_asked():
    _, turns, cap_turn = _interview([_NOTHING_TO_ADD])
    cap = _wrap_up_max_questions()
    below = _at(turns, cap_turn - 1)
    assert below.asked_before == cap - 1
    assert below.plan is not None and below.plan.source == "competency_engine"
    assert below.spoken == below.told
    assert below.spoken not in (_WRAP_UP_PROMPT_AR, _FINAL_CLOSING_AR)


def test_the_cap_fires_on_the_turn_that_reaches_it():
    _, turns, cap_turn = _interview([_NOTHING_TO_ADD])
    assert _at(turns, cap_turn).asked_before == _wrap_up_max_questions()


def test_at_the_cap_the_candidate_hears_the_wrap_up_offer():
    agent, turns, cap_turn = _interview([])  # state right after the cap turn
    mem = agent._memory
    at = _at(turns, cap_turn)
    before = _at(turns, cap_turn - 1)

    assert at.told == _WRAP_UP_PROMPT_AR
    assert at.spoken == _WRAP_UP_PROMPT_AR
    assert at.recorded == _WRAP_UP_PROMPT_AR
    assert agent._wrap_up_trigger == "hard_question_cap"
    # Offered, not closed: the closing belongs to a later turn.
    assert mem.wrap_up_offered is True
    assert mem.final_closing_sent is False
    assert agent._conclude_after_reply is False
    # No competency, anchor or bank question is planned on the cap turn.
    assert at.plan is None
    assert at.attempted == before.attempted
    assert at.delivered == before.delivered


def test_the_offer_is_heard_whatever_the_model_says_on_the_cap_turn():
    """The model ignores the recommendation and asks another competency."""
    _, _turns, cap_turn = _interview([_NOTHING_TO_ADD])
    other = _COMPETENCIES[-1][1]
    _, turns, cap_turn = _interview([_NOTHING_TO_ADD], model_says={cap_turn: other})
    at = _at(turns, cap_turn)
    assert at.spoken == _WRAP_UP_PROMPT_AR
    assert at.recorded == _WRAP_UP_PROMPT_AR


def test_the_memo_is_stamped_with_the_turn_that_will_speak():
    """The off-by-one itself: the picker runs before the index advances."""
    agent = _agent()
    mem = agent._memory
    mem.turn_index = 7
    mem.asked_questions.extend(
        f"سؤال سابق رقم {i}؟" for i in range(_wrap_up_max_questions())
    )
    assert agent._pick_recommended_question({}, mem, {}) == _WRAP_UP_PROMPT_AR
    assert agent._winddown_turn == 8
    assert agent._winddown_line == _WRAP_UP_PROMPT_AR


def test_the_next_turn_closes_the_interview():
    agent, turns, cap_turn = _interview([_NOTHING_TO_ADD, _NOTHING_TO_ADD])
    mem = agent._memory
    closing = _at(turns, cap_turn + 1)
    assert closing.spoken == _FINAL_CLOSING_AR
    assert mem.final_closing_sent is True
    assert agent._conclude_after_reply is True
    # …and nothing is said after it.
    assert turns[-1].silent


@pytest.mark.parametrize("said", [_CLARIFY, _NO_RESULT], ids=["clarify", "no_result"])
def test_no_clarification_or_follow_up_after_the_cap_offer(said):
    """Without the cap-only rule, a clarification re-explained the last
    competency's question and a missing result drew «وشصار بالآخر؟» about it,
    both after «أكو شي تحب تضيفه؟»."""
    agent, turns, cap_turn = _interview([said])
    nxt = _at(turns, cap_turn + 1)
    # The picker did plan a turn tied to the old competency…
    assert nxt.plan is not None
    assert nxt.plan.competency_key == _at(turns, cap_turn - 1).plan.competency_key
    # …and the candidate hears the closing instead.
    assert nxt.spoken == _FINAL_CLOSING_AR
    assert agent._memory.final_closing_sent is True


def test_no_question_is_asked_after_the_cap():
    agent, turns, cap_turn = _interview([_NO_RESULT, _CLARIFY, _NOTHING_TO_ADD])
    before = _at(turns, cap_turn - 1)
    spoken_after = [t.spoken for t in turns if t.turn >= cap_turn and not t.silent]
    assert spoken_after == [_WRAP_UP_PROMPT_AR, _FINAL_CLOSING_AR]
    assert agent._memory.asked_competency_keys == before.attempted
    assert agent._memory.delivered_competency_keys == before.delivered


# ── A wrap-up the guard offered earlier keeps its normal path ────────────────


def _offered_by_the_guard() -> InterviewAssistant:
    agent = _agent()
    mem = agent._memory
    mem.asked_questions.extend(
        f"سؤال سابق رقم {i}؟" for i in range(_wrap_up_max_questions())
    )
    mem.wrap_up_offered = True
    agent._wrap_up_trigger = "no_fresh_anchor"
    return agent


def test_the_cap_does_not_offer_again_when_the_guard_already_did():
    agent = _offered_by_the_guard()
    agent._pick_recommended_question({"is_substantive_answer": True}, agent._memory, {})
    assert agent._wrap_up_trigger == "no_fresh_anchor"
    assert agent._winddown_line != _WRAP_UP_PROMPT_AR


def test_a_guard_wrap_up_still_lets_a_tied_follow_up_through():
    agent = _offered_by_the_guard()
    agent._memory.sent_question_id = "q-active"
    agent._turn_plan = TurnPlan(
        question="", response_mode=MODE_FOLLOW_UP, parent_question_id="q-active"
    )
    follow = "وشصار بالآخر؟"
    assert agent._guard_repetition_and_language(follow) == follow
    assert agent._memory.final_closing_sent is False


def test_a_guard_wrap_up_still_closes_on_a_new_question():
    agent = _offered_by_the_guard()
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_ASK)
    assert (
        agent._guard_repetition_and_language(_COMPETENCIES[0][1]) == _FINAL_CLOSING_AR
    )
    assert agent._memory.final_closing_sent is True
