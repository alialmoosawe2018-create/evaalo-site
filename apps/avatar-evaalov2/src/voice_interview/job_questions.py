"""Interview question banks — 3+2 guidance model with tiered fallback.

Resolution order (``resolve_livekit_questions``):
1. Mongo ``job_id`` / ``question_bank_job_id`` -> ``jobs`` section
2. ``position_slug`` -> ``jobs`` override (``override_used=True``)
3. ``position_registry`` category -> ``categories`` (primary coverage for 128 titles)
4. ``industry_family`` -> ``industry_families`` (safety net)
5. ``__default__`` if ``INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK=true``
6. ``start_no_bank``
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("agent")

# Role-specific terminology hints for dynamic LLM follow-ups (3+2 model).
CATEGORY_TERMINOLOGY: dict[str, str] = {
    "hr": "employee relations, policies, compliance, talent acquisition, onboarding, performance cycles",
    "finance": "reconciliation, controls, month-end close, audit trail, variance analysis, GAAP/IFRS context",
    "sales_marketing": "pipeline, conversion, campaigns, client objections, quotas, brand positioning",
    "software_engineering": "system design, debugging, deployment, code review, incident response, scalability",
    "data_ai": "data quality, modeling, metrics, stakeholder communication, experimentation, bias checks",
    "engineering_oil_gas": "HSE, field operations, wells, pipelines, reservoir, drilling, process safety",
    "engineering_civil_mep": "site coordination, specifications, contractors, QA/QC, schedules, MEP systems",
    "engineering_industrial": "process optimization, maintenance, downtime, root cause, quality control",
    "recruitment": "intake meeting, sourcing, ATS, candidate pipeline, time to fill, offer acceptance, boolean search, LinkedIn, structured interview",
    "reservoir": "history matching, material balance, PVT, decline curve, CMG, Eclipse, simulation, recovery factor, OOIP",
    "drilling": "well control, mud weight, casing, BHA, ROP, NPT, kick, MWD, cementing, HSE",
    "civil_engineering": "AutoCAD, Civil 3D, ETABS, rebar, concrete, BOQ, shop drawings, QA/QC, specifications",
    "site_engineering": "RFI, method statement, ITP, daily report, inspection, NCR, HSE, contractor coordination",
    "process_engineering": "PFD, P&ID, mass balance, HAZOP, relief, debottleneck, DCS, process safety, heat exchanger",
    "oilfield": "reservoir, well testing, water cut, GOR, ESP, gas lift, HSE, nodal analysis, bottomhole pressure, artificial lift",
    "petroleum": "reservoir, well testing, water cut, GOR, ESP, gas lift, HSE, nodal analysis, CMG, Petrel, artificial lift",
    "surveying": "GPS, GNSS, RTK, Total Station, leveling, control point, UTM, closure error, stakeout, topographic survey",
    "frontend": "React, TypeScript, component architecture, state management, accessibility, Core Web Vitals, bundle size, lazy loading",
    "devops": "CI/CD, Kubernetes, Docker, Terraform, IaC, GitOps, observability, Prometheus, Grafana, incident response, SLO",
    "analytics": "SQL, Power BI, Tableau, KPI, data quality, dashboard, funnel, cohort, A/B test, stakeholder communication",
    "qa": "test plan, regression, automation, Selenium, Cypress, bug report, repro steps, severity, API testing, exploratory testing",
    "customer_service": "ticket, SLA, CSAT, escalation, empathy, de-escalation, knowledge base, first contact resolution, CRM, Zendesk",
    "operations_coordination": "SOP, KPI, vendor management, scheduling, workflow, bottleneck, cross-functional, continuous improvement",
    "accounts_payable": "three-way match, invoice processing, PO, GRN, payment run, vendor reconciliation, ERP, SOX control, accruals",
    "financial_analysis": "FP&A, budget, forecast, variance analysis, P&L, cash flow, sensitivity, scenario planning, drivers, management report",
    "audit": "risk assessment, control testing, sampling, finding, workpaper, evidence, remediation, SOX, compliance, follow-up",
    "talent_acquisition": "intake meeting, sourcing, ATS, candidate pipeline, time to fill, offer acceptance, boolean search, LinkedIn, structured interview",
    "operations_logistics": "KPIs, throughput, vendors, supply chain, coordination, SLA adherence",
    "design_creative": "portfolio, user feedback, iteration, brand consistency, creative briefs",
    "leadership": "strategy, stakeholder alignment, team conflict, decision-making, accountability",
    "general_admin": "organization, reliability, customer service, multitasking, professionalism",
}

INDUSTRY_FAMILY_TERMINOLOGY: dict[str, str] = {
    "engineering": "technical standards, safety, cross-functional coordination, deliverables",
    "technology": "systems, quality, collaboration, troubleshooting, delivery",
    "business": "results, stakeholders, priorities, measurable outcomes",
    "creative": "briefs, feedback, craft, iteration",
    "leadership_admin": "priorities, professionalism, service, reliability",
}


@dataclass
class BankResolution:
    questions: list[str] = field(default_factory=list)
    resolution: str = "start_no_bank"
    matched_key: str = ""
    question_bank_source: str = ""
    position_slug: str = ""
    category: str = ""
    industry_family: str = ""
    override_used: bool = False

    @property
    def has_bank(self) -> bool:
        return bool(self.questions) and self.resolution != "start_no_bank"


@dataclass
class _QuestionBankStore:
    jobs: dict[str, list[str]]
    categories: dict[str, list[str]]
    industry_families: dict[str, list[str]]
    position_registry: dict[str, dict[str, str]]
    title_index: dict[str, str]
    default: list[str]


_store: _QuestionBankStore | None = None


def _truthy_env(key: str, default: bool) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


def _questions_path() -> Path:
    raw = (os.getenv("INTERVIEW_QUESTIONS_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent / "data" / "interview_questions.json").resolve()


def _normalize_title_key(title: str) -> str:
    s = (title or "").strip().lower()
    s = re.sub(r"[\s_/]+", " ", s)
    s = re.sub(r"[^a-z0-9\u0600-\u06ff ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


# Seniority / level qualifiers stripped during fuzzy normalization.
_SENIORITY_TOKENS: frozenset[str] = frozenset(
    {
        "senior", "sr", "junior", "jr", "lead", "principal", "staff", "chief",
        "head", "trainee", "intern", "entry", "mid", "level", "associate",
        "assistant", "i", "ii", "iii", "iv", "1", "2", "3",
    }
)

# Generic tokens that carry no role signal for token-overlap matching.
_GENERIC_TOKENS: frozenset[str] = frozenset(
    {"the", "a", "an", "of", "for", "and", "to", "in", "at", "remote", "onsite", "hybrid"}
)


def _title_variants(pos: str) -> list[str]:
    """Ordered normalized lookup keys for a free-text title (most→least specific)."""
    raw = (pos or "").strip()
    if not raw:
        return []
    variants: list[str] = []

    def _add(s: str) -> None:
        n = _normalize_title_key(s)
        if n and n not in variants:
            variants.append(n)

    _add(raw)
    # Drop parenthetical/bracketed qualifiers: "Backend Developer (Remote)"
    no_paren = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", raw)
    _add(no_paren)
    # Drop department/location after a separator: "Accountant - Finance Dept" / "Engineer | KSA"
    no_dept = re.split(r"\s*[-|\u2013\u2014:,/]\s*", no_paren, maxsplit=1)[0]
    _add(no_dept)
    # Drop seniority tokens: "Senior Software Engineer II" -> "software engineer"
    base_norm = _normalize_title_key(no_dept)
    stripped = " ".join(t for t in base_norm.split() if t not in _SENIORITY_TOKENS)
    _add(stripped)
    return variants


def _meaningful_tokens(norm: str) -> set[str]:
    return {
        t
        for t in norm.split()
        if t and t not in _SENIORITY_TOKENS and t not in _GENERIC_TOKENS
    }


def _fuzzy_match_slug(store: _QuestionBankStore, pos: str) -> tuple[str, str] | None:
    """Best-effort token-overlap match against title_index. Returns (slug, key)."""
    try:
        threshold = float(os.getenv("INTERVIEW_QUESTIONS_FUZZY_THRESHOLD", "0.6"))
    except ValueError:
        threshold = 0.6
    if threshold <= 0 or not store.title_index:
        return None
    candidates = {tok for v in _title_variants(pos) for tok in _meaningful_tokens(v)}
    if not candidates:
        return None
    best_slug = ""
    best_key = ""
    best_score = 0.0
    for key, slug in store.title_index.items():
        if slug not in store.position_registry:
            continue
        key_tokens = _meaningful_tokens(key)
        if not key_tokens:
            continue
        inter = candidates & key_tokens
        if not inter:
            continue
        union = candidates | key_tokens
        jaccard = len(inter) / len(union)
        # Reward full containment (e.g. candidate ⊆ key or key ⊆ candidate).
        if candidates <= key_tokens or key_tokens <= candidates:
            jaccard = max(jaccard, 0.75)
        if jaccard > best_score:
            best_score, best_slug, best_key = jaccard, slug, key
    if best_slug and best_score >= threshold:
        return best_slug, best_key
    return None


def _parse_question_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def _load_store() -> _QuestionBankStore:
    global _store
    if _store is not None:
        return _store
    empty = _QuestionBankStore({}, {}, {}, {}, {}, [])
    path = _questions_path()
    if not path.is_file():
        logger.info("Interview questions file not found (optional): %s", path)
        _store = empty
        return _store
    try:
        with path.open(encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            _store = empty
            return _store
        jobs_raw = raw.get("jobs")
        if isinstance(jobs_raw, dict):
            jobs = {k.strip(): _parse_question_list(v) for k, v in jobs_raw.items() if k.strip()}
        else:
            # Legacy flat { "slug": [...] } under top-level or nested jobs key absent
            jobs = {}
            for k, v in raw.items():
                if k in ("categories", "industry_families", "position_registry", "title_index"):
                    continue
                if k.startswith("__") or k == "default":
                    continue
                if isinstance(k, str) and isinstance(v, list):
                    jobs[k.strip()] = _parse_question_list(v)
        categories = {
            k.strip(): _parse_question_list(v)
            for k, v in (raw.get("categories") or {}).items()
            if isinstance(k, str) and k.strip()
        }
        families = {
            k.strip(): _parse_question_list(v)
            for k, v in (raw.get("industry_families") or {}).items()
            if isinstance(k, str) and k.strip()
        }
        registry = {
            k.strip(): v
            for k, v in (raw.get("position_registry") or {}).items()
            if isinstance(k, str) and k.strip() and isinstance(v, dict)
        }
        title_index = {
            str(k).strip(): str(v).strip()
            for k, v in (raw.get("title_index") or {}).items()
            if str(k).strip() and str(v).strip()
        }
        default = _parse_question_list(raw.get("__default__") or raw.get("default") or [])
        _store = _QuestionBankStore(jobs, categories, families, registry, title_index, default)
        logger.info(
            "Loaded question bank | path=%s jobs=%d categories=%d families=%d registry=%d",
            path,
            len(jobs),
            len(categories),
            len(families),
            len(registry),
        )
    except Exception as e:
        logger.warning("Failed to load interview questions from %s: %s", path, e)
        _store = empty
    return _store


def _canonical_slug(slug_key: str) -> str:
    """Follow ``alias_of`` in position_registry (e.g. software-developer -> software-engineer)."""
    store = _load_store()
    if not slug_key:
        return slug_key
    entry = store.position_registry.get(slug_key)
    if entry and entry.get("alias_of"):
        return str(entry["alias_of"]).strip()
    return slug_key


def _resolve_jobs_anchors(store: _QuestionBankStore, slug_key: str) -> tuple[list[str] | None, str]:
    """Try raw slug then canonical alias when looking up position-specific job overrides."""
    if not slug_key:
        return None, ""
    canonical = _canonical_slug(slug_key)
    for key in dict.fromkeys((slug_key, canonical)):
        qs = store.jobs.get(key)
        if qs:
            return qs, key
    return None, ""


def slug_from_position_label(position: str) -> str:
    """Match backend slug for JSON keys (e.g. 'Software Engineer' -> 'software-engineer')."""
    s = (position or "").strip().lower()
    if not s:
        return ""
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9\u0600-\u06ff\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def primary_job_id_from_meta(meta: dict[str, Any]) -> str:
    for key in ("question_bank_job_id", "job_id", "jobId"):
        v = str(meta.get(key) or "").strip()
        if v:
            return v
    return ""


def position_slug_from_meta(meta: dict[str, Any]) -> str:
    v = str(meta.get("position_slug") or "").strip()
    if v:
        return v
    if _truthy_env("INTERVIEW_QUESTIONS_INFER_FROM_POSITION", True):
        pos = str(meta.get("position") or "").strip()
        if pos and pos.upper() != "N/A":
            return slug_from_position_label(pos)
    return ""


def _resolve_registry_entry(meta: dict[str, Any], slug_key: str) -> dict[str, str] | None:
    store = _load_store()
    if slug_key and slug_key in store.position_registry:
        return store.position_registry[slug_key]
    if slug_key:
        alias = store.position_registry.get(slug_key)
        if alias and alias.get("alias_of"):
            canonical = str(alias["alias_of"])
            return store.position_registry.get(canonical)
    meta_cat = str(meta.get("position_category") or "").strip()
    meta_family = str(meta.get("industry_family") or "").strip()
    if meta_cat or meta_family:
        return {
            "title": str(meta.get("position") or slug_key or ""),
            "category": meta_cat,
            "industry_family": meta_family,
        }
    pos = str(meta.get("position") or "").strip()
    if pos and pos.upper() != "N/A":
        # 1) Normalized variants → title_index (exact, parenthetical/dept/seniority-stripped).
        for variant in _title_variants(pos):
            canonical_slug = store.title_index.get(variant)
            if canonical_slug and canonical_slug in store.position_registry:
                if variant != _normalize_title_key(pos):
                    logger.info(
                        "Question bank: matched %r via normalized variant %r -> %s",
                        pos, variant, canonical_slug,
                    )
                return store.position_registry[canonical_slug]
        # 2) Slugified variant directly present in registry.
        for variant in _title_variants(pos):
            vslug = slug_from_position_label(variant)
            if vslug and vslug in store.position_registry:
                return store.position_registry[vslug]
        # 3) Fuzzy token-overlap fallback (safety net before industry_family/default).
        fuzzy = _fuzzy_match_slug(store, pos)
        if fuzzy:
            slug, key = fuzzy
            logger.info(
                "Question bank: fuzzy-matched %r -> %s (via %r)", pos, slug, key
            )
            return store.position_registry[slug]
    return None


def _trim_question_lines(raw: list[str]) -> list[str]:
    try:
        max_n = int(os.getenv("INTERVIEW_QUESTIONS_MAX", "12"))
    except ValueError:
        max_n = 12
    max_n = max(1, min(40, max_n))
    try:
        max_c = int(os.getenv("INTERVIEW_QUESTION_MAX_CHARS", "160"))
    except ValueError:
        max_c = 160
    max_c = max(40, min(500, max_c))
    out: list[str] = []
    for q in raw[:max_n]:
        line = q.strip()
        if len(line) > max_c:
            line = line[: max_c - 1] + "…"
        out.append(line)
    return out


def _make_resolution(
    questions: list[str],
    *,
    resolution: str,
    matched_key: str,
    question_bank_source: str,
    position_slug: str,
    category: str,
    industry_family: str,
    override_used: bool,
) -> BankResolution:
    trimmed = _trim_question_lines(questions)
    return BankResolution(
        questions=trimmed,
        resolution=resolution,
        matched_key=matched_key,
        question_bank_source=question_bank_source,
        position_slug=position_slug,
        category=category,
        industry_family=industry_family,
        override_used=override_used,
    )


def log_question_bank_resolved(res: BankResolution) -> None:
    logger.info(
        "question_bank_resolved | %s",
        json.dumps(
            {
                "event": "question_bank_resolved",
                "resolution": res.resolution,
                "category": res.category or None,
                "question_bank_source": res.question_bank_source or None,
                "position_slug": res.position_slug or None,
                "override_used": res.override_used,
                "anchor_count": len(res.questions),
                "matched_key": res.matched_key or None,
            },
            ensure_ascii=False,
        ),
    )


def resolve_livekit_questions(meta: dict[str, Any]) -> BankResolution:
    """Resolve anchor questions with tiered fallback. Returns ``BankResolution``."""
    store = _load_store()
    job_key = primary_job_id_from_meta(meta)
    slug_key = position_slug_from_meta(meta)
    registry = _resolve_registry_entry(meta, slug_key)
    category = str((registry or {}).get("category") or "").strip()
    industry_family = str((registry or {}).get("industry_family") or "").strip()

    if job_key:
        qs = store.jobs.get(job_key)
        if qs:
            res = _make_resolution(
                qs,
                resolution="primary",
                matched_key=job_key,
                question_bank_source=category or job_key,
                position_slug=slug_key,
                category=category,
                industry_family=industry_family,
                override_used=False,
            )
            log_question_bank_resolved(res)
            return res
        logger.info(
            "Interview question bank: no entry for primary key %r — trying slug=%r category=%r",
            job_key,
            slug_key or "",
            category or "",
        )

    if slug_key:
        qs, matched_job_key = _resolve_jobs_anchors(store, slug_key)
        if qs:
            res = _make_resolution(
                qs,
                resolution="position_slug",
                matched_key=matched_job_key,
                question_bank_source=category or matched_job_key,
                position_slug=slug_key,
                category=category,
                industry_family=industry_family,
                override_used=True,
            )
            log_question_bank_resolved(res)
            return res

    if category:
        qs = store.categories.get(category)
        if qs:
            res = _make_resolution(
                qs,
                resolution="category_slug",
                matched_key=category,
                question_bank_source=category,
                position_slug=slug_key,
                category=category,
                industry_family=industry_family,
                override_used=False,
            )
            log_question_bank_resolved(res)
            return res
        logger.info(
            "Interview question bank: category %r has no anchors — trying industry_family=%r",
            category,
            industry_family or "",
        )

    if industry_family:
        qs = store.industry_families.get(industry_family)
        if qs:
            res = _make_resolution(
                qs,
                resolution="industry_family",
                matched_key=industry_family,
                question_bank_source=industry_family,
                position_slug=slug_key,
                category=category,
                industry_family=industry_family,
                override_used=False,
            )
            log_question_bank_resolved(res)
            return res

    if _truthy_env("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", False) and store.default:
        logger.warning(
            "Interview question bank: using __default__ (INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK=true)"
        )
        res = _make_resolution(
            store.default,
            resolution="default_fallback",
            matched_key="__default__",
            question_bank_source="__default__",
            position_slug=slug_key,
            category=category,
            industry_family=industry_family,
            override_used=False,
        )
        log_question_bank_resolved(res)
        return res

    logger.warning(
        "Interview question bank: start_no_bank (job_id=%r slug=%r category=%r family=%r)",
        job_key or None,
        slug_key or None,
        category or None,
        industry_family or None,
    )
    return BankResolution(
        position_slug=slug_key,
        category=category,
        industry_family=industry_family,
    )


def resolve_job_id_for_questions(meta: dict[str, Any]) -> str:
    jid = primary_job_id_from_meta(meta)
    if jid:
        return jid
    return position_slug_from_meta(meta)


def get_questions_for_job(job_id: str) -> list[str]:
    jid = (job_id or "").strip()
    if not jid:
        return []
    store = _load_store()
    qs = store.jobs.get(jid) or store.categories.get(jid) or store.industry_families.get(jid)
    if not qs and _truthy_env("INTERVIEW_QUESTIONS_USE_DEFAULT_FALLBACK", False):
        qs = store.default
    if not qs:
        return []
    return _trim_question_lines(qs)


def format_questions_block(res: BankResolution | str, questions: list[str] | None = None) -> str:
    """Build interview context block for anchor questions + 3+2 guidance.

    Accepts ``BankResolution`` (preferred) or legacy ``(matched_key, questions)`` via
    positional overload: ``format_questions_block(matched_key, questions)``.
    """
    if isinstance(res, BankResolution):
        bank = res
    else:
        bank = BankResolution(
            questions=list(questions or []),
            matched_key=str(res or ""),
            question_bank_source=str(res or ""),
        )

    if not bank.questions:
        return ""

    source = bank.question_bank_source or bank.category or bank.matched_key
    terminology = CATEGORY_TERMINOLOGY.get(bank.category or "") or INDUSTRY_FAMILY_TERMINOLOGY.get(
        bank.industry_family or ""
    )

    lines = [
        "",
        "QUESTION BANK CONTEXT:",
        f"- resolution: {bank.resolution}",
        f"- question_bank_source: {source or '(none)'}",
        f"- position_slug: {bank.position_slug or '(none)'}",
        f"- category: {bank.category or '(none)'}",
        f"- industry_family: {bank.industry_family or '(none)'}",
        f"- override_used: {'true' if bank.override_used else 'false'}",
        "",
    ]
    if source and source not in ("__default__", "(none)"):
        lines.append(
            f"The candidate is interviewing for a role mapped to the "
            f"**{source.replace('_', ' ')}** question bank."
        )
        if terminology:
            lines.append(
                f"Use domain terminology when probing follow-ups: {terminology}."
            )
        lines.append(
            "Do not ask generic fillers like 'Can you tell me more?' — probe specific details."
        )
        lines.append("")

    lines.append(
        "Suggested anchor topics (inspiration only — reshape into one short SPOKEN question; "
        "never translate word-for-word from English, never read verbatim):"
    )
    for i, q in enumerate(bank.questions, 1):
        lines.append(f"  {i}. {q}")

    lines.extend(
        [
            "",
            "3+2 GUIDANCE (Hybrid mode):",
            "- Use the 3 anchors as inspiration for early turns; adapt wording to the candidate's language.",
            "- After each anchor answer, ask at least 2 probing follow-ups tailored to THEIR specific answer.",
            "- Do not repeat anchor questions verbatim; do not treat the list as a rigid script.",
            "- Choose adaptively using decision-frame heuristics and the candidate's answer flow.",
        ]
    )
    if bank.matched_key:
        lines.append(f"(Matched bank key: {bank.matched_key})")
    return "\n".join(lines)


# Legacy flat bank loader for tests that patch _bank
def _load_bank() -> dict[str, list[str]]:
    store = _load_store()
    merged = dict(store.jobs)
    merged.update(store.categories)
    merged.update(store.industry_families)
    if store.default:
        merged["__default__"] = store.default
    return merged


def _normalize_bank(raw: Any) -> dict[str, list[str]]:
    """Legacy helper — merges jobs + categories into one dict."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for section in ("jobs",):
        jobs = raw.get(section)
        if isinstance(jobs, dict):
            for k, v in jobs.items():
                if isinstance(k, str) and isinstance(v, list):
                    qs = _parse_question_list(v)
                    if qs:
                        out[k.strip()] = qs
    if not out:
        for k, v in raw.items():
            if k in ("categories", "industry_families", "position_registry", "title_index"):
                continue
            if isinstance(k, str) and isinstance(v, list):
                qs = _parse_question_list(v)
                if qs and not k.startswith("__"):
                    out[k.strip()] = qs
    return out
