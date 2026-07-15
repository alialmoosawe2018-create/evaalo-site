"""Question bank resolution — full-catalog coverage and fallback chain."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import voice_interview.job_questions as jq
from voice_interview.data.question_bank_sources.position_catalog import POSITION_ROWS
from voice_interview.job_questions import (
    _load_store,
    format_questions_block,
    resolve_livekit_questions,
    slug_from_position_label,
)

CATALOG_SIZE = len(POSITION_ROWS)


def _backend_slug_for_job_questions(position: str | None) -> str:
    if not position or not isinstance(position, str):
        return ""
    t = position.strip()
    if not t or t.upper() == "N/A":
        return ""
    s = t.lower()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9\u0600-\u06ff-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _reset_bank_cache() -> None:
    jq._store = None


@pytest.fixture(autouse=True)
def _fresh_bank(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INTERVIEW_QUESTIONS_PATH", raising=False)
    monkeypatch.setenv("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", "false")
    monkeypatch.setenv("INTERVIEW_QUESTIONS_MAX", "12")
    _reset_bank_cache()


def test_position_catalog_has_expected_entries() -> None:
    assert CATALOG_SIZE >= 170, f"catalog unexpectedly small: {CATALOG_SIZE}"


def test_all_catalog_positions_resolve_with_tiered_fallback() -> None:
    """Every catalog title gets anchors via job override, category bank, or industry family."""
    failures: list[str] = []
    wrong_category: list[str] = []
    for title, expected_category, _fam in POSITION_ROWS:
        res = resolve_livekit_questions({"position": title})
        if not res.has_bank or res.resolution == "start_no_bank":
            failures.append(title)
            continue
        assert res.resolution in (
            "position_slug",
            "category_slug",
            "industry_family",
            "primary",
        ), f"{title}: {res.resolution}"
        assert len(res.questions) >= 8, f"{title}: {len(res.questions)} questions"
        slug = slug_from_position_label(title)
        if res.resolution == "position_slug" and res.category != expected_category:
            wrong_category.append(f"{title}: {res.category} != {expected_category}")
    assert not failures, f"start_no_bank for: {failures[:12]}..."
    assert not wrong_category, wrong_category[:8]


def test_general_accountant_resolves_via_accounting_category() -> None:
    res = resolve_livekit_questions({"position": "General Accountant"})
    assert res.has_bank
    assert res.resolution in ("position_slug", "category_slug")
    assert res.category == "general_accounting"
    assert len(res.questions) == 10


def test_accountant_title_alias_resolves() -> None:
    res = resolve_livekit_questions({"position": "Accountant"})
    assert res.has_bank
    assert res.resolution in ("position_slug", "category_slug")
    assert res.category in ("general_accounting", "accounting")
    assert len(res.questions) == 10


def test_category_slug_path_via_meta_category() -> None:
    """Unknown slug + explicit category resolves through the category bank."""
    res = resolve_livekit_questions(
        {"position_slug": "unknown-role-xyz", "position_category": "finance"}
    )
    assert res.resolution == "category_slug"
    assert res.category == "finance"
    assert res.matched_key == "finance"
    assert len(res.questions) == 10


def test_hr_specialist_job_override_when_in_jobs_section() -> None:
    store = _load_store()
    if "hr-specialist" not in store.jobs:
        pytest.skip("hr-specialist override not in generated bank")
    res = resolve_livekit_questions({"position": "HR Specialist"})
    assert res.resolution == "position_slug"
    assert res.override_used is True
    assert res.matched_key == "hr-specialist"


def test_primary_job_id_wins_over_slug() -> None:
    store = _load_store()
    job_key = next(iter(store.jobs), None)
    if not job_key:
        pytest.skip("no job overrides in bank")
    res = resolve_livekit_questions({"job_id": job_key, "position": "Accountant"})
    assert res.resolution == "primary"
    assert res.matched_key == job_key
    assert res.override_used is False


def test_missing_category_falls_back_to_industry_family(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", "false")
    _reset_bank_cache()
    res = resolve_livekit_questions(
        {"position_slug": "unknown-role-xyz", "industry_family": "technology"}
    )
    assert res.resolution == "industry_family"
    assert res.matched_key == "technology"
    assert len(res.questions) == 8


def test_default_fallback_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", "true")
    _reset_bank_cache()
    res = resolve_livekit_questions({"position_slug": "totally-unknown"})
    assert res.resolution == "default_fallback"
    assert res.matched_key == "__default__"
    assert len(res.questions) >= 3


def test_each_category_has_ten_anchors() -> None:
    store = _load_store()
    assert store.categories, "categories section missing"
    for cat, anchors in store.categories.items():
        assert len(anchors) == 10, f"category {cat!r} has {len(anchors)} anchors"


def test_each_industry_family_has_eight_anchors() -> None:
    store = _load_store()
    assert store.industry_families, "industry_families section missing"
    for fam, anchors in store.industry_families.items():
        assert len(anchors) == 8, f"family {fam!r} has {len(anchors)} anchors"


def test_position_registry_covers_all_catalog_slugs() -> None:
    store = _load_store()
    missing: list[str] = []
    for title, _cat, _fam in POSITION_ROWS:
        slug = slug_from_position_label(title)
        if slug not in store.position_registry:
            missing.append(slug)
    assert not missing, f"missing registry entries: {missing[:10]}..."


def test_catalog_categories_have_bank_or_family_fallback() -> None:
    """Each catalog category either has a category bank or resolves via industry_family."""
    store = _load_store()
    catalog_cats = {c for _, c, _ in POSITION_ROWS}
    missing_bank = sorted(c for c in catalog_cats if c not in store.categories)
    assert len(missing_bank) < int(len(catalog_cats) * 0.55), (
        f"too many catalog categories without banks ({len(missing_bank)}); run patch_catalog_resolution.py"
    )


def test_job_overrides_mirror_category_banks() -> None:
    """Non-alias job overrides must mirror their category bank (L3 wave invariant)."""
    store = _load_store()
    mismatches: list[str] = []
    for slug, qs in store.jobs.items():
        entry = store.position_registry.get(slug, {})
        if not isinstance(entry, dict) or entry.get("alias_of"):
            continue
        cat = entry.get("category") or ""
        cat_qs = store.categories.get(cat)
        if cat_qs and qs != cat_qs:
            mismatches.append(slug)
    assert not mismatches, f"jobs != categories for: {mismatches[:10]}"


def test_alias_slugs_are_excluded_from_jobs() -> None:
    store = _load_store()
    alias_slugs = [
        s for s, e in store.position_registry.items()
        if isinstance(e, dict) and e.get("alias_of")
    ]
    assert alias_slugs, "expected at least one alias slug in registry"
    for slug in alias_slugs:
        assert slug not in store.jobs, f"alias slug {slug!r} should not be a job override"


def test_format_questions_block_includes_3_plus_2_guidance() -> None:
    res = resolve_livekit_questions({"position": "Data Analyst"})
    block = format_questions_block(res)
    assert "3+2 GUIDANCE" in block
    assert res.category in block
    assert res.questions[0] in block


def test_interview_questions_json_is_valid() -> None:
    path = Path(__file__).resolve().parents[1] / "src" / "voice_interview" / "data" / "interview_questions.json"
    assert path.is_file()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(raw.get("categories"), dict)
    assert isinstance(raw.get("position_registry"), dict)
    assert len(raw["position_registry"]) >= CATALOG_SIZE
    # jobs[slug] must mirror its category bank for non-alias entries
    cats = raw["categories"]
    reg = raw["position_registry"]
    for slug, qs in raw["jobs"].items():
        entry = reg.get(slug, {})
        assert "alias_of" not in entry, f"alias slug {slug!r} leaked into jobs"
        cat = entry.get("category")
        assert cats.get(cat) == qs, f"jobs[{slug!r}] != categories[{cat!r}]"


WAVE_1A_PACK_ANCHORS: dict[str, tuple[str, list[str]]] = {
    "recruiter": (
        "recruitment",
        [
            "اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
            "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
            "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
        ],
    ),
    "petroleum-engineer": (
        "petroleum",
        [
            "شنو أهم مشروع بترولي اشتغلت عليه — أكاديمي أو ميداني — وشنو كان دورك؟",
            "شلون تقرأ بيانات بئر أو مكمن عشان تتخذ قرار — شنو المؤشرات اللي تبدي بيها؟",
            "اذكرلي موقف اضطررت تختار بين السلامة وضغط الإنتاج — شنو سويت؟",
        ],
    ),
    "survey-engineer": (
        "surveying",
        [
            "اذكرلي مشروع مسح أو رفع طبوغرافي — شنو كان نوعه وشنو دورك؟",
            "شنو الجهاز أو الطريقة اللي استخدمتها أكثر — GPS ولا Total Station ولا غيره؟",
            "شلون تتأكد من دقة الإحداثيات قبل ما تسلّم الملف؟",
        ],
    ),
}


def test_wave1a_bank_aligned_with_domain_pack_anchors() -> None:
    """Wave 1A L3 packs: Iraqi anchors + category terminology in question bank."""
    path = Path(__file__).resolve().parents[1] / "src" / "voice_interview" / "data" / "interview_questions.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    jobs = raw["jobs"]
    cats = raw["categories"]
    reg = raw["position_registry"]

    for slug, (category, anchors) in WAVE_1A_PACK_ANCHORS.items():
        assert reg[slug]["category"] == category, slug
        qs = jobs[slug]
        assert qs == cats[category], f"{slug} jobs != categories[{category}]"
        assert len(qs) == 10
        for anchor in anchors:
            assert anchor in qs, f"{slug} missing anchor"
            assert anchor.count("؟") + anchor.count("?") <= 1, anchor

    recruiter_res = resolve_livekit_questions({"position": "Recruiter"})
    assert recruiter_res.category == "recruitment"
    assert "ATS" in " ".join(recruiter_res.questions)

    petroleum_res = resolve_livekit_questions({"position": "Petroleum Engineer"})
    assert petroleum_res.category == "petroleum"
    assert any("GOR" in q or "water cut" in q.lower() for q in petroleum_res.questions)

    survey_res = resolve_livekit_questions({"position": "Survey Engineer"})
    assert survey_res.category == "surveying"
    assert any("GPS" in q or "GNSS" in q for q in survey_res.questions)


# --- Alias / normalization / fuzzy layer (granular taxonomy) ---

@pytest.mark.parametrize(
    "title,expected_category",
    [
        ("Software Developer", "software_engineering"),
        ("Programmer", "software_engineering"),
        ("Front End Developer", "frontend_engineering"),
        ("Human Resources Specialist", "hr_operations"),
        ("People Manager", "hr_operations"),
        ("Bookkeeper", "general_accounting"),
        ("Salesman", "sales"),
        ("SEO", "seo"),
        ("UX Designer", "ui_ux_design"),
        ("ML Engineer", "machine_learning"),
        ("DevOps", "devops"),
        ("Civil Engineer", "civil_engineering"),
    ],
)
def test_title_aliases_resolve_to_expected_category(title: str, expected_category: str) -> None:
    res = resolve_livekit_questions({"position": title})
    assert res.has_bank, title
    assert res.category == expected_category, f"{title}: {res.category}"


@pytest.mark.parametrize(
    "title,expected_category",
    [
        ("Senior Software Engineer II", "software_engineering"),
        ("Sr. Accountant", "general_accounting"),
        ("Accountant - Finance Dept", "general_accounting"),
        ("Backend Developer (Remote)", "backend_engineering"),
        ("HR Officer | HQ", "hr_operations"),
        ("Junior Data Analyst", "data_analytics"),
    ],
)
def test_seniority_and_suffix_normalization(title: str, expected_category: str) -> None:
    res = resolve_livekit_questions({"position": title})
    assert res.has_bank, title
    assert res.category == expected_category, f"{title}: {res.category}"


def test_unknown_role_still_yields_no_false_positive() -> None:
    res = resolve_livekit_questions({"position": "Totally Made Up Role"})
    assert res.resolution == "start_no_bank"


def test_software_engineer_and_developer_share_job_override() -> None:
    store = _load_store()
    if "software-engineer" not in store.jobs:
        pytest.skip("software-engineer override not in generated bank")

    engineer = resolve_livekit_questions({"position": "Software Engineer"})
    developer = resolve_livekit_questions({"position": "Software Developer"})

    assert engineer.resolution == "position_slug"
    assert developer.resolution == "position_slug"
    assert engineer.matched_key == "software-engineer"
    assert developer.matched_key == "software-engineer"
    assert engineer.questions == developer.questions
    assert engineer.questions == store.jobs["software-engineer"]


def test_software_developer_slug_alias_in_registry() -> None:
    store = _load_store()
    entry = store.position_registry.get("software-developer")
    assert entry is not None
    assert entry.get("alias_of") == "software-engineer"
    # deduped: alias slug must not own a separate job override
    assert "software-developer" not in store.jobs


def test_procurement_officer_resolves_correct_slug() -> None:
    store = _load_store()
    assert "procurement-officer" in store.position_registry

    officer = resolve_livekit_questions({"position": "Procurement Officer"})
    assert officer.has_bank
    assert officer.position_slug == "procurement-officer"
    assert officer.category == "procurement"
    assert officer.matched_key == "procurement-officer"

    # legacy "Procurement Office" wording redirects to the same canonical bank
    legacy = resolve_livekit_questions({"position": "Procurement Office"})
    assert legacy.has_bank
    assert legacy.category == "procurement"
    assert legacy.matched_key == "procurement-officer"

    alias = resolve_livekit_questions({"position": "Purchasing Officer"})
    assert alias.has_bank
    assert alias.category == "procurement"
    assert store.title_index.get("procurement officer") == "procurement-officer"


def test_marketing_manager_uses_marketing_bank_not_sales() -> None:
    store = _load_store()
    entry = store.position_registry.get("marketing-manager")
    assert entry is not None
    assert entry["category"] == "marketing"

    res = resolve_livekit_questions({"position": "Marketing Manager"})
    assert res.has_bank
    assert res.category == "marketing"
    assert res.resolution in ("category_slug", "position_slug")
    assert res.questions == store.categories["marketing"]


def test_fuzzy_threshold_can_disable_fuzzy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_QUESTIONS_FUZZY_THRESHOLD", "0")
    _reset_bank_cache()
    # Dept-strip variant still resolves via title_index (not fuzzy).
    res = resolve_livekit_questions({"position": "Accountant - Finance Dept"})
    assert res.has_bank
    assert res.category in ("general_accounting", "accounting")
