#!/usr/bin/env python3
"""Patch Wave 3 L3 Enriched banks in interview_questions.json.

Adds/updates production_oil_gas, general_accounting (bilingual anchors),
and syncs production-engineer-oil-and-gas job bank.

Usage (from apps/avatar-evaalov2):
  uv run python src/voice_interview/data/question_bank_sources/patch_wave3_bank.py
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = DATA_DIR / "interview_questions.json"

WAVE_3_CATEGORIES: dict[str, list[str]] = {
    "production_oil_gas": [
        "اذكر حالة انخفض فيها إنتاج بئر — شنو البيانات اللي راجعتها وشنو الإجراء؟",
        "شلون تشخّص انخفاض إنتاج بئر ببيانات water cut وGOR وضغط؟",
        "اذكرلي بئر أو موقع إنتاج تابعته — شنو المؤشرات اللي راجعتها يومياً؟",
        "Describe a well performance decline where you reviewed water cut, GOR, or pressure before recommending action.",
        "Tell me about artificial lift selection or troubleshooting (ESP, gas lift, or similar).",
        "How do you distinguish surface facility issues from reservoir or lift problems?",
        "What well testing or nodal analysis have you used to improve production?",
        "How do you coordinate field changes with HSE, permits, and operations?",
        "Describe how you monitor production after a well intervention or optimization.",
        "What would you inspect first on a new oilfield production assignment?",
    ],
    "general_accounting": [
        "صف دورة محاسبية كاملة — من القيود حتى ميزان المراجعة وشلون تضمن الدقة؟",
        "اذكرلي تسوية حساب اكتشفت فيها فرق — شلون تتبّعت السبب؟",
        "شنو دورك بالإقفال الشهري وشنو الفحوصات قبل التسليم؟",
        "Walk me through your month-end close process and the checks you use before submitting numbers.",
        "Describe a reconciliation issue you found and how you traced it to the source.",
        "How do you review financial statements and apply internal controls before reporting?",
        "Tell me about a time you discovered a financial error and corrected it responsibly.",
        "How do you handle competing deadlines for reporting, invoices, or tax work?",
        "What controls would you check first if account balances looked unusual?",
        "What would you review in your first month to understand our accounting environment?",
    ],
}

JOB_CATEGORY_PATCHES: dict[str, str] = {
    "production-engineer-oil-and-gas": "production_oil_gas",
    "general-accountant": "general_accounting",
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
    registry = raw.setdefault("position_registry", {})
    jobs = raw.setdefault("jobs", {})

    for cat, bank in WAVE_3_CATEGORIES.items():
        categories[cat] = list(bank)

    for slug, category in JOB_CATEGORY_PATCHES.items():
        entry = registry.get(slug)
        if isinstance(entry, dict):
            entry["category"] = category
        if slug in jobs or slug in registry:
            jobs[slug] = list(categories[category])

    synced = _sync_jobs_from_categories(raw)

    OUT_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Patched {OUT_PATH.name} | wave3_categories={len(WAVE_3_CATEGORIES)} "
        f"registry_fixes={len(JOB_CATEGORY_PATCHES)} jobs_synced={synced}"
    )


if __name__ == "__main__":
    main()
