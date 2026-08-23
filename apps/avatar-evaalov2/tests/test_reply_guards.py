"""Regression tests for the video-agent reply guards.

Two defects seen in a real ``video_interview`` transcript:
  * near-duplicate consecutive questions (the exact-match loop guard missed a
    reworded repeat — e.g. the same line with a trailing "؟", or a shorter
    question fully contained in an earlier longer one);
  * a malformed hybrid Latin+Arabic token ("motivatesك") the model produced
    while phrasing an Arabic question.

These cover the pure detectors that the guard in ``assistant`` relies on.
"""

from __future__ import annotations

from voice_interview.active_question import (
    MODE_FOLLOW_UP,
    MODE_RESUME,
    TurnPlan,
    enforce_single_question_response,
)
from voice_interview.assistant import InterviewAssistant, TtsRouteContext
from voice_interview.heuristics import is_semantic_duplicate_question
from voice_interview.lang import contains_hybrid_latin_arabic_token


class _StubTts:
    def update_options(self, **kwargs):  # noqa: ANN003
        pass


def _assistant(bank: list[str]) -> InterviewAssistant:
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
        bank_questions=bank,
        bank_key="test",
        position="HR Recruiter",
        candidate_gender="female",
        has_domain_guidance=True,
        domain_pack_key="hr_recruiter",
    )


# --- hybrid Latin+Arabic token ------------------------------------------------
def test_hybrid_detects_glued_token():
    assert contains_hybrid_latin_arabic_token("شنو الشي اللي motivatesك بهذا الدور؟") is True


def test_hybrid_ignores_spaced_loanwords():
    assert contains_hybrid_latin_arabic_token("عندك خبرة في HR و Excel؟") is False
    assert contains_hybrid_latin_arabic_token("اشتغلت كـ human resources officer") is False


def test_hybrid_ignores_pure_arabic_or_english():
    assert contains_hybrid_latin_arabic_token("شنو خبرتك بالعمل؟") is False
    assert contains_hybrid_latin_arabic_token("What motivates you in this role?") is False
    assert contains_hybrid_latin_arabic_token("") is False


# --- semantic duplicate question ---------------------------------------------
def test_dup_verbatim_only_punctuation_differs():
    # AGENT13 vs AGENT14 in the real transcript (only a trailing "؟" differs).
    prev = ["شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة"]
    assert (
        is_semantic_duplicate_question(
            "شلون تقرر شنو الأولويات لما تكون الأهداف متعارضة؟", prev
        )
        is True
    )


def test_dup_short_question_contained_in_longer_earlier_one():
    # AGENT6 is AGENT5 minus its opener.
    prev = [
        "جيد، هسه احچيلي عن نتيجة حققتها في عملك السابق كانت مهمة للمعنيين، "
        "وشنو الطريقة اللي قست بيها نجاحها؟"
    ]
    assert (
        is_semantic_duplicate_question(
            "شنو نتيجة حققتها في عملك السابق كانت مهمة للمعنيين، "
            "وشنو الطريقة اللي قست بيها نجاحها؟",
            prev,
        )
        is True
    )


def test_not_duplicate_for_distinct_topics():
    prev = ["شنو الشي اللي يحمّسك لهذا الدور بالذات؟"]
    assert (
        is_semantic_duplicate_question(
            "احچيلي عن موقف واجهت بيه ضغط شديد وشلون تعاملت وياه؟", prev
        )
        is False
    )


def test_not_duplicate_with_empty_history():
    assert is_semantic_duplicate_question("شنو خبرتك في الموارد البشرية؟", []) is False


def test_framing_only_question_is_never_duplicate():
    # A bare framing shell with no topical tokens must not match anything.
    prev = ["شنو رأيك بالموضوع؟"]
    assert is_semantic_duplicate_question("شلون؟", prev) is False


# --- give the question room: keep the framing sentence, drop extra questions ---
def test_ask_preserves_leading_context_sentence():
    plan = TurnPlan(question="شنو الأدوات اللي استخدمتها؟", response_mode="ask")
    raw = "بخصوص تنظيم ملفات الموظفين. شنو الأدوات اللي استخدمتها؟ وشلون رتبتها؟"
    out = enforce_single_question_response(raw, plan)
    assert out.count("؟") == 1  # single question kept
    assert "بخصوص تنظيم ملفات الموظفين" in out  # framing context preserved
    assert "رتبتها" not in out  # trailing extra question dropped


def test_ask_double_question_without_context_still_single():
    plan = TurnPlan(question="شنو المؤشر الأهم عندكم؟", response_mode="ask")
    raw = "شلون تقيّم القناة؟ وشلون تتابع بعد المقابلة؟"
    out = enforce_single_question_response(raw, plan)
    assert out.count("؟") == 1
    assert "بعد المقابلة" not in out


# --- the widened repetition guard (resume/topic-change is deduped) -------------
def test_guard_replaces_resume_duplicate_with_fresh_anchor():
    fresh = "شنو قنوات الاستقطاب اللي تعتمد عليها بالتوظيف؟"
    agent = _assistant([fresh])
    dup = "شنو المؤشر الأهم اللي تتابعه بعملية التوظيف؟"
    agent._memory.asked_questions.append(dup)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_RESUME)
    out = agent._guard_repetition_and_language(dup)
    assert out != dup  # duplicate on a topic-change turn was replaced
    assert "قنوات الاستقطاب" in out  # replaced with the fresh bank anchor


def test_guard_keeps_followup_even_if_similar_to_recent():
    agent = _assistant(["شنو قنوات الاستقطاب اللي تعتمد عليها؟"])
    active = "شنو المؤشر الأهم اللي تتابعه بعملية التوظيف؟"
    agent._memory.asked_questions.append(active)
    agent._turn_plan = TurnPlan(question="", response_mode=MODE_FOLLOW_UP)
    # A follow-up intentionally echoes the active question — must NOT be replaced.
    out = agent._guard_repetition_and_language(active)
    assert out == active
