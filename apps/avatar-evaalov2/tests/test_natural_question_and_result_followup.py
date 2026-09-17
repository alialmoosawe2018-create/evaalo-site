"""Spoken register + the outcome question the scorer demands.

Two owner-approved changes (2026-09-17), both traced to his own interview:

1. The blueprint's objective is written to be READ by the scorer — brackets,
   stacked asks, raw English — and it was being spoken verbatim.
2. The single-question rule trimmed «وشنو صار بالنتيجة؟» off most openers while
   the Stage-3 rubric caps any competency without a result at 4, and no path in
   the interview ever asked for one.
"""

from __future__ import annotations

from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.entity_policy import (
    RESULT_FOLLOWUP_POOL,
    naturalize_spoken_question,
)
from voice_interview.heuristics import analyze_user_answer, mentions_result


class _StubTts:
    def update_options(self, **kwargs: object) -> None:
        pass


COMP = {
    "key": "hr_case_management",
    "title": "إدارة قضايا الموظفين من البداية للنهاية",
    "objective": (
        "اذكرلي حالة HR case مثل شكوى تظلم أو تحقق غيابات طويلة، شنو كانت الخطوات "
        "اللي اتبعتها من intake للنهاية وشنو النتيجة القابلة للقياس؟"
    ),
    "evidence": ["وجود سجل حالة واضح فيه التواريخ"],
    "followUps": ["شنو كان case ID أو وين خزّنت السجل؟"],
}


def _agent(competencies=None) -> InterviewAssistant:
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
        blueprint_competencies=competencies if competencies is not None else [COMP],
    )


# ── 1. spoken register ───────────────────────────────────────────────────────


def test_brackets_become_a_spoken_aside():
    out = naturalize_spoken_question("اذكرلي موقف نصحت بيه مدير (مثلاً بخصوص أداء أو فصل)؟")
    assert "(" not in out and ")" not in out
    assert "مثلاً بخصوص أداء أو فصل" in out  # the concrete anchor survives
    assert out.count("؟") == 1


def test_raw_english_is_glossed_without_stuttering():
    out = naturalize_spoken_question(COMP["objective"])
    assert "HR case" not in out
    assert "intake" not in out
    assert "حالة حالة" not in out  # the gloss used to double the preceding word
    assert "حالة موظف" in out


def test_stacked_asks_are_cut_to_one():
    out = naturalize_spoken_question(
        "اذكرلي مثال عن موقف تطلب تطبيق سياسة مكتوبة، شنو كانت الحالة، شنو سويت تحديداً؟"
    )
    assert out.count("؟") == 1
    assert "شنو كانت الحالة" in out
    assert "شنو سويت تحديداً" not in out


def test_end_to_end_is_spoken_arabic():
    assert "من أولها لآخرها" in naturalize_spoken_question("حالة سويت لها end-to-end؟")


def test_naturalizer_is_idempotent_and_safe_on_a_clean_question():
    clean = "شنو أصعب موقف مرّ عليك بالشغل؟"
    assert naturalize_spoken_question(clean) == clean
    once = naturalize_spoken_question(COMP["objective"])
    assert naturalize_spoken_question(once) == once


def test_the_prompt_carries_the_approved_style_examples():
    agent = _agent()
    frame = agent._wrap_decision_frame(
        "body", analyze_user_answer("تمام."), agent._memory, {}, "اذكرلي حالة؟"
    )
    assert "STYLE EXAMPLES" in frame
    assert "صار وياك موقف اضطريت ترجع بيه للسياسة المكتوبة حتى تقرر؟" in frame
    # Naming «زين،» as a welcome lead-in made the model open all ten questions
    # with it. No lead-in may be offered as an example any more.
    assert 'lead-in (\\"زين،\\"' not in frame
    assert "no lead-in word" in frame


