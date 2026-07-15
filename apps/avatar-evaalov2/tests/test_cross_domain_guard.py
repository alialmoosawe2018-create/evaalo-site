"""Tests for cross-domain output guard."""

from voice_interview.cross_domain_guard import (
    PETROLEUM_ENGINEER_PACK,
    validate_cross_domain_output,
)


def test_petroleum_blocks_recruiter_terms() -> None:
    result = validate_cross_domain_output(
        "مثلاً Time to Fill أو Offer Acceptance — أي واحد تتابعه؟",
        domain_pack_key=PETROLEUM_ENGINEER_PACK,
        clarify_fallback="أقصد معدل الإنتاج أو الضغط.",
    )
    assert not result.safe
    assert result.blocked_term
    assert "معدل الإنتاج" in (result.fallback_text or "")
    assert result.fallback_source == "clarify_pack"


def test_petroleum_allows_oil_metrics() -> None:
    result = validate_cross_domain_output(
        "أقصد معدل الإنتاج أو الضغط أو نسبة الماء.",
        domain_pack_key=PETROLEUM_ENGINEER_PACK,
    )
    assert result.safe


def test_hr_allows_recruiter_terms() -> None:
    result = validate_cross_domain_output(
        "مثلاً Time to Fill أو Offer Acceptance.",
        domain_pack_key="hr_recruiter",
    )
    assert result.safe


def test_guard_only_checks_agent_text_not_candidate_story() -> None:
    """Candidate mentioning LinkedIn in their story is not validated here — agent reply is."""
    result = validate_cross_domain_output(
        "شكراً على التوضيح. خلينا نكمل.",
        domain_pack_key=PETROLEUM_ENGINEER_PACK,
    )
    assert result.safe
