// Domain-specific score rubrics — one unique rubric per competency (no shared RUBRIC_STD).
import type { ScoreRubric } from './domainPacks.js';
import { uniqueRubric, WAVE_4_PACK_KEYS } from './wave3EnrichedHelpers.js';

const rb = uniqueRubric;
const WAVE4_PACK_SET = new Set<string>(WAVE_4_PACK_KEYS);

/** Wave 1B + Wave 2 competency rubrics. Wave 2 uses `packKey:competencyKey`. */
const RUBRICS: Record<string, ScoreRubric> = {
    // ── Reservoir ──
    reservoir_characterization: rb(
        'لا يفهم بناء نموذج المكمن من البيانات.',
        'نموذج مكمن مبني ببيانات حقيقية وتقسيم طبقات مبرّر أثر على القرار.'
    ),
    simulation_and_forecast: rb(
        'لا يشرح محاكاة أو توقعات بمدخلات.',
        'محاكاة CMG/Eclipse مع history matching وسيناريوهات غيّرت التوصية.'
    ),
    production_analysis: rb(
        'لا يربط الإنتاج بالضغط أو الاتجاهات.',
        'تحليل إنتاج بمؤشرات GOR/Water Cut/ضغط وقرار مبني على الاتجاه.'
    ),
    reserves_and_recovery: rb(
        'لا يقدّر احتياطي أو استخلاص بمنهجية.',
        'تقدير OOIP/recovery factor بخطة تطوير أثّرت على الاستثمار.'
    ),
    uncertainty_management: rb(
        'يتجاهل عدم اليقين في النموذج.',
        'سيناريوهات وحساسية وتواصل مخاطر غيّر قرار الإدارة.'
    ),
    technical_communication: rb(
        'لا يشرح نتائج تقنية بوضوح.',
        'شرح مبسّط لنتائج معقدة قنع العمليات أو الإدارة بتوصية.'
    ),
    // ── Drilling ──
    drilling_program_design: rb(
        'لا يفهم تخطيط برنامج الحفر.',
        'برنامج حفر بقرارات casing/mud مبرّرة لبيئة البئر.'
    ),
    well_control: rb(
        'لا يذكر إجراءات well control.',
        'إجراءات kick/ضغط واضحة مع مثال ميداني أو محاكاة حرجة.'
    ),
    drilling_operations: rb(
        'لا يتابع معاملات الحفر أو NPT.',
        'تشخيص downhole بمعاملات ROP/WOB وتحسين قابل للقياس.'
    ),
    mud_and_fluids: rb(
        'لا يفهم اختيار وزن الطين.',
        'قرار mud weight أو طين مبرّر بحالة ضغط أو خسائر حقيقية.'
    ),
    hse_rig_safety: rb(
        'يتجاهل HSE على الحفرية.',
        'إجراء سلامة PTW/BOP/JSA طُبّق بموقف حرج.'
    ),
    coordination_communication: rb(
        'لا ينسّق مع الحفرية أو الخدمات.',
        'تنسيق تحت ضغط وقت حل NPT أو خلاف تقني.'
    ),
    // ── Civil ──
    design_and_analysis: rb(
        'لا يقدم حسابات أو افتراضات تصميم.',
        'تحليل إنشائي/طرق بمعايير وافتراضات حاسمة مبرّرة.'
    ),
    drawings_and_documentation: rb(
        'لا يراجع مخططات أو BOQ بدقة.',
        'مراجعة shop drawings/BOQ اكتشفت خطأ منع تكلفة أو تأخير.'
    ),
    specifications_qa: rb(
        'يتجاهل المواصفات وضبط الجودة.',
        'NCR أو عدم مطابقة عولج بإجراء تصحيحي موثّق.'
    ),
    site_coordination: rb(
        'لا ينسّق مع الموقع أو المقاولين.',
        'حل تعارض مخططات أو RFI أغلق بموافقة الأطراف.'
    ),
    safety_and_risk: rb(
        'يتجاهل مخاطر التنفيذ.',
        'خطر لُوحظ مبكراً ومنع حادث أو عيب كبير.'
    ),
    project_delivery: rb(
        'لا وعي بالجدول أو التكلفة.',
        'قرار مراجعة أثر على التسليم أو النطاق بشكل مقصود.'
    ),
    // ── Site ──
    daily_site_management: rb(
        'لا يصف إدارة يومية للموقع.',
        'روتين موقع يومي منظم مع تقارير وتفتيش فعّال.'
    ),
    contractor_coordination: rb(
        'لا ينسّق مع المقاولين.',
        'تنسيق مقاول حل تعارض جدول أو نطاق بموقع.'
    ),
    quality_inspections: rb(
        'لا يجرى فحوصات جودة.',
        'فحص منع عيب أو NCR قبل التسليم.'
    ),
    safety_site: rb(
        'يتجاهل HSE والتصاريح.',
        'تصريح عمل أو إجراء HSE منع مخالفة أو إصابة.'
    ),
    documentation_rfi: rb(
        'لا يوثّق RFIs أو التعليمات.',
        'RFI/site instruction أغلق بتوثيق واضح.'
    ),
    schedule_problem_solving: rb(
        'لا يحل مشاكل جدول ميدانية.',
        'تأخير ميداني عولج بخطوات ونتيجة على الجدول.'
    ),
    // ── Process ──
    process_design: rb(
        'لا يفهم PFD/P&ID أو تصميم العملية.',
        'تصميم أو مراجعة عملية بتوازن واختيار معدات مبرّر.'
    ),
    mass_energy_balance: rb(
        'لا يجري توازن كتلة/طاقة بأرقام.',
        'توازن بأرقام ووحدات دعم قرار تشغيل أو تصميم.'
    ),
    process_safety: rb(
        'يتجاهل HAZOP أو سلامة العمليات.',
        'توصية HAZOP/relief نُفذت وقلّلت مخاطر.'
    ),
    troubleshooting: rb(
        'يخمّن بلا بيانات تشغيل.',
        'تشخيص مصنع ببيانات DCS/عينات وإجراء ناجح.'
    ),
    optimization: rb(
        'لا يقيس تحسين العملية.',
        'تحسين throughput/طاقة بنسبة قبل/بعد.'
    ),
    cross_functional: rb(
        'معزول عن العمليات والصيانة.',
        'تغيير عملية نُفذ بتنسيق تشغيل وصيانة.'
    ),
    // ── Frontend ──
    'frontend_developer:ui_architecture': rb(
        'لا هيكلة مكونات أو state.',
        'هيكلة مكونات/state قابلة للصيانة بقرار مبرّر في إنتاج.'
    ),
    'frontend_developer:performance': rb(
        'لا قياس أداء واجهة.',
        'تحسين LCP/bundle بأرقام قبل/بعد.'
    ),
    'frontend_developer:accessibility': rb(
        'يتجاهل accessibility.',
        'إصلاح a11y ملموس (ARIA/keyboard/contrast) بأثر على المستخدم.'
    ),
    'frontend_developer:api_integration': rb(
        'لا معالجة أخطاء أو حالات تحميل.',
        'تكامل API مع errors/loading/auth بedge cases.'
    ),
    'frontend_developer:testing': rb(
        'لا اختبارات واجهة.',
        'اختبارات unit/e2e تمنع regression حقيقية.'
    ),
    'frontend_developer:collaboration': rb(
        'عزلة عن التصميم والفريق.',
        'تعاون مع design/backend حل مشكلة تسليم.'
    ),
    // ── DevOps ──
    'devops_engineer:cicd_pipelines': rb(
        'نشر يدوي بلا pipeline.',
        'pipeline حسّن جودة/سرعة التسليم بمؤشر.'
    ),
    'devops_engineer:infra_as_code': rb(
        'تغييرات بنية يدوية.',
        'Terraform/K8s بمراجعة وapply آمن.'
    ),
    'devops_engineer:observability': rb(
        'لا مراقبة أو تنبيهات.',
        'logs/metrics/traces ساعدت اكتشاف مشكلة إنتاج.'
    ),
    'devops_engineer:incident_response': rb(
        'لا تحليل سبب جذري.',
        'حادث إنتاج من اكتشاف لpostmortem ووقاية.'
    ),
    'devops_engineer:security_ops': rb(
        'أسرار/صلاحيات مفرطة.',
        'least privilege أو rotate secrets طُبّق.'
    ),
    'devops_engineer:collaboration': rb(
        'لا يدعم فرق التطوير.',
        'أتمتة/وثائق خفّفت على المطورين.'
    ),
    // ── Data analyst ──
    'data_analyst:sql_analysis': rb(
        'لا SQL عملي.',
        'استعلام معقد بjoins/aggregates أجاب سؤال عمل.'
    ),
    'data_analyst:metrics_definition': rb(
        'مؤشرات غامضة.',
        'KPI معرّف بbaseline واستُخدم في قرار.'
    ),
    'data_analyst:visualization': rb(
        'رسم بلا رسالة.',
        'dashboard/chart قاد توصية واضحة.'
    ),
    'data_analyst:data_quality': rb(
        'يثق بالبيانات بلا فحص.',
        'اكتشف شذوذ/تكرار وصحح قبل التقرير.'
    ),
    'data_analyst:stakeholder': rb(
        'شرح تقني معقد لغير تقني.',
        'قدّم insight لإدارة غير تقنية بدقة.'
    ),
    'data_analyst:business_impact': rb(
        'لا توصية أو أثر.',
        'تحليل غيّر قراراً بأرقام.'
    ),
    // ── QA ──
    'qa_engineer:test_strategy': rb(
        'اختبار عشوائي بلا خطة.',
        'خطة اختبار مبنية على مخاطر ونطاق.'
    ),
    'qa_engineer:automation': rb(
        'أتمتة بلا صيانة أو هدف.',
        'أتمتة مناسبة خفّفت regression بقيمة.'
    ),
    'qa_engineer:bug_reporting': rb(
        'تقارير أعطال غامضة.',
        'bug report كامل أسرع الإصلاح.'
    ),
    'qa_engineer:regression': rb(
        'لا regression قبل الإطلاق.',
        'regression/smoke منع عطل إنتاج.'
    ),
    'qa_engineer:collaboration': rb(
        'صراع مع التطوير.',
        'triage عادل حافظ على الجودة والجدول.'
    ),
    'qa_engineer:exploratory': rb(
        'سكربت فقط بلا استكشاف.',
        'exploratory اكتشف عطلاً فاتته الأتمتة.'
    ),
    // ── Customer support ──
    'customer_support:ticket_handling': rb(
        'فوضى في إدارة التذاكر.',
        'تذكرة صعبة مُوثّقة وحُلت ضمن SLA.'
    ),
    'customer_support:empathy': rb(
        'تصعيد بلا تهدئة.',
        'de-escalation ناجح مع حل للعميل.'
    ),
    'customer_support:policy_balance': rb(
        'تجاوز عشوائي أو جمود تام.',
        'توازن سياسة/عميل باستثناء مبرّر.'
    ),
    'customer_support:escalation': rb(
        'تصعيد متأخر أو ناقص.',
        'تصعيد في الوقت المناسب بمعلومات كاملة.'
    ),
    'customer_support:product_knowledge': rb(
        'لا يعرف المنتج.',
        'معرفة منتج سرّعت الحل أو workaround.'
    ),
    'customer_support:metrics': rb(
        'لا مؤشرات خدمة.',
        'حسّن CSAT/FCR/response time بإجراء.'
    ),
    // ── Operations coordinator ──
    'operations_coordinator:process_coordination': rb(
        'فوضى في تدفق العمل.',
        'تنسيق SOP/handoff أزال اختناقاً.'
    ),
    'operations_coordinator:vendor_mgmt': rb(
        'لا متابعة موردين.',
        'مورد فاشل عولج بSLA ومتابعة.'
    ),
    'operations_coordinator:scheduling': rb(
        'لا أولويات تحت الضغط.',
        'إعادة جدولة ناجحة بيوم مزدحم.'
    ),
    'operations_coordinator:reporting': rb(
        'تقارير بلا أرقام.',
        'KPI/report أظهر variance ودعم قرار.'
    ),
    'operations_coordinator:problem_solving': rb(
        'ترقيع بلا سبب جذري.',
        'تحسين عملية بقياس قبل/بعد.'
    ),
    'operations_coordinator:stakeholder': rb(
        'صمت أو صراع أقسام.',
        'مواءمة أصحاب مصلحة حلت خلافاً.'
    ),
    // ── AP ──
    'accounts_payable:invoice_processing': rb(
        'دفع بلا تحقق فاتورة.',
        'three-way match منع دفع خاطئ.'
    ),
    'accounts_payable:controls': rb(
        'تجاوز ضوابط.',
        'ضابط SOX/segregation منع خطأ.'
    ),
    'accounts_payable:reconciliation': rb(
        'فروقات مورد معلقة.',
        'مطابقة مورد أغلقت فرقاً كبيراً.'
    ),
    'accounts_payable:payment_runs': rb(
        'تأخير دورات دفع بلا خطة.',
        'payment run دقيق تحت ضغط cut-off.'
    ),
    'accounts_payable:erp_tools': rb(
        'معالجة يدوية كاملة.',
        'ERP/workflow خفّف أخطاء أو وقت.'
    ),
    'accounts_payable:communication': rb(
        'صراع مع مورد.',
        'نزاع مورد حُل بتوثيق مهني.'
    ),
    // ── Financial analyst ──
    'financial_analyst:modeling': rb(
        'نموذج بأرقام بلا منطق.',
        'نموذج بافتراضات وحساسية دعم قرار.'
    ),
    'financial_analyst:variance': rb(
        'وصف انحراف بلا سبب.',
        'variance analysis بسبب جذري ورقم.'
    ),
    'financial_analyst:forecasting': rb(
        'توقع ثابت بلا تحديث.',
        'forecast rolling تغيّر بتغيّر السوق/الأداء.'
    ),
    'financial_analyst:reporting': rb(
        'جداول بلا قصة.',
        'management pack بتوصية واضحة.'
    ),
    'financial_analyst:business_partner': rb(
        'معزول عن الأعمال.',
        'شراكة أعمال أثّرت قرار إدارة.'
    ),
    'financial_analyst:data_integrity': rb(
        'أخطاء بيانات غير مكتشفة.',
        'اكتشف خطأ مصدر وصحح قبل التقرير.'
    ),
    // ── Internal auditor ──
    'internal_auditor:risk_assessment': rb(
        'تدقيق عشوائي بلا مخاطر.',
        'نطاق مراجعة مبني على مخاطر inherent/residual.'
    ),
    'internal_auditor:control_testing': rb(
        'لا اختبار ضوابط بعينة.',
        'اختبار design/operating بعينة ودليل.'
    ),
    'internal_auditor:findings': rb(
        'ملاحظات غامضة.',
        'finding بcriteria/condition/cause/recommendation.'
    ),
    'internal_auditor:evidence': rb(
        'لا workpapers.',
        'أدلة موثّقة تدعم الاستنتاج.'
    ),
    'internal_auditor:follow_up': rb(
        'لا متابعة معالجة.',
        'ملاحظة أُغلقت بعد remediation.'
    ),
    'internal_auditor:communication': rb(
        'مواجهة غير مهنية.',
        'مقابلة/عرض إدارة بنتيجة مقبولة.'
    ),
};

