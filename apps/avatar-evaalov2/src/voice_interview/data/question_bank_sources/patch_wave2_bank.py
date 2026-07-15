#!/usr/bin/env python3
"""Patch Wave 2 role banks in interview_questions.json (tech, ops, finance).

Usage (from apps/avatar-evaalov2):
  uv run python src/voice_interview/data/question_bank_sources/patch_wave2_bank.py
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = DATA_DIR / "interview_questions.json"

WAVE_2_CATEGORIES: dict[str, list[str]] = {
    "frontend": [
        "اذكرلي شاشة أو ميزة واجهة بنيتها — شنو التحدي التقني وشنو النتيجة؟",
        "شلون تحسّن أداء صفحة بطيئة — شنو القياسات اللي استخدمتها؟",
        "اذكرلي موقف اضطررت تتعاون وية التصميم أو الباكند لحل مشكلة بالواجهة؟",
        "Walk through a React or TypeScript feature — how did you handle state management and API integration?",
        "How do you improve Core Web Vitals, bundle size, or lazy loading on a slow page?",
        "Tell me about accessibility work — ARIA, keyboard navigation, or contrast fixes.",
        "How do you debug a UI issue that only appears on certain browsers or screen sizes?",
        "Describe your testing approach with Testing Library, Cypress, or component tests.",
        "How do you keep a design system or component architecture maintainable as the product grows?",
        "What would you inspect first when joining an existing frontend codebase?",
    ],
    "devops": [
        "اذكرلي pipeline أو بنية تحتية حسّنتها — شنو المشكلة وشنو النتيجة؟",
        "شلون تتعامل مع حادث إنتاج — شنو خطواتك من الاكتشاف للحل؟",
        "اذكرلي قرار استخدمت بيه Terraform أو Kubernetes وشنو المقايضة؟",
        "Describe a CI/CD pipeline you built or improved — what changed in delivery quality?",
        "How do you manage infrastructure as code, secrets, and least-privilege access?",
        "Tell me about an incident — how did monitoring, Prometheus, or Grafana help you respond?",
        "How do you design rollback, canary, or GitOps practices for safer deployments?",
        "What SLO or SLA targets do you track and how do you report them?",
        "How do you automate a manual operational task without hiding risk?",
        "What would you review first in a new Kubernetes or cloud environment?",
    ],
    "analytics": [
        "اذكرلي تحليل بيانات أثر على قرار — شنو السؤال وشنو النتيجة؟",
        "شلون تتأكد من جودة البيانات قبل ما تقدم تقرير؟",
        "اذكرلي dashboard أو KPI تابعته — شنو اللي اكتشفته؟",
        "Walk me through a SQL analysis or Power BI dashboard that changed a business decision.",
        "How do you validate data quality, duplicates, or anomalies before reporting?",
        "Tell me about defining KPIs, cohorts, or funnel metrics stakeholders actually used.",
        "How do you present findings to non-technical stakeholders without losing accuracy?",
        "Describe an A/B test or variance analysis you ran — what was the recommendation?",
        "How do you handle missing or inconsistent data in ETL or spreadsheet workflows?",
        "What would you investigate first in a new analytics environment?",
    ],
    "qa": [
        "اذكرلي مشكلة جودة اكتشفتها قبل الإطلاق — شنو أثرها لو ما انكشفت؟",
        "شلون تختار شنو تؤتمت وشنو تختبر يدوياً؟",
        "اذكرلي bug صعب — شلون وثّقته وتابعته للإغلاق؟",
        "Walk me through your test plan and regression strategy before a release.",
        "How do you write a high-quality bug report with repro steps, severity, and logs?",
        "Tell me about test automation with Selenium, Cypress, or API testing with Postman.",
        "How do you test edge cases, permissions, and integrations beyond happy paths?",
        "Describe exploratory testing that found a critical issue automation missed.",
        "How do you work with developers on triage without becoming a release bottleneck?",
        "What quality metric would you monitor for this product or team?",
    ],
    "customer_service": [
        "اذكرلي شكوى عميل صعبة — شنو سويت وشنو النتيجة؟",
        "شلون توازن بين سياسة الشركة ورغبة العميل؟",
        "اذكرلي موقف اضطررت تصعّد فيه التذكرة — شنو الخطوات؟",
        "Describe a difficult ticket you resolved — how did empathy and SLA pressure interact?",
        "How do you document tickets, escalations, and follow-ups in a CRM or Zendesk?",
        "Tell me about de-escalating an angry customer while protecting company policy.",
        "How do you achieve first contact resolution or improve CSAT on your queue?",
        "What product knowledge or knowledge base habit helps you answer faster?",
        "Describe escalating at the right moment — what information did you include?",
        "What support metric matters most to you and why?",
    ],
    "operations_coordination": [
        "اذكرلي عملية أو تدفق عمل حسّنته — شنو كان الخلل وشنو النتيجة؟",
        "شلون تنسّق بين فرق أو موردين لما يصير ضغط على الجدول؟",
        "اذكرلي مؤشر عمليات تتابعه دايماً — ليش اخترته؟",
        "Describe an SOP or workflow improvement — what bottleneck did you remove?",
        "How do you manage vendors, SLAs, and follow-up when delivery is at risk?",
        "Tell me about prioritizing schedules, resources, and cross-functional handoffs.",
        "How do you report operational KPIs or variance to leadership clearly?",
        "Describe a root cause fix in daily operations — not just a temporary patch.",
        "How do you align stakeholders when departments have competing priorities?",
        "What would you assess first when taking over an operations coordination role?",
    ],
    "accounts_payable": [
        "اذكرلي فاتورة أو دفعة اكتشفت فيها خطأ — شنو سويت؟",
        "شلون تسوي three-way match عملياً قبل ما توافق على الدفع؟",
        "اذكرلي نهاية شهر ضاغطة — شلون ضليت الدقة والموعد؟",
        "Walk me through invoice processing with PO, GRN, and three-way match controls.",
        "How do you prevent duplicate payments or approval workflow bypasses?",
        "Tell me about vendor statement reconciliation and resolving variances.",
        "How do you handle payment run cut-off, batch priorities, and accruals?",
        "Describe SOX or segregation-of-duties controls you rely on in AP.",
        "How do you use ERP workflow for AP without losing audit trail?",
        "What would you review first in a new accounts payable process?",
    ],
    "financial_analysis": [
        "اذكرلي تحليل variance أثر على قرار — شنو السبب والرقم؟",
        "شلون تبني أو تحدّث توقعات مالية لربع أو سنة؟",
        "اذكرلي نموذج مالي — شنو أهم افتراضاته؟",
        "Describe an FP&A forecast or Excel model — what drivers and scenarios mattered most?",
        "How do you explain budget vs actual variance to non-finance leaders?",
        "Tell me about a rolling forecast update when assumptions changed mid-quarter.",
        "How do you reconcile data sources before trusting a management report?",
        "What sensitivity or scenario analysis changed a recommendation?",
        "How do you partner with business stakeholders on a measurable decision?",
        "What KPI would you check first in our financial performance?",
    ],
    "audit": [
        "اذكرلي تدقيق أو مراجعة ضوابط — شنو اكتشفت وشنو التوصية؟",
        "شلون تختار عينة أو نطاق مراجعة بناءً على المخاطر؟",
        "اذكرلي ملاحظة متابعةتها لحد الإغلاق — شنو كان التحدي؟",
        "Describe risk assessment and control testing — design vs operating effectiveness.",
        "How do you document findings with criteria, condition, cause, and recommendation?",
        "Tell me about audit sampling, workpapers, and evidence you would defend.",
        "How do you follow up on remediation without losing independence?",
        "Describe communicating audit risk tactfully to management.",
        "What SOX or compliance context shaped your most recent audit?",
        "What would you review first when auditing a new business process?",
    ],
}

JOB_CATEGORY_PATCHES: dict[str, str] = {
    "frontend-developer": "frontend",
    "devops-engineer": "devops",
    "data-analyst": "analytics",
    "qa-engineer-tester": "qa",
    "customer-support-specialist": "customer_service",
    "operations-manager": "operations_coordination",
    "financial-analyst": "financial_analysis",
    "auditor": "audit",
    "accounts-payable-officer": "accounts_payable",
}

NEW_REGISTRY_ENTRIES: dict[str, dict[str, str]] = {
    "accounts-payable-officer": {
        "title": "Accounts Payable Officer",
        "category": "accounts_payable",
        "industry_family": "business",
    },
    "qa-engineer-tester": {
        "title": "QA Engineer / Tester",
        "category": "qa",
        "industry_family": "technology",
    },
    "customer-support-specialist": {
        "title": "Customer Support Specialist",
        "category": "customer_service",
        "industry_family": "customer_operations",
    },
    "operations-manager": {
        "title": "Operations Manager",
        "category": "operations_coordination",
        "industry_family": "business",
    },
    "auditor": {
        "title": "Auditor",
        "category": "audit",
        "industry_family": "business",
    },
}

NEW_TITLE_INDEX: dict[str, str] = {
    "accounts payable officer": "accounts-payable-officer",
    "accounts payable": "accounts-payable-officer",
    "internal auditor": "auditor",
    "qa engineer": "qa-engineer-tester",
    "qa engineer tester": "qa-engineer-tester",
    "customer support specialist": "customer-support-specialist",
    "customer support": "customer-support-specialist",
    "operations manager": "operations-manager",
    "operations coordinator": "operations-manager",
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

    for cat, bank in WAVE_2_CATEGORIES.items():
        categories[cat] = list(bank)

    for slug, meta in NEW_REGISTRY_ENTRIES.items():
        registry[slug] = dict(meta)
        jobs[slug] = list(categories[meta["category"]])

    for title, slug in NEW_TITLE_INDEX.items():
        title_index[title] = slug

    for slug, category in JOB_CATEGORY_PATCHES.items():
        entry = registry.get(slug)
        if isinstance(entry, dict):
            entry["category"] = category
        elif slug in NEW_REGISTRY_ENTRIES:
            pass
        else:
            print(f"  WARN missing registry entry for {slug!r}")

    synced = _sync_jobs_from_categories(raw)

    OUT_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Patched {OUT_PATH.name} | wave2_categories={len(WAVE_2_CATEGORIES)} "
        f"registry_fixes={len(JOB_CATEGORY_PATCHES)} jobs_synced={synced}"
    )


if __name__ == "__main__":
    main()
