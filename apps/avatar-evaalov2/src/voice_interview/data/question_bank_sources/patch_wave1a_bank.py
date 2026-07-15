#!/usr/bin/env python3
"""Patch Wave 1A role banks in interview_questions.json (no full catalog rebuild).

Aligns recruiter, petroleum-engineer, survey-engineer (and shared categories)
with domain pack anchors from apps/backend domainPacks.ts.

Usage (from apps/avatar-evaalov2):
  uv run python src/voice_interview/data/question_bank_sources/patch_wave1a_bank.py
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = DATA_DIR / "interview_questions.json"

WAVE_1A_CATEGORIES: dict[str, list[str]] = {
    "recruitment": [
        "اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
        "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
        "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
        "How do you use your ATS or candidate pipeline to compare candidates fairly after screening?",
        "Tell me about a time you changed sourcing strategy when LinkedIn or referrals underperformed.",
        "What recruiting metrics do you track — time to fill, offer acceptance rate, or source effectiveness?",
        "How do you run a structured interview without relying on gut feeling alone?",
        "Describe how you protect candidate experience when a hiring manager wants to skip steps.",
        "What boolean search or screening approach helped you fill a technical role faster?",
        "How do you reduce bias while keeping intake and offer decisions practical?",
    ],
    "talent_acquisition": [
        "اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟",
        "شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟",
        "شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟",
        "How do you use your ATS or candidate pipeline to compare candidates fairly after screening?",
        "Tell me about a time you changed sourcing strategy when LinkedIn or referrals underperformed.",
        "What recruiting metrics do you track — time to fill, offer acceptance rate, or source effectiveness?",
        "How do you run a structured interview without relying on gut feeling alone?",
        "Describe how you protect candidate experience when a hiring manager wants to skip steps.",
        "What boolean search or screening approach helped you fill a technical role faster?",
        "How do you reduce bias while keeping intake and offer decisions practical?",
    ],
    "petroleum": [
        "شنو أهم مشروع بترولي اشتغلت عليه — أكاديمي أو ميداني — وشنو كان دورك؟",
        "شلون تقرأ بيانات بئر أو مكمن عشان تتخذ قرار — شنو المؤشرات اللي تبدي بيها؟",
        "اذكرلي موقف اضطررت تختار بين السلامة وضغط الإنتاج — شنو سويت؟",
        "Describe a well performance issue where you reviewed water cut, GOR, or pressure data before recommending action.",
        "Tell me about using well testing or nodal analysis — what changed after your review?",
        "How do you coordinate field work with HSE, permits, and operations when schedules tighten?",
        "What artificial lift or production system have you worked with (ESP, gas lift, or similar)?",
        "How do you document field findings so engineering and operations teams can act on them?",
        "Describe uncertainty in reservoir or well data and how you communicated it to stakeholders.",
        "What would you inspect first on a new well or field assignment?",
    ],
    "oilfield": [
        "شنو أهم مشروع بترولي اشتغلت عليه — أكاديمي أو ميداني — وشنو كان دورك؟",
        "شلون تقرأ بيانات بئر أو مكمن عشان تتخذ قرار — شنو المؤشرات اللي تبدي بيها؟",
        "اذكرلي موقف اضطررت تختار بين السلامة وضغط الإنتاج — شنو سويت؟",
        "Describe a well performance issue where you reviewed water cut, GOR, or pressure data before recommending action.",
        "Tell me about using well testing or nodal analysis — what changed after your review?",
        "How do you coordinate field work with HSE, permits, and operations when schedules tighten?",
        "What artificial lift or production system have you worked with (ESP, gas lift, or similar)?",
        "How do you document field findings so engineering and operations teams can act on them?",
        "Describe uncertainty in reservoir or well data and how you communicated it to stakeholders.",
        "What would you inspect first on a new well or field assignment?",
    ],
    "surveying": [
        "اذكرلي مشروع مسح أو رفع طبوغرافي — شنو كان نوعه وشنو دورك؟",
        "شنو الجهاز أو الطريقة اللي استخدمتها أكثر — GPS ولا Total Station ولا غيره؟",
        "شلون تتأكد من دقة الإحداثيات قبل ما تسلّم الملف؟",
        "Describe how you set up control points or a benchmark network before field collection.",
        "Tell me about RTK or GNSS workflow you used and the accuracy tolerance you targeted.",
        "How do you handle closure error or conflicting coordinates before issuing deliverables?",
        "What coordinate system or datum (for example UTM) did you use and why?",
        "Describe stakeout or as-built survey work you supported on a construction project.",
        "How do you communicate survey limitations when site conditions affect accuracy?",
        "What would you check first when inheriting an unfinished topographic survey file?",
    ],
}

JOB_CATEGORY_PATCHES: dict[str, str] = {
    "recruiter": "recruitment",
    "petroleum-engineer": "petroleum",
    "survey-engineer": "surveying",
    "talent-acquisition-specialist": "talent_acquisition",
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

    for cat, bank in WAVE_1A_CATEGORIES.items():
        categories[cat] = list(bank)

    registry = raw.setdefault("position_registry", {})
    for slug, category in JOB_CATEGORY_PATCHES.items():
        entry = registry.get(slug)
        if isinstance(entry, dict):
            entry["category"] = category

    synced = _sync_jobs_from_categories(raw)

    OUT_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Patched {OUT_PATH.name} | wave1a_categories={len(WAVE_1A_CATEGORIES)} "
        f"registry_fixes={len(JOB_CATEGORY_PATCHES)} jobs_synced={synced}"
    )


if __name__ == "__main__":
    main()
