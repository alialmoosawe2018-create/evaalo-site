#!/usr/bin/env python3
"""Patch Wave 1B engineering role banks in interview_questions.json.

Usage (from apps/avatar-evaalov2):
  uv run python src/voice_interview/data/question_bank_sources/patch_wave1b_bank.py
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = DATA_DIR / "interview_questions.json"

WAVE_1B_CATEGORIES: dict[str, list[str]] = {
    "reservoir": [
        "اذكرلي دراسة مكمن أو نموذج محاكاة اشتغلت عليه — شنو كان الهدف وشنو النتيجة؟",
        "شلون تقيّم أداء المكمن من بيانات الضغط والإنتاج — شنو المؤشرات الأساسية؟",
        "اذكرلي موقف ظهر فيه اختلاف كبير بين التنبؤ والإنتاج الفعلي — شنو سويت؟",
        "How do you build or update a reservoir model using pressure, production, and petrophysical data?",
        "Tell me about history matching with CMG or Eclipse — what inputs were most sensitive?",
        "How do you communicate uncertainty in OOIP, recovery factor, or forecast to management?",
        "What decline curve analysis have you used to support a development decision?",
        "Describe a material balance or PVT study that changed your reserves or recovery view.",
        "How do you validate simulation results before they drive operational changes?",
        "What reservoir metric do you monitor most closely when production deviates from plan?",
    ],
    "drilling": [
        "اذكرلي بئر أو عملية حفر شاركت بيها — شنو كان دورك وشنو التحدي الأصعب؟",
        "شلون تتعامل مع ضغط البئر أو سيطرة البئر أثناء الحفر — شنو الإجراءات اللي تتأكد منها؟",
        "اذكرلي حالة تغيّر فيها مخطط الحفر بسبب ظروف downhole — شنو القرار اللي اتخذته؟",
        "How do you evaluate mud weight, casing points, and drilling parameters for a new well?",
        "Tell me about a kick, influx, or well control situation and the steps you followed.",
        "How do you reduce NPT when rig operations face downhole or equipment problems?",
        "What BHA or directional drilling choice did you make and why?",
        "Describe coordination with rig crew, geology, and operations during a critical operation.",
        "How do you document lessons learned from a drilling problem?",
        "What would you review first before approving a drilling program change?",
    ],
    "civil_engineering": [
        "اذكرلي مشروع مدني اشتغلت عليه — شنو نوعه وشنو مسؤولياتك؟",
        "شلون تتأكد إن التصاميم أو الكميات مطابقة للمواصفات قبل التنفيذ؟",
        "اذكرلي مشكلة جودة أو سلامة بالموقع واجهتها كمهندس مدني — شنو سويت؟",
        "Describe a structural or civil design calculation you performed — what assumptions mattered most?",
        "How do you review shop drawings, BOQ, or AutoCAD/Civil 3D deliverables for errors?",
        "Tell me about a coordination issue with contractors or consultants and how it was resolved.",
        "What QA/QC or inspection step prevented a bigger defect on a civil project?",
        "How do you handle a drawing revision that affects quantities or structural details?",
        "What standards or codes guided your most recent civil engineering decision?",
        "What would you check first when joining a new civil design or site support role?",
    ],
    "site_engineering": [
        "اذكرلي موقع بناء أو مشروع اشرفت عليه — شنو كان حجم العمل وشنو دورك اليومي؟",
        "شلون تنسّق مع المقاولين والاستشاريين لما يصير تعارض بالمخططات؟",
        "اذكرلي موقف تأخّر فيه المشروع بسبب مشكلة ميدانية — شنو خطواتك؟",
        "How do you run daily site reporting, inspections, and work permit / HSE checks?",
        "Tell me about an RFI or site instruction you raised and how it was closed.",
        "Describe a quality or NCR issue you managed through to closure on site.",
        "How do you balance schedule pressure with inspection and safety requirements?",
        "What method statement or ITP step was critical on a project you supervised?",
        "How do you communicate a field problem to the consultant and the client?",
        "What would you inspect first when arriving on a new construction site?",
    ],
    "process_engineering": [
        "اذكرلي عملية أو وحدة هندسة عمليات صممتها أو حسّنتها — شنو الهدف وشنو النتيجة؟",
        "شلون تراجع توازن الكتلة أو الطاقة قبل تعديل العملية؟",
        "اذكرلي حالة اكتشفت فيها مخاطر عملية — شنو الإجراء اللي اتخذته؟",
        "How do you use PFD/P&ID reviews to identify operability or safety issues?",
        "Tell me about a HAZOP or process safety recommendation you helped implement.",
        "Describe troubleshooting a plant problem using DCS data, lab samples, or mass balance.",
        "How do you quantify debottlenecking or utility savings after a process change?",
        "What relief or operating envelope consideration changed your design or recommendation?",
        "How do you coordinate a process change with operations and maintenance for start-up?",
        "What would you review first on a new process unit assignment?",
    ],
}

JOB_CATEGORY_PATCHES: dict[str, str] = {
    "reservoir-engineer": "reservoir",
    "drilling-engineer": "drilling",
    "civil-engineer": "civil_engineering",
    "site-engineer": "site_engineering",
    "process-engineer": "process_engineering",
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
    title_index = raw.setdefault("title_index", {})

    for cat, bank in WAVE_1B_CATEGORIES.items():
        categories[cat] = list(bank)

    if "civil-engineer" not in registry:
        registry["civil-engineer"] = {
            "title": "Civil Engineer",
            "category": "civil_engineering",
            "industry_family": "engineering",
        }
        jobs["civil-engineer"] = list(categories["civil_engineering"])
        title_index["civil engineer"] = "civil-engineer"

    for slug, category in JOB_CATEGORY_PATCHES.items():
        entry = registry.get(slug)
        if isinstance(entry, dict):
            entry["category"] = category
        elif slug == "civil-engineer":
            pass  # created above
        else:
            print(f"  WARN missing registry entry for {slug!r}")

    synced = _sync_jobs_from_categories(raw)

    OUT_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Patched {OUT_PATH.name} | wave1b_categories={len(WAVE_1B_CATEGORIES)} "
        f"registry_fixes={len(JOB_CATEGORY_PATCHES)} jobs_synced={synced}"
    )


if __name__ == "__main__":
    main()
