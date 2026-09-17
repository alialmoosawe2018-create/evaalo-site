"""Clarification requests are heard, and each kind of turn gets its own shape.

Found 2026-09-17 by running follow-ups and clarification requests end to end
against the real model before the founder's first real interview.
"""

from __future__ import annotations

import pytest

from voice_interview.active_question import MODE_CLARIFY, MODE_FOLLOW_UP
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import analyze_user_answer

QUESTION = "خلّينا نحچي عن السياسات المكتوبة. صار وياك موقف من هذا النوع وشنو سويت بيه؟"


class _StubTts:
    def update_options(self, **kwargs: object) -> None:
        pass


def _agent() -> InterviewAssistant:
    router = TtsRouteContext(
        _StubTts(), arabic_voice_id="ar", english_voice_id="en", supports_override=False,
        cooldown_ms=0, initial_voice_id="ar", initial_language="ar",
    )
    return InterviewAssistant(
        tts_router=router,
        bank_questions=[],
        bank_key="hr_generalist",
        position="أخصائي موارد بشرية",
        has_domain_guidance=True,
        blueprint_competencies=[
            {
                "key": "hr_policy_application",
                "title": "تطبيق سياسات HR المكتوبة",
                "objective": "اذكرلي موقف تطلب تطبيق سياسة مكتوبة، شنو سويت؟",
                "evidence": ["ذكر بند السياسة"],
                "followUps": ["أي بند اعتمدت عليه؟"],
            }
        ],
    )


def _meta(text: str) -> str | None:
    return analyze_user_answer(
        text, active_question_text=QUESTION, active_question_status="awaiting_answer"
    ).get("meta_request")


# ── the phrasings that were silently ignored ─────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "سؤالك مو واضح صراحة.",
        "السؤال مو واضح",
        "ممكن تعيدين السؤال؟",
        "اعيدي السؤال لو سمحتي",
        "شلون يعني؟",
        "Can you repeat the question?",
        "I did not understand the question",
        "The question is not clear",
    ],
)
def test_short_clarify_requests_are_heard(text: str) -> None:
    """Every one of these returned None before, so the agent abandoned its own
    question and moved to the next competency — it read as ignoring the
    candidate."""
    assert _meta(text) == "clarify_term", text


@pytest.mark.parametrize(
    "text",
    [
        # «مو واضح» as a narrative detail inside a real answer, not a request.
        "اجانا موظف وكان الوضع مو واضح بالبداية بس رتبت الملف وخلصت القضية بيوم واحد",
        "اشتغلت بالتوظيف ثلاث سنوات وكنت مسؤول عن الفرز",
        "I handled payroll for 200 employees and the process was not clear at first so I documented it",
    ],
)
def test_a_real_answer_is_not_mistaken_for_a_clarify_request(text: str) -> None:
    """The length gate is the whole point — matching these ungated turned a
    complete answer into a clarification."""
    assert _meta(text) is None, text


def test_a_short_clarify_is_not_read_as_unfinished_speech() -> None:
    # «شلون يعني؟» ends on a filler word, so the trailing-word rule called it
    # unfinished and the agent waited in silence instead of clarifying.
    assert analyze_user_answer("شلون يعني؟")["is_incomplete_turn"] is False
    # …while a genuinely dangling «يعني» still is.
    assert analyze_user_answer("كنت اشتغل بالتوظيف يعني")["is_incomplete_turn"] is True


# ── one rule per kind of turn ────────────────────────────────────────────────


def _frame_for_mode(mode: str) -> str:
    agent = _agent()
    agent._pick_next_competency_question(agent._memory)
    agent._turn_plan.response_mode = mode
    agent._memory.active_question_text = QUESTION
    return agent._wrap_decision_frame(
        "body", analyze_user_answer("تمام."), agent._memory, {}, "وشصار بالآخر؟"
    )


def test_a_follow_up_turn_is_told_to_stay_short() -> None:
    """The result follow-up «وشصار بالآخر؟» was being inflated back into a whole
    new competency question, so the outcome was never actually asked."""
    frame = _frame_for_mode(MODE_FOLLOW_UP)
    assert "SHORT FOLLOW-UP TURN" in frame
    assert "under 12 words" in frame
    assert "35-70 words" not in frame  # the new-question rule must not apply


def test_a_clarify_turn_is_told_not_to_reuse_its_own_wording() -> None:
    """Re-running the explain-then-ask recipe reproduced the SAME sentence — the
    one thing a clarification must never do."""
    frame = _frame_for_mode(MODE_CLARIFY)
    assert "CLARIFY TURN" in frame
    assert "do not reuse its wording" in frame
    assert QUESTION[:40] in frame  # the model is shown what NOT to repeat
    assert "35-70 words" not in frame


def test_a_new_question_still_gets_the_explain_then_ask_rule() -> None:
    frame = _frame_for_mode("ask")
    assert "35-70 words" in frame
    assert "SHORT FOLLOW-UP TURN" not in frame
    assert "CLARIFY TURN" not in frame


def test_clarify_keeps_the_models_own_question_instead_of_gluing() -> None:
    """The guard used to append the planned question after the model's, so the
    clarification was said twice — the second time in the very words the
    candidate had just failed to understand."""
    agent = _agent()
    agent._pick_next_competency_question(agent._memory)
    agent._turn_plan.response_mode = MODE_CLARIFY
    agent._turn_plan.clarify_fallback = "خلّيني أبسّطها، مثال واحد يكفي: " + QUESTION
    simpler = "خلّيني أبسّطها، مثلاً موظف يطلب إجازة طويلة. صار وياك موقف مشابه؟"
    out = agent._apply_guard_to_agent_text(simpler)
    assert out.count("؟") == 1
    assert out.count("خلّيني أبسّطها") == 1
    assert QUESTION[:40] not in out
