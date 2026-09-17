"""A clarification changes the EXAMPLE, not just the opening words.

All three clarifications in the 2026-09-17 22:05 interview came back as the
original question with a new prefix, and the owner named it: «طلبات التوضيح
يعيد نفس السؤال بدون توضيح عميق». The material now comes from the competency's
own expectedEvidence — but only the parts that describe the KIND OF SITUATION,
never the parts that describe what a good answer contains, because speaking
those would hand the candidate the answer.
"""

from __future__ import annotations

from voice_interview.entity_policy import (
    clarify_with_new_example,
    simplify_clarify_for_pack,
    situation_hints_from_evidence,
)
from voice_interview.heuristics import is_semantic_duplicate_question

# Verbatim from the founder's campaign blueprint (hr_policy_application).
POLICY_EVIDENCE = [
    "ذكر اسم السياسة وبند محدد أستُند عليه",
    "تسلسل قرار واضح (من أخذ القرار، أي مستوى الموافقة، التاريخ)",
    "وثائق أو إدخال في HRIS أو بريد يؤكد القرار",
    "تأثير مقاس مثل تغيير حالة الحضور أو تعديل رصيد إجازات",
]
COMPS = [
    {
        "key": "hr_policy_application",
        "title": "تطبيق سياسات HR المكتوبة",
        "evidence": POLICY_EVIDENCE,
    }
]

# Verbatim agent turn from that interview — the one that got repeated back.
REAL_QUESTION = (
    "حچيلي عن شلون تتعامل وية السياسات المكتوبة بشغلك. أقصد مثلاً موظف يطلب إجازة "
    "مرضية طويلة، أو حالة غياب تحتاج ترجع فيها للسياسة حتى تحسم القرار. صار وياك "
    "موقف من هذا النوع وشنو سويت بيه؟"
)

# Phrases that describe what a good ANSWER contains. Speaking any of these is coaching.
COACHING = ("ذكر اسم السياسة", "تسلسل قرار", "وثائق أو إدخال", "أستُند عليه", "مستوى الموافقة")


def _clarify(variant: int = 0) -> str:
    text, _ = simplify_clarify_for_pack(
        REAL_QUESTION,
        domain_pack_key="hr_generalist",
        competencies=COMPS,
        variant=variant,
        active_competency_key="hr_policy_application",
    )
    return text


def test_clarification_is_not_the_question_again() -> None:
    out = _clarify()
    assert not is_semantic_duplicate_question(out, [REAL_QUESTION])
    # the original's own example must not be recycled either
    assert "إجازة مرضية طويلة" not in out


def test_clarification_carries_a_different_concrete_example() -> None:
    out = _clarify()
    assert "مثلاً" in out
    assert "تغيير حالة الحضور" in out  # from expectedEvidence, absent from the question
    assert out.count("؟") == 1


def test_clarification_never_coaches_the_answer() -> None:
    """The rubric says what a strong answer contains; the candidate must not hear it."""
    for variant in range(4):
        out = _clarify(variant)
        for phrase in COACHING:
            assert phrase not in out, (variant, phrase, out)


def test_only_situation_fragments_are_extracted() -> None:
    hints = situation_hints_from_evidence(POLICY_EVIDENCE)
    assert hints == ["تغيير حالة الحضور أو تعديل رصيد إجازات"]
    # the three action-shaped items contributed nothing
    assert all("ذكر" not in h and "تسلسل" not in h for h in hints)


def test_english_inside_a_hint_is_glossed() -> None:
    hints = situation_hints_from_evidence(["أداة متابعة مثل HRIS أو ملف payroll"])
    assert hints and "HRIS" not in hints[0] and "payroll" not in hints[0]


def test_no_usable_evidence_falls_back_to_restating() -> None:
    assert clarify_with_new_example(["ذكر اسم السياسة وبند محدد"]) == ""
    assert clarify_with_new_example([]) == ""
    text, _ = simplify_clarify_for_pack(
        REAL_QUESTION,
        domain_pack_key="hr_generalist",
        competencies=[{"key": "k", "title": "t", "evidence": ["ذكر اسم السياسة"]}],
        active_competency_key="k",
    )
    assert "السياسات المكتوبة" in text  # the old restatement path, still available


def test_the_lead_in_still_rotates() -> None:
    leads = {_clarify(v).split(":")[0] for v in range(4)}
    assert len(leads) == 4