def test_the_opening_words_are_assigned_and_rotate():
    """Telling the model to "vary the opener" failed end-to-end (10/10 identical),
    so the opener is assigned per turn and rotates."""
    agent = _agent()
    mem = agent._memory
    seen = []
    for turn in range(6):
        mem.turn_index = turn
        frame = agent._wrap_decision_frame(
            "body", analyze_user_answer("تمام."), mem, {}, "اذكرلي حالة؟"
        )
        assert "OPENING WORDS for THIS question" in frame
        line = next(ln for ln in frame.splitlines() if "OPENING WORDS" in ln)
        seen.append(line)
    assert len(set(seen)) == 6, seen  # a different opener every turn in the cycle


# ── 2. the result question ───────────────────────────────────────────────────


def test_a_word_ending_in_feh_is_not_an_unfinished_turn():
    """Regression: `_INCOMPLETE_TRAILING_AR` holds «فـ», which normalizes to the
    bare letter «ف». The loop matched it as a character suffix, so ANY turn
    ending in a word ending with ف — «ما أعرف», «الملف», «الهدف», «الموقف», and
    in an HR interview «التوظيف» — was read as "still talking" and the agent
    withheld its reply. Found 2026-09-17 while testing the result question.
    """
    for complete in (
        "ما أعرف",
        "اشتغلت بالتوظيف",
        "خزنته بالملف",
        "هذا كان الهدف",
        "شفت الموقف",
    ):
        assert analyze_user_answer(complete)["is_incomplete_turn"] is False, complete
    for unfinished in ("اجانا موظف و", "كنت اشتغل في", "رحت للمدير وبعدين"):
        assert analyze_user_answer(unfinished)["is_incomplete_turn"] is True, unfinished


def test_mentions_result_is_strict():
    assert mentions_result("وبالنتيجة انخفضت الغيابات") is True
    assert mentions_result("وفّرنا وقت كبير على الفريق") is True
    assert mentions_result("خلصناها خلال 3 أيام") is True
    # «صار» opens half of all Iraqi answers — it must NOT count as an outcome
    assert mentions_result("صار عندي موقف وية موظف جديد") is False
    assert mentions_result("اول شي اخذ منا المستمسكات وخليته يوقع") is False


def _ask_then_answer(agent: InterviewAssistant, answer: str) -> str | None:
    mem = agent._memory
    opening = agent._pick_next_competency_question(mem)
    agent.record_agent_reply(opening)
    diag = analyze_user_answer(answer)
    diag = agent._apply_entity_policy(answer, diag)
    return agent._pick_recommended_question(diag, mem, diag.get("link_policy") or {})


ANSWER_NO_RESULT = (
    "اجانا موظف قدّم شكوى على مديره، قعدت وياه وسمعت منه، وبعدين حچيت وية المدير "
    "وكتبت محضر بالموضوع وخزنته بالملف."
)
ANSWER_WITH_RESULT = ANSWER_NO_RESULT + " وبالنتيجة انحلت الشكوى ورجع الموظف لشغله."


def test_result_question_fires_when_the_answer_has_no_outcome():
    agent = _agent()
    rec = _ask_then_answer(agent, ANSWER_NO_RESULT)
    assert rec in RESULT_FOLLOWUP_POOL
    assert agent._turn_plan.source == "result_followup"
    assert agent._turn_plan.competency_key == "hr_case_management"


def test_result_question_is_skipped_when_the_answer_already_gave_one():
    agent = _agent()
    rec = _ask_then_answer(agent, ANSWER_WITH_RESULT)
    assert rec not in RESULT_FOLLOWUP_POOL
    assert agent._turn_plan.source != "result_followup"


def test_result_question_is_not_asked_twice_for_one_competency():
    agent = _agent()
    first = _ask_then_answer(agent, ANSWER_NO_RESULT)
    assert first in RESULT_FOLLOWUP_POOL
    agent.record_agent_reply(first)
    diag = analyze_user_answer(ANSWER_NO_RESULT)
    diag = agent._apply_entity_policy(ANSWER_NO_RESULT, diag)
    second = agent._pick_recommended_question(
        diag, agent._memory, diag.get("link_policy") or {}
    )
    assert second not in RESULT_FOLLOWUP_POOL


def test_a_non_answer_gets_no_result_question():
    agent = _agent()
    rec = _ask_then_answer(agent, "ما اعرف صراحة.")
    assert rec not in RESULT_FOLLOWUP_POOL
