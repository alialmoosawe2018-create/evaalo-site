"""Without a blueprint, no specialism may be GUESSED into the interview.

From the 2026-09-18 interview that entered through the public link before the
campaign blueprint had locked:

    Question bank: fuzzy-matched 'HR Assistant' -> hr-business-partner
    Hybrid memory pre-seed | first_topic='Describe how you balance employee
        experience, company policy, and compliance in HR decisions.'

A junior HR Assistant was handed the HR BUSINESS PARTNER bank and asked a
strategic decision-balancing question. The scorer then received ten competencies
that had been locked minutes later — so the session was graded as a specialist
interview it never was.

Root cause: "HR Assistant" reduces to the single token {'hr'} ("assistant" is a
stopword). {'hr'} is contained in EVERY HR title, and `_fuzzy_match_slug` rewards
containment with 0.75, clearing the 0.6 threshold. Raw overlap alone is 1/3 —
correctly below it.

Two independent protections, both pinned here:
  * the containment reward now needs more than one distinctive token on each side;
  * with no blueprint competencies, the fuzzy tier is not consulted at all, and
    an unmatched role gets neutral behavioural anchors instead of a guess.

The owner's constraint: a valid blueprint must not change today's behaviour.
"""

from __future__ import annotations

import json

import pytest

from voice_interview.job_questions import (
    NEUTRAL_BEHAVIORAL_QUESTIONS,
    _fuzzy_match_slug,
    _load_store,
    blueprint_competency_count,
    resolve_livekit_questions,
)

HR_ASSISTANT = {"position": "HR Assistant"}


def _with_blueprint(meta: dict, competencies: int = 10) -> dict:
    """Metadata shaped exactly as the backend ships it: a JSON string."""
    out = dict(meta)
    out["blueprint"] = json.dumps(
        {
            "language": "ar",
            "anchorQuestions": ["سؤال المخطّطة الأول؟"],
            "competencies": [
                {"key": f"c{i}", "title": f"كفاءة {i}", "objective": "", "evidence": []}
                for i in range(competencies)
            ],
        },
        ensure_ascii=False,
    )
    return out


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INTERVIEW_FUZZY_BANK_WITHOUT_BLUEPRINT_V4", raising=False)
    monkeypatch.delenv("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", raising=False)


# ── the headline case ────────────────────────────────────────────────────────


def test_hr_assistant_can_never_become_hr_business_partner() -> None:
    """The exact substitution from the live interview, with no blueprint."""
    res = resolve_livekit_questions(dict(HR_ASSISTANT))
    assert "hr-business-partner" not in (res.matched_key or "")
    assert "hr_business_partner" not in (res.question_bank_source or "")
    assert res.resolution != "category_slug"
    # and the English BP question that was actually asked is nowhere in the anchors
    joined = " ".join(res.questions)
    assert "employee experience" not in joined
    assert "company policy" not in joined


def test_the_containment_reward_no_longer_fires_on_one_token() -> None:
    """The root cause, independent of the blueprint gate."""
    assert _fuzzy_match_slug(_load_store(), "HR Assistant") is None


def test_an_unmatched_role_gets_neutral_anchors_not_silence() -> None:
    """Blocking the guess must not trade a wrong interview for no interview."""
    res = resolve_livekit_questions(dict(HR_ASSISTANT))
    assert res.resolution == "neutral_behavioral"
    assert res.questions
    assert list(res.questions) == list(NEUTRAL_BEHAVIORAL_QUESTIONS)


def test_the_neutral_bank_claims_no_specialism() -> None:
    joined = " ".join(NEUTRAL_BEHAVIORAL_QUESTIONS)
    for term in ("HR", "ATS", "payroll", "sourcing", "هندسة", "تسويق", "مبيعات", "محاسب"):
        assert term not in joined, term
    # Arabic, not the three-line English __default__ bank
    assert all(any("؀" <= ch <= "ۿ" for ch in q) for q in NEUTRAL_BEHAVIORAL_QUESTIONS)


# ── the gate itself, on a title the fuzzy tier really does match ─────────────
#
# "HR Assistant" is denied by the one-token fix alone, so it cannot exercise the
# blueprint gate. "Financial Accounting Officer" can: it has three distinctive
# tokens, no exact or slug match, and the fuzzy tier resolves it to
# CHIEF-FINANCIAL-OFFICER — an accounting officer interviewed as a CFO, the same
# hazard as the HR one and live in the catalog today.

