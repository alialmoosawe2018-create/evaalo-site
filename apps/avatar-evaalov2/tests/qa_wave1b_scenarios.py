"""Wave 1B QA scorecard — 5 engineering L3 packs via scenario factory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from qa_l3_scenario_factory import PackScenarioConfig, build_standard_l3_scenarios, load_pack_base

_FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "l3_pack_fixtures.json"

WAVE_1B_CONFIGS: dict[str, PackScenarioConfig] = {
    "reservoir_engineer": PackScenarioConfig(
        prefix="res",
        academic_text="كل شي بالجامعة ومشروع تخرج محاكاة CMG وما عندي خبرة ميدانية بالمكامن",
        expert_text="اشتغلت على حقل وراجعت history matching و decline curve وضغط المكمن",
        career_switch_text="غيرت مجالي من هندسة الانتاج لمكامن قبل سنة فقط",
        entry_text="انا خريج حديث وأول وظيفة بقسم المكامن وراجعت بيانات ضغط تحت إشراف",
        trainee_text="فترة تدريب بقسم المكامن تعلمت فيها مراجعة بيانات ضغط وإنتاج مع مهندس مكامن",
        domain_rich_text="راجعنا material balance و PVT و recovery factor قبل توصية التطوير",
        domain_followup_any=("recovery", "PVT", "material", "مكمن", "ضغط"),
        academic_skip_not=("حقل", "بئر"),
        stt_academic_text="بالجامعة. محاكاة. CMG. مكمن. ما. ميدان.",
        stt_expert_text="اشتغلت. مكمن. decline. curve. ضغط.",
    ),
    "drilling_engineer": PackScenarioConfig(
        prefix="drill",
        academic_text="مشروع تخرج برنامج حفر نظري بالجامعة بدون خبرة حقلية",
        expert_text="اشتغلت على حفرية وراجعت mud weight و well control و NPT",
        career_switch_text="انتقلت من مجال آخر لهندسة الحفر قبل سنتين",
        entry_text="انا خريج حديث وأول مهمة حفر تحت إشراف مهندس حفر",
        trainee_text="فترة تدريب على الحفرية تعلمت إجراءات well control مع المشرف",
        domain_rich_text="عدّلنا BHA و ROP بعد kick detection وقلّلنا NPT",
        domain_followup_any=("mud", "BHA", "NPT", "حفر", "well control"),
        academic_skip_not=("حفرية", "rig"),
        stt_expert_text="اشتغلت. حفرية. mud. weight. kick.",
    ),
    "civil_engineer": PackScenarioConfig(
        prefix="civil",
        academic_text="مشروع تخرج تصميم مدني بالجامعة بدون إشراف موقع كامل",
        expert_text="اشتغلت مشروع مدني وراجعت shop drawings و BOQ و ETABS",
        career_switch_text="انتقلت من مجال آخر للهندسة المدنية",
        entry_text="انا خريج حديث وأول وظيفة مدني تحت إشراف مهندس أول بالمكتب",
        trainee_text="فترة تدريب بمكتب هندسي تعلمت مراجعة مخططات AutoCAD مع المهندس",
        domain_rich_text="راجعنا concrete mix و rebar detailing قبل الصب ومنعنا عدم مطابقة",
        domain_followup_any=("AutoCAD", "ETABS", "خرسانة", "BOQ", "مدني"),
        academic_skip_not=("موقع", "مقاول"),
        stt_expert_text="اشتغلت. مشروع. مدني. ETABS. BOQ.",
    ),
    "site_engineer": PackScenarioConfig(
        prefix="site",
        academic_text="زيارات موقع بالجامعة فقط بدون إشراف يومي كامل",
        expert_text="اشتغلت موقع بناء ونسّقت RFIs و inspections و method statement يومياً",
        career_switch_text="انتقلت من المكتب لإشراف المواقع",
        entry_text="انا خريج حديث وأول موقع إشراف يومي تحت إشراف مهندس موقع",
        trainee_text="فترة تدريب موقع تعلمت daily report و HSE checks مع المهندس",
        domain_rich_text="أغلقنا NCR بسبب عدم مطابقة حديد التسليح بعد inspection",
        domain_followup_any=("RFI", "inspection", "NCR", "موقع", "مقاول"),
        academic_skip_not=("مقاول", "يومي"),
        stt_expert_text="اشتغلت. موقع. RFI. inspection. مقاول.",
    ),
    "process_engineer": PackScenarioConfig(
        prefix="proc",
        academic_text="مشروع تخرج توازن كتلة وطاقة بالجامعة بدون تشغيل مصنع",
        expert_text="اشتغلت وحدة عمليات وراجعت PFD و P&ID و mass balance بالمصنع",
        career_switch_text="انتقلت من مجال آخر لهندسة العمليات",
        entry_text="انا خريج حديث وأول مهمة عمليات بالمصنع تحت إشراف",
        trainee_text="فترة تدريب بمصنع تعلمت HAZOP basics مع مهندس عمليات",
        domain_rich_text="حسّنا debottlenecking بعد مراجعة mass balance و utility consumption",
        domain_followup_any=("PFD", "HAZOP", "mass balance", "عمليات", "DCS"),
        academic_skip_not=("مصنع", "تشغيل"),
        stt_expert_text="اشتغلت. عمليات. mass. balance. HAZOP.",
    ),
}


def _load_fixtures() -> dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def all_wave1b_scenarios():
    from voice_interview.qa_scorecard import QAScenario

    fixtures = _load_fixtures()
    out: list[QAScenario] = []
    for pack_key, cfg in WAVE_1B_CONFIGS.items():
        base = load_pack_base(fixtures, pack_key)
        out.extend(build_standard_l3_scenarios(base, cfg))
    return out


WAVE_1B_QA_SCENARIOS = all_wave1b_scenarios()