/** Rubric for Wave 1B competency (keys are globally unique). */
export function rubricFor(competencyKey: string): ScoreRubric;
/** Rubric for Wave 2 competency (composite key). */
export function rubricFor(packKey: string, competencyKey: string): ScoreRubric;
export function rubricFor(a: string, b?: string): ScoreRubric {
    const key = b ? `${a}:${b}` : a;
    let rubric = RUBRICS[key];
    if (!rubric && b && WAVE4_PACK_SET.has(a)) {
        const label = b.replace(/_/g, ' ');
        rubric = rb(
            `لا يقدّم أدلة عملية في ${label} — إجابة عامة.`,
            `مثال عميق في ${label} بخطوات وقرار ونتيجة قابلة للقياس.`
        );
        RUBRICS[key] = rubric;
    }
    if (!rubric) {
        throw new Error(`packRubrics: missing rubric for ${key}`);
    }
    return rubric;
}

/** True when every competency in the pack has a distinct rubric (scores 1+5 differ across comps). */
export function assertPackRubricsUnique(
    packKey: string,
    competencies: Array<{ competencyKey: string; scoreRubric: ScoreRubric }>
): void {
    const fingerprints = competencies.map((c) => {
        const r = c.scoreRubric;
        return `${r['1']}|${r['5']}`;
    });
    if (new Set(fingerprints).size !== competencies.length) {
        throw new Error(`${packKey}: duplicate rubric fingerprints across competencies`);
    }
}
