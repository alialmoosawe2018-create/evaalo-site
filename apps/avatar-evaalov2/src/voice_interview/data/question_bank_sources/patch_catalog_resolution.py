#!/usr/bin/env python3
"""Bridge catalog category names to existing question banks + legacy title aliases.

Run after build_question_bank.py and wave patches:
  uv run python src/voice_interview/data/question_bank_sources/patch_catalog_resolution.py

Does NOT invent new question text — mirrors existing category banks where safe.
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = DATA_DIR / "interview_questions.json"

# catalog category -> existing categories[key] bank (must exist in JSON)
CATEGORY_MIRRORS: dict[str, str] = {
    "accounting_leadership": "accounting",
    "accounts_receivable": "accounting",
    "cost_accounting": "accounting",
    "general_accounting": "accounting",
    "data_analytics": "analytics",
    "business_analysis": "analytics",
    "business_intelligence": "analytics",
    "data_engineering": "data_engineer",
    "data_science": "data_scientist",
    "database_administration": "dba",
    "backend_engineering": "backend",
    "frontend_engineering": "frontend",
    "fullstack_engineering": "fullstack",
    "cloud_engineering": "devops",
    "computer_engineering": "software_engineering",
    "customer_support": "customer_service",
    "hr_operations": "hr",
    "hr_generalist": "hr",
    "hr_business_partner": "hr",
    "hr_management": "hr",
    "employee_relations": "hr",
    "ui_ux_design": "uiux",
    "machine_learning": "ml",
    "marketing": "digital_marketing",
    "financial_control": "finance",
    "internal_audit": "audit",
    "external_audit": "audit",
    "operations": "operations_coordination",
    "logistics": "operations_logistics",
    "quality_assurance": "qa",
    "software_testing": "qa",
    "electrical_engineering": "electrical_mep",
    "mechanical_engineering": "industrial",
    "civil_engineering": "civil_engineering",
    "site_engineering": "site_engineering",
    "process_engineering": "process_engineering",
    "drilling": "drilling",
    "reservoir": "reservoir",
    "petroleum": "petroleum",
    "surveying": "surveying",
    "oil_gas_field": "oilfield",
    "accounts_payable": "accounts_payable",
}

TITLE_INDEX_ADDITIONS: dict[str, str] = {
    "accountant": "general-accountant",
    "bookkeeper": "general-accountant",
    "sr accountant": "general-accountant",
    "senior accountant": "chief-accountant",
    "human resources specialist": "hr-specialist",
    "hr officer": "hr-specialist",
    "people manager": "hr-specialist",
    "software developer": "software-engineer",
    "programmer": "software-engineer",
    "front end developer": "frontend-developer",
    "ml engineer": "machine-learning-engineer",
    "ux designer": "uiux-designer",
}

REGISTRY_CATEGORY_FIXES: dict[str, str] = {
    "marketing-manager": "marketing",
    "customer-support-specialist": "customer_support",
    "data-analyst": "data_analytics",
    "frontend-developer": "frontend_engineering",
}


def _sync_jobs_from_categories(payload: dict) -> int:
    jobs = payload.setdefault("jobs", {})
    categories = payload.get("categories") or {}
    registry = payload.get("position_registry") or {}
    updated = 0
    for slug, entry in registry.items():
        if not isinstance(entry, dict) or entry.get("alias_of"):
            continue
        category = entry.get("category") or ""
        bank = categories.get(category)
        if not bank:
            continue
        if jobs.get(slug) != bank:
            jobs[slug] = list(bank)
            updated += 1
    return updated


def main() -> None:
    raw = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    categories = raw.setdefault("categories", {})
    title_index = raw.setdefault("title_index", {})
    registry = raw.setdefault("position_registry", {})

    mirrored = 0
    for cat, source in CATEGORY_MIRRORS.items():
        bank = categories.get(source)
        if not bank:
            print(f"  WARN mirror source missing: {source!r} for {cat!r}")
            continue
        if categories.get(cat) != bank:
            categories[cat] = list(bank)
            mirrored += 1

    titles_added = 0
    for title, slug in TITLE_INDEX_ADDITIONS.items():
        if title_index.get(title) != slug:
            title_index[title] = slug
            titles_added += 1

    registry_fixes = 0
    for slug, category in REGISTRY_CATEGORY_FIXES.items():
        entry = registry.get(slug)
        if isinstance(entry, dict) and entry.get("category") != category:
            entry["category"] = category
            registry_fixes += 1

    synced = _sync_jobs_from_categories(raw)

    OUT_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Patched {OUT_PATH.name} | category_mirrors={mirrored} "
        f"title_index={titles_added} registry_fixes={registry_fixes} jobs_synced={synced}"
    )


if __name__ == "__main__":
    main()