CFO_GUESS = {"position": "Financial Accounting Officer"}


def test_the_fuzzy_tier_really_would_guess_this_one() -> None:
    """The premise. Without it the two tests below would pass for the wrong reason."""
    assert _fuzzy_match_slug(_load_store(), "Financial Accounting Officer") == (
        "chief-financial-officer",
        "chief financial officer",
    )


def test_without_a_blueprint_that_guess_is_refused() -> None:
    res = resolve_livekit_questions(dict(CFO_GUESS))
    assert "chief-financial-officer" not in (res.matched_key or "")
    assert "chief_financial_officer" not in (res.question_bank_source or "")
    assert res.resolution == "neutral_behavioral"


def test_with_a_blueprint_the_same_guess_is_allowed_exactly_as_before() -> None:
    """«وجود Blueprint سليمة لا يغيّر السلوك الحالي» — including the fuzzy tier."""
    res = resolve_livekit_questions(_with_blueprint(dict(CFO_GUESS)))
    assert res.resolution != "neutral_behavioral"
    assert res.has_bank


def test_the_escape_hatch_restores_the_guess(monkeypatch: pytest.MonkeyPatch) -> None:
    """Proves the new key is wired to the gate, not decorative."""
    monkeypatch.setenv("INTERVIEW_FUZZY_BANK_WITHOUT_BLUEPRINT_V4", "true")
    res = resolve_livekit_questions(dict(CFO_GUESS))
    assert res.resolution != "neutral_behavioral"


# ── a healthy blueprint must not change behaviour ────────────────────────────


def test_a_valid_blueprint_leaves_the_fuzzy_tier_exactly_as_it_was() -> None:
    """The owner's constraint: «وجود Blueprint سليمة لا يغيّر السلوك الحالي»."""
    meta = _with_blueprint({"position": "Talent Acquisition Specialist"})
    with_bp = resolve_livekit_questions(meta)
    # identical to the same resolution computed the legacy way (fuzzy permitted)
    assert with_bp.resolution != "neutral_behavioral"
    assert with_bp.questions


def test_the_gate_keys_on_competencies_not_on_the_blueprint_key() -> None:
    """A blueprint present but EMPTY is the same risk as no blueprint at all."""
    empty = _with_blueprint(dict(HR_ASSISTANT), competencies=0)
    assert blueprint_competency_count(empty) == 0
    assert resolve_livekit_questions(empty).resolution == "neutral_behavioral"


def test_competency_count_reads_the_backend_json_string() -> None:
    assert blueprint_competency_count(_with_blueprint({}, competencies=7)) == 7
    assert blueprint_competency_count({}) == 0
    assert blueprint_competency_count({"blueprint": "not json at all {"}) == 0
    assert blueprint_competency_count({"blueprint": json.dumps({"competencies": "x"})}) == 0


# ── explicit matches are still trusted without a blueprint ───────────────────


def test_an_exact_catalog_title_still_resolves_without_a_blueprint() -> None:
    """The guard blocks GUESSES, not the catalog."""
    store = _load_store()
    exact = next(
        (k for k, slug in store.title_index.items() if slug in store.position_registry),
        None,
    )
    assert exact, "the catalog must expose at least one exact title"
    res = resolve_livekit_questions({"position": exact})
    assert res.resolution != "neutral_behavioral"


def test_explicit_backend_category_is_still_trusted() -> None:
    """position_category comes from the backend, it is not inferred from a title."""
    store = _load_store()
    cat = next((c for c, qs in store.categories.items() if qs), None)
    assert cat, "the catalog must expose at least one category with anchors"
    res = resolve_livekit_questions({"position": "HR Assistant", "position_category": cat})
    assert res.resolution == "category_slug"
    assert res.matched_key == cat


# ── the escape hatch ─────────────────────────────────────────────────────────


def test_the_guard_can_be_lifted_by_the_new_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """A NEW key — none of the 71 July secrets can reach this guard."""
    monkeypatch.setenv("INTERVIEW_FUZZY_BANK_WITHOUT_BLUEPRINT_V4", "true")
    res = resolve_livekit_questions(dict(HR_ASSISTANT))
    # the fuzzy tier is consulted again; the one-token fix still denies THIS match
    assert "hr-business-partner" not in (res.matched_key or "")
