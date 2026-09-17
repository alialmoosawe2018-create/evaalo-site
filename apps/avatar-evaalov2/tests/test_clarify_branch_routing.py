"""Clarification must explain the question that was asked.

2026-09-17: the candidate asked for clarification of «اذكرلي قرار أو مشروع انت
قادته في HR» and was told «أقصد بالأكاديمي دراسة أو مشروع تخرج، وبالعملي شغل أو
تدريب فعلي» — the academic-vs-practical template, selected because the word
«مشروع» was an academic trigger. Only explicit academic cues route there now.
"""

from __future__ import annotations

from voice_interview.entity_policy import _classify_clarify_branch, simplify_clarify_for_pack
from voice_interview.heuristics import normalize_text


def _branch(q: str) -> str:
    return _classify_clarify_branch(normalize_text(q))


def test_project_you_led_is_not_academic():
    q = "شنو، اذكرلي قرار أو مشروع انت قادته في HR، وشنو كان تأثيره على الفريق أو الشركة؟"
    assert _branch(q) == "default"


def test_hr_field_is_not_academic():
    assert _branch("Tell me about your experience in the HR field") == "default"


def test_field_work_alone_is_not_academic():
    assert _branch("اذكرلي خبرتك بالعمل الميداني بالحقل") == "default"


def test_explicit_academic_cues_still_route():
    assert _branch("هل عندك مشروع تخرج أو بحث أكاديمي بهذا المجال؟") == "academic_field"
    assert _branch("Was that an academic project at university?") == "academic_field"


def test_other_branches_untouched():
    assert _branch("شنو المؤشرات اللي تتابعها بشغلك؟") == "metrics"
    assert _branch("اذكرلي موقف صعب أو حساس واجهته") == "sensitive"


def test_led_project_clarify_never_mentions_academia():
    text, src = simplify_clarify_for_pack(
        "اذكرلي قرار أو مشروع انت قادته في HR؟", domain_pack_key="hr_generalist"
    )
    assert "أكاديمي" not in text
    assert "تخرج" not in text
    assert src == "generic"
    assert text.count("؟") == 1
