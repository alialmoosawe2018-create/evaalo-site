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

from voice_interview.active_question import TurnPlan, enforce_single_question_response
from voice_interview.heuristics import is_semantic_duplicate_question
from voice_interview.lang import contains_hybrid_latin_arabic_token


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
