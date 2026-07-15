"""Cross-domain output guard — validates agent replies before TTS.

Inspects agent output only (never candidate transcripts).
"""

from __future__ import annotations

from dataclasses import dataclass

from voice_interview.heuristics import normalize_text

HR_RECRUITER_PACK = "hr_recruiter"
PETROLEUM_ENGINEER_PACK = "petroleum_engineer"

# Recruiting terms that must not appear in non-HR pack agent replies.
_RECRUITER_TERMS: tuple[str, ...] = (
    "time to fill",
    "offer acceptance",
    "candidate pipeline",
    "boolean search",
    "sourcing channel",
    "applicant tracking",
    "مرشحين",
    "pipeline",
    "استقطاب",
    "قنوات الاستقطاب",
    "time-to-fill",
)

# Petroleum / engineering terms that must not appear in HR recruiter agent replies.
_PETROLEUM_TERMS: tuple[str, ...] = (
    "water cut",
    "gor",
    "bottomhole pressure",
    "wellhead pressure",
    "reservoir simulation",
    "معدل الإنتاج",
    "نسبة الماء",
    "مكمن",
    "بئر نفط",
)

_PACK_SAFE_FALLBACKS: dict[str, str] = {
    PETROLEUM_ENGINEER_PACK: (
        "أقصد مؤشرات مرتبطة بالمشروع النفطي، مثل معدل الإنتاج أو الضغط أو نسبة الماء "
        "أو نتائج المحاكاة."
    ),
    HR_RECRUITER_PACK: (
        "أقصد مؤشرات التوظيف مثل Time to Fill أو Offer Acceptance أو فعالية المصادر."
    ),
}


@dataclass(frozen=True)
class GuardResult:
    safe: bool
    blocked_term: str | None = None
    fallback_text: str | None = None
    fallback_source: str | None = None


def _find_blocked_term(agent_norm: str, terms: tuple[str, ...]) -> str | None:
    for term in terms:
        t = normalize_text(term)
        if t and t in agent_norm:
            return term
    return None


def _build_fallback(
    *,
    domain_pack_key: str,
    recommended_question: str | None,
    clarify_fallback: str | None,
) -> tuple[str, str]:
    if clarify_fallback and clarify_fallback.strip():
        return clarify_fallback.strip(), "clarify_pack"
    if recommended_question and recommended_question.strip():
        return recommended_question.strip(), "recommended_question"
    pack_fb = _PACK_SAFE_FALLBACKS.get(domain_pack_key, "").strip()
    if pack_fb:
        return pack_fb, "pack_default"
    return (
        "اذكرلي مثال عملي بسيط من خبرتك يوضح هالموضوع؟",
        "generic",
    )


def validate_cross_domain_output(
    agent_text: str,
    *,
    domain_pack_key: str,
    recommended_question: str | None = None,
    clarify_fallback: str | None = None,
) -> GuardResult:
    """Return whether agent_text is safe for the active domain pack."""
    raw = (agent_text or "").strip()
    if not raw:
        return GuardResult(safe=True)

    norm = normalize_text(raw)
    pack = (domain_pack_key or "").strip().lower()

    blocked: str | None = None
    if pack and pack != HR_RECRUITER_PACK:
        blocked = _find_blocked_term(norm, _RECRUITER_TERMS)
    elif pack == HR_RECRUITER_PACK:
        blocked = _find_blocked_term(norm, _PETROLEUM_TERMS)

    if not blocked:
        return GuardResult(safe=True)

    fb_text, fb_source = _build_fallback(
        domain_pack_key=pack,
        recommended_question=recommended_question,
        clarify_fallback=clarify_fallback,
    )
    return GuardResult(
        safe=False,
        blocked_term=blocked,
        fallback_text=fb_text,
        fallback_source=fb_source,
    )
