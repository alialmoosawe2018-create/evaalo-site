// Wave 4 L3 packs — HR, Engineering, Finance/Ops, Commercial, IT Support
import type { DomainPack, PackCompetency } from './domainPacks.js';
import { rubricFor } from './packRubrics.js';
import {
    ACADEMIC_TRACKS,
    FIELD_TRACKS,
    WAVE_3_ENRICHED_VERSION,
    WAVE_4_PACK_KEYS,
    buildDomainTracks,
    enrichedPath,
    uniqueRubric,
} from './wave3EnrichedHelpers.js';

export { WAVE_4_PACK_KEYS };

const PLACEHOLDER = uniqueRubric('—', '—');

function c(
    packKey: string,
    key: string,
    title: string,
    obj: string,
    evidence: string[],
    flags: string[],
    follow: string[]
): PackCompetency {
    return {
        competencyKey: key,
        title,
        priority: 'high',
        questionObjective: obj,
        expectedEvidence: evidence,
        redFlags: flags,
        scoreRubric: PLACEHOLDER,
        followUpRules: follow,
    };
}

type PackSeed = Omit<DomainPack, 'packVersion' | 'competencies' | 'interviewPaths'> & {
    competencies: PackCompetency[];
    trackSignals: { academic: string[]; field: string[] };
    pathSteps: Array<{ stepKey: string; competencyKey?: string; topicLabel: string; sampleQuestion: string }>;
};

function mkWave4(seed: PackSeed): DomainPack {
    const tracks = buildDomainTracks({
        academicSignals: seed.trackSignals.academic,
        fieldSignals: seed.trackSignals.field,
        academicAnchors: [`اذكرلي تدريب أو مشروع أكاديمي في ${seed.specialization}.`, 'شنو تعلمت نظرياً؟'],
        fieldAnchors: [
            `اذكرلي مثال حقيقي من شغلك في ${seed.specialization}.`,
            'شنو التحدي وشنو النتيجة؟',
        ],
        academicRubricAdj: 'اقبل أدلة أكاديمية — لا تخصم غياب خبرة ميدانية طويلة.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب؟',
        seniorAnchor: 'اذكرلي قرار أو مشروع قدته — شنو التأثير؟',
        switcherAnchor: 'ليش انتقلت لهذا المجال؟',
    });
    const competencies = seed.competencies.map((comp) => ({
        ...comp,
        scoreRubric: rubricFor(seed.packKey, comp.competencyKey),
    }));
    const interviewPaths = [
        enrichedPath(
            `${seed.packKey}_default`,
            [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
            seed.pathSteps.map((s) => ({
                stepKey: s.stepKey,
                competencyKey: s.competencyKey,
                topicLabel: s.topicLabel,
                sampleQuestion: s.sampleQuestion,
                clusterKey: s.competencyKey ?? s.stepKey,
            }))
        ),
    ];
    return {
        ...seed,
        packVersion: WAVE_3_ENRICHED_VERSION,
        supportedExperienceTracks: tracks,
        interviewPaths,
        competencies,
    };
}

const stdSteps = (comps: string[]) => [
    { stepKey: 'context', topicLabel: 'Context', sampleQuestion: 'شنو الموقف أو المشروع؟' },
    { stepKey: 'approach', competencyKey: comps[0], topicLabel: 'Approach', sampleQuestion: 'شنو خطتك أو إجراءك؟' },
    { stepKey: 'execution', competencyKey: comps[1], topicLabel: 'Execution', sampleQuestion: 'شلون نفّذت؟' },
    { stepKey: 'quality', competencyKey: comps[2], topicLabel: 'Quality', sampleQuestion: 'شلون ضمنت الجودة أو الدقة؟' },
    { stepKey: 'stakeholder', competencyKey: comps[3], topicLabel: 'Stakeholder', sampleQuestion: 'شلون تعاملت مع الأطراف؟' },
    { stepKey: 'risk', competencyKey: comps[4], topicLabel: 'Risk', sampleQuestion: 'شنو المخاطر وكيف عالجتها؟' },
    { stepKey: 'result', topicLabel: 'Result', sampleQuestion: 'شنو النتيجة القابلة للقياس؟' },
];

export const HR_GENERALIST = mkWave4({
    packKey: 'hr_generalist',
    roleKey: 'hr_generalist',
    domain: 'business',
    specialization: 'HR Generalist',
    roleAliases: ['hr generalist', 'أخصائي موارد بشرية شامل', 'generalist hr'],
    excludeKeywords: ['recruiter', 'talent acquisition', 'payroll only', 'software'],
    matchKeywords: ['hr generalist', 'generalist', 'employee relations', 'hr operations', 'موارد بشرية شامل'],
    terminology: ['HRIS', 'onboarding', 'offboarding', 'policy', 'employee relations', 'grievance', 'attendance', 'leave', 'HR audit', 'case management', 'labor law', 'documentation'],
    domainGuidance: 'Domain: HR Generalist. Probe policy application, employee lifecycle cases, HR operations, and stakeholder partnering with documented outcomes — not generic HR lists.',
    competencies: [
        c('hr_generalist', 'policy_application', 'HR Policy Application', 'قياس تطبيق السياسات.', ['policy', 'case', 'documentation'], ['عشوائي'], ['مثال سياسة']),
        c('hr_generalist', 'employee_lifecycle', 'Employee Lifecycle', 'قياس دورة حياة الموظف.', ['onboarding', 'offboarding'], ['فوضى'], ['مثال onboarding']),
        c('hr_generalist', 'case_management', 'HR Case Management', 'قياس إدارة حالات.', ['grievance', 'investigation'], ['لا توثيق'], ['حالة صعبة']),
        c('hr_generalist', 'hr_partnering', 'HR Business Partnering', 'قياس شراكة الأعمال.', ['manager alignment'], ['معزول'], ['تعارض مع مدير']),
        c('hr_generalist', 'compliance', 'HR Compliance', 'قياس الامتثال.', ['audit', 'records'], ['مخالفة'], ['تدقيق HR']),
        c('hr_generalist', 'communication', 'HR Communication', 'قياس التواصل الحساس.', ['confidentiality'], ['تسرّب'], ['خبر سيء']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي حالة HR عاملتها من البداية للنهاية — شنو الإجراء وشنو النتيجة؟',
        'شلون تتعامل مع مدير يبي يتجاوز سياسة HR؟',
        'اذكرلي onboarding أو offboarding سويته — شنو الخطوات الحرجة؟',
    ],
    trackSignals: { academic: ['hr', 'policy', 'موارد بشرية'], field: ['hris', 'onboarding', 'grievance', 'employee relations'] },
    pathSteps: stdSteps(['policy_application', 'employee_lifecycle', 'case_management', 'hr_partnering', 'compliance']),
});

export const HR_OFFICER = mkWave4({
    packKey: 'hr_officer',
    roleKey: 'hr_specialist',
    domain: 'business',
    specialization: 'HR Officer',
    roleAliases: ['hr officer', 'hr specialist', 'موظف موارد بشرية', 'أخصائي موارد بشرية'],
    excludeKeywords: ['recruiter', 'talent acquisition', 'payroll accountant', 'developer'],
    matchKeywords: ['hr officer', 'hr specialist', 'hr operations', 'موارد بشرية', 'شؤون موظفين'],
    terminology: ['HRIS', 'employee file', 'attendance', 'leave request', 'policy', 'onboarding checklist', 'offboarding', 'HR letter', 'documentation', 'approval workflow', 'employee data', 'compliance'],
    domainGuidance: 'Domain: HR Officer. Probe transactional HR accuracy, employee records, policy execution, and timely case handling.',
    competencies: [
        c('hr_officer', 'records_accuracy', 'Employee Records', 'قياس دقة الملفات.', ['data', 'audit'], ['أخطاء'], ['خطأ اكتشفته']),
        c('hr_officer', 'policy_execution', 'Policy Execution', 'قياس تنفيذ السياسات.', ['SOP', 'approval'], ['تجاوز'], ['استثناء']),
        c('hr_officer', 'employee_requests', 'Employee Requests', 'قياس معالجة الطلبات.', ['leave', 'attendance'], ['تأخير'], ['طلب عاجل']),
        c('hr_officer', 'onboarding_support', 'Onboarding Support', 'قياس دعم التعيين.', ['checklist', 'orientation'], ['ناقص'], ['تعيين جديد']),
        c('hr_officer', 'confidentiality', 'Confidentiality', 'قياس السرية.', ['access control'], ['تسرّب'], ['بيانات حساسة']),
        c('hr_officer', 'stakeholder_service', 'HR Service Delivery', 'قياس خدمة الداخلية.', ['SLA', 'follow-up'], ['شكاوى'], ['مدير غاضب']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي طلب موظف أو مدير عالجته بسرعة ودقة — شنو سويت؟',
        'شلون تتأكد ملفات الموظفين محدّثة وصحيحة؟',
        'اذكرلي موقف اضطررت تطبّق فيه سياسة HR بحزم — شنو النتيجة؟',
    ],
    trackSignals: { academic: ['hr operations', 'شؤون موظفين'], field: ['hris', 'employee file', 'leave', 'onboarding'] },
    pathSteps: stdSteps(['records_accuracy', 'policy_execution', 'employee_requests', 'onboarding_support', 'confidentiality']),
});

export const TALENT_ACQUISITION = mkWave4({
    packKey: 'talent_acquisition',
    roleKey: 'talent_acquisition_specialist',
    domain: 'business',
    specialization: 'Talent Acquisition',
    roleAliases: ['talent acquisition', 'ta specialist', 'استقطاب مواهب'],
    excludeKeywords: ['payroll', 'general accountant', 'software developer'],
    matchKeywords: ['talent acquisition', 'employer branding', 'workforce planning', 'استقطاب', 'مواهب'],
    terminology: ['workforce plan', 'employer brand', 'talent pool', 'ATS', 'pipeline', 'time to fill', 'offer', 'source mix', 'market mapping', 'intake', 'hiring manager', 'candidate experience'],
    domainGuidance: 'Domain: Talent Acquisition (beyond basic recruiting). Probe workforce planning, employer branding, strategic sourcing, and TA metrics.',
    competencies: [
        c('talent_acquisition', 'workforce_planning', 'Workforce Planning', 'قياس تخطيط القوى.', ['headcount plan', 'skills gap'], ['لا خطة'], ['فجوة مهارات']),
        c('talent_acquisition', 'employer_branding', 'Employer Branding', 'قياس العلامة.', ['EVP', 'campaign'], ['عام'], ['حملة استقطاب']),
        c('talent_acquisition', 'strategic_sourcing', 'Strategic Sourcing', 'قياس بحث استراتيجي.', ['market map', 'channels'], ['قناة واحدة'], ['دور صعب']),
        c('talent_acquisition', 'hiring_manager_partner', 'HM Partnership', 'قياس شراكة التوظيف.', ['intake', 'calibration'], ['صراع'], ['توقعات غير واقعية']),
        c('talent_acquisition', 'ta_metrics', 'TA Metrics', 'قياس مؤشرات TA.', ['time to fill', 'quality of hire'], ['لا أرقام'], ['تحسين مؤشر']),
        c('talent_acquisition', 'candidate_experience', 'Candidate Experience', 'قياس تجربة المرشح.', ['communication', 'feedback'], ['إهمال'], ['مرشح انسحب']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي خطة استقطاب لدور صعب — شنو الاستراتيجية وشنو النتيجة؟',
        'شلون تشتغل مع المدير على workforce plan أو توقعات التوظيف؟',
        'شنو مؤشر TA حسّنته مؤخراً — شنو قبل وبعد؟',
    ],
    trackSignals: { academic: ['talent acquisition', 'employer brand'], field: ['workforce plan', 'ats', 'pipeline', 'time to fill'] },
    pathSteps: stdSteps(['workforce_planning', 'strategic_sourcing', 'employer_branding', 'hiring_manager_partner', 'ta_metrics']),
});

export const HR_MANAGER = mkWave4({
    packKey: 'hr_manager',
    roleKey: 'hr_manager',
    domain: 'business',
    specialization: 'HR Management',
    roleAliases: ['hr manager', 'head of hr', 'مدير موارد بشرية'],
    excludeKeywords: ['software developer', 'petroleum', 'recruiter coordinator only'],
    matchKeywords: ['hr manager', 'head of hr', 'hr director', 'people manager', 'إدارة موارد بشرية'],
    terminology: ['headcount', 'org design', 'performance cycle', 'succession', 'employee engagement', 'labor relations', 'HR budget', 'policy governance', 'change management', 'ER cases', 'compensation review', 'HR KPIs'],
    domainGuidance: 'Domain: HR Manager. Probe people leadership, policy governance, ER escalations, org/performance programs, and measurable HR outcomes.',
    competencies: [
        c('hr_manager', 'people_leadership', 'People Leadership', 'قياس قيادة فريق HR.', ['coaching', 'priorities'], ['تفويض ضعيف'], ['فريق تحت ضغط']),
        c('hr_manager', 'policy_governance', 'Policy Governance', 'قياس حوكمة السياسات.', ['approval', 'audit'], ['ازدواجية'], ['تحديث سياسة']),
        c('hr_manager', 'employee_relations', 'Employee Relations', 'قياس علاقات الموظفين.', ['investigation', 'resolution'], ['تسرّب'], ['قضية حساسة']),
        c('hr_manager', 'org_programs', 'Org & Performance Programs', 'قياس برامج الأداء.', ['cycle', 'calibration'], ['شكلي'], ['مراجعة أداء']),
        c('hr_manager', 'hr_metrics', 'HR Metrics & Reporting', 'قياس تقارير HR.', ['turnover', 'engagement'], ['لا بيانات'], ['مؤشر تحسّن']),
        c('hr_manager', 'change_leadership', 'Change Leadership', 'قياس قيادة التغيير.', ['communication plan'], ['مقاومة'], ['تغيير سياسة/نظام']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي قضية ER أو أداء قدتها كمدير HR — شنو القرار وشنو النتيجة؟',
        'شلون تربط أهداف فريق HR بأولويات الإدارة العليا؟',
        'اذكرلي برنامج HR حسّنته — شنو المؤشر قبل وبعد؟',
    ],
    trackSignals: { academic: ['hr management', 'organizational behavior'], field: ['headcount', 'employee relations', 'performance cycle', 'engagement'] },
    pathSteps: stdSteps(['people_leadership', 'employee_relations', 'policy_governance', 'org_programs', 'hr_metrics']),
});

export const PAYROLL_OFFICER = mkWave4({
    packKey: 'payroll_officer',
    roleKey: 'payroll_officer',
    domain: 'business',
    specialization: 'Payroll',
    roleAliases: ['payroll officer', 'payroll specialist', 'مسؤول رواتب', 'رواتب'],
    excludeKeywords: ['recruiter', 'software developer', 'accounts payable'],
    matchKeywords: ['payroll', 'salary', 'wages', 'رواتب', 'كشف رواتب', 'deductions'],
    terminology: ['payroll cycle', 'gross to net', 'deductions', 'overtime', 'leave accrual', 'payroll register', 'bank file', 'reconciliation', 'tax withholding', 'cut-off', 'payroll audit', 'HRIS payroll'],
    domainGuidance: 'Domain: Payroll. Probe payroll accuracy, cut-off discipline, statutory deductions, reconciliation, and confidential handling.',
    competencies: [
        c('payroll_officer', 'payroll_accuracy', 'Payroll Accuracy', 'قياس دقة الرواتب.', ['validation', 'controls'], ['أخطاء متكررة'], ['خطأ اكتشفته']),
        c('payroll_officer', 'cutoff_discipline', 'Cut-off & Calendar', 'قياس انضباط المواعيد.', ['cut-off', 'calendar'], ['تأخير'], ['ضغط نهاية شهر']),
        c('payroll_officer', 'statutory_compliance', 'Statutory Compliance', 'قياس الامتثال.', ['tax', 'social insurance'], ['مخالفة'], ['تغيير نظام']),
        c('payroll_officer', 'reconciliation', 'Payroll Reconciliation', 'قياس المطابقة.', ['GL', 'variance'], ['فروقات'], ['فرق كبير']),
        c('payroll_officer', 'employee_queries', 'Payroll Queries', 'قياس استفسارات الموظفين.', ['payslip', 'explanation'], ['ردود غامضة'], ['نزاع راتب']),
        c('payroll_officer', 'confidentiality', 'Payroll Confidentiality', 'قياس السرية.', ['access'], ['تسرّب'], ['بيانات حساسة']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي دورة رواتب فيها خطأ — شلون اكتشفته وصححته؟',
        'شلون تدير cut-off مع HR والحضور تحت ضغط الوقت؟',
        'اذكرلي مطابقة رواتب أو GL سويتها — شنو الفروقات اللي لقيتها؟',
    ],
    trackSignals: { academic: ['payroll', 'رواتب'], field: ['payroll cycle', 'deductions', 'reconciliation', 'cut-off'] },
    pathSteps: stdSteps(['payroll_accuracy', 'cutoff_discipline', 'statutory_compliance', 'reconciliation', 'employee_queries']),
});

export const MECHANICAL_ENGINEER = mkWave4({
    packKey: 'mechanical_engineer',
    roleKey: 'mechanical_engineer',
    domain: 'engineering',
    specialization: 'Mechanical Engineering',
    roleAliases: ['mechanical engineer', 'مهندس ميكانيك', 'mechanical design'],
    excludeKeywords: ['electrical only', 'software', 'recruiter', 'civil only'],
    matchKeywords: ['mechanical', 'hvac', 'rotating equipment', 'pump', 'piping', 'ميكانيك', 'تكييف'],
    terminology: ['AutoCAD', 'SolidWorks', 'P&ID', 'pump', 'compressor', 'bearing', 'vibration', 'HVAC', 'stress analysis', 'tolerance', 'preventive maintenance', 'RCM', 'hydraulic'],
    domainGuidance: 'Domain: Mechanical Engineering. Probe design/analysis, equipment troubleshooting, drawings/specs, maintenance reliability, and safety.',
    competencies: [
        c('mechanical_engineer', 'design_analysis', 'Design & Analysis', 'قياس التحليل الميكانيكي.', ['loads', 'materials'], ['لا حسابات'], ['قرار تصميم']),
        c('mechanical_engineer', 'equipment_troubleshoot', 'Equipment Troubleshooting', 'قياس تشخيص المعدات.', ['vibration', 'failure mode'], ['تخمين'], ['عطل مضخة']),
        c('mechanical_engineer', 'drawings_specs', 'Drawings & Specs', 'قياس المخططات.', ['P&ID', 'tolerance'], ['أخطاء'], ['مراجعة drawing']),
        c('mechanical_engineer', 'maintenance_reliability', 'Maintenance & Reliability', 'قياس الصيانة.', ['PM', 'RCM'], ['إطفاء حرائق'], ['تحسين PM']),
        c('mechanical_engineer', 'safety_mechanical', 'Mechanical Safety', 'قياس السلامة.', ['lockout', 'permit'], ['تجاهل HSE'], ['إجراء سلامة']),
        c('mechanical_engineer', 'project_delivery', 'Project Delivery', 'قياس التسليم.', ['schedule', 'vendor'], ['تأخير'], ['تنسيق مقاول']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي عطل معدات ميكانيكية تشخيصته — شنو الأعراض وشنو الحل؟',
        'شلون راجعت drawing أو مواصفة منعت خطأ بالتنفيذ؟',
        'اذكرلي تحسين صيانة أو موثوقية حققت نتيجة قابلة للقياس؟',
    ],
    trackSignals: { academic: ['mechanical', 'hvac', 'ميكانيك'], field: ['pump', 'vibration', 'piping', 'maintenance'] },
    pathSteps: stdSteps(['design_analysis', 'equipment_troubleshoot', 'drawings_specs', 'maintenance_reliability', 'safety_mechanical']),
});

export const ELECTRICAL_ENGINEER = mkWave4({
    packKey: 'electrical_engineer',
    roleKey: 'electrical_engineer',
    domain: 'engineering',
    specialization: 'Electrical / MEP',
    roleAliases: ['electrical engineer', 'mep engineer', 'مهندس كهرباء'],
    excludeKeywords: ['mechanical only', 'software', 'recruiter'],
    matchKeywords: ['electrical', 'mep', 'power', 'lighting', 'panel', 'كهرباء', 'مولدات'],
    terminology: ['load calculation', 'short circuit', 'cable sizing', 'panel schedule', 'earthing', 'MEP coordination', 'lighting design', 'generator', 'UPS', 'IEC/NEC', 'single line diagram', 'commissioning'],
    domainGuidance: 'Domain: Electrical/MEP. Probe load analysis, protection/coordination, drawings, commissioning, and site coordination.',
    competencies: [
        c('electrical_engineer', 'load_analysis', 'Load & Protection', 'قياس الأحمال والحماية.', ['load calc', 'breaker'], ['تحجيم خاطئ'], ['لوح كهرباء']),
        c('electrical_engineer', 'design_drawings', 'Electrical Design', 'قياس التصميم.', ['SLD', 'panel'], ['أخطاء'], ['تعارض MEP']),
        c('electrical_engineer', 'site_coordination', 'Site Coordination', 'قياس التنسيق.', ['RFI', 'clash'], ['تأخير'], ['تعارض موقع']),
        c('electrical_engineer', 'commissioning', 'Testing & Commissioning', 'قياس التشغيل.', ['megger', 'test'], ['تشغيل بلا اختبار'], ['فحص قبل التشغيل']),
        c('electrical_engineer', 'safety_electrical', 'Electrical Safety', 'قياس السلامة.', ['LOTO', 'permit'], ['مخالفة'], ['إجراء سلامة']),
        c('electrical_engineer', 'energy_efficiency', 'Energy Efficiency', 'قياس الكفاءة.', ['lighting', 'VFD'], ['لا قياس'], ['توفير طاقة']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي تصميم أو تعديل كهربائي — شنو التحدي الفني وشنو النتيجة؟',
        'شلون عالجت تعارض MEP أو مشكلة موقع أثرت على اللوحات؟',
        'اذكرلي اختبار أو تشغيل قبل التسليم — شنو اكتشفت؟',
    ],
    trackSignals: { academic: ['electrical', 'mep', 'كهرباء'], field: ['panel', 'load calculation', 'commissioning', 'generator'] },
    pathSteps: stdSteps(['load_analysis', 'design_drawings', 'site_coordination', 'commissioning', 'safety_electrical']),
});

export const QA_QC_ENGINEER = mkWave4({
    packKey: 'qa_qc_engineer',
    roleKey: 'qa_qc_engineer',
    domain: 'engineering',
    specialization: 'Quality (QA/QC)',
    roleAliases: ['qa/qc engineer', 'qc inspector', 'quality engineer construction', 'مهندس جودة'],
    excludeKeywords: ['selenium', 'cypress', 'software qa', 'automation tester', 'developer'],
    matchKeywords: ['qa/qc', 'quality control', 'inspection', 'ndt', 'wps', 'جودة', 'فحص'],
    terminology: ['ITP', 'WPS', 'NDT', 'hold point', 'NCR', 'MTR', 'calibration', 'sampling plan', 'coating inspection', 'dimensional check', 'ASME', 'ISO 9001'],
    domainGuidance: 'Domain: Engineering QA/QC (construction/industrial). Probe inspection plans, NCR handling, standards compliance — not software testing.',
    competencies: [
        c('qa_qc_engineer', 'inspection_planning', 'Inspection Planning', 'قياس خطط الفحص.', ['ITP', 'hold point'], ['فحص عشوائي'], ['ITP']),
        c('qa_qc_engineer', 'ncr_management', 'NCR Management', 'قياس عدم المطابقة.', ['NCR', 'root cause'], ['إغلاق شكلي'], ['NCR حرج']),
        c('qa_qc_engineer', 'standards_compliance', 'Standards Compliance', 'قياس المعايير.', ['ASME', 'ISO'], ['تجاوز'], ['مخالفة مواصفة']),
        c('qa_qc_engineer', 'ndt_coordination', 'NDT & Testing', 'قياس الاختبارات.', ['NDT', 'witness'], ['لا متابعة'], ['نتيجة NDT']),
        c('qa_qc_engineer', 'documentation_qc', 'QC Documentation', 'قياس التوثيق.', ['MTR', 'traceability'], ['نواقص'], ['ملف جودة']),
        c('qa_qc_engineer', 'supplier_quality', 'Supplier/Vendor Quality', 'قياس جودة الموردين.', ['audit', 'CAR'], ['قبول بلا فحص'], ['مورد ضعيف']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي NCR أو عدم مطابقة عالجته — شنو السبب الجذري وشنو الإجراء؟',
        'شلون تبني أو تطبق ITP لنشاط حرج بالموقع؟',
        'اذكرلي فحص أو NDT منع عيب كبير قبل التسليم؟',
    ],
    trackSignals: { academic: ['qa/qc', 'quality control', 'جودة'], field: ['ncr', 'ndt', 'inspection', 'itp'] },
    pathSteps: stdSteps(['inspection_planning', 'ncr_management', 'standards_compliance', 'ndt_coordination', 'documentation_qc']),
});

export const HSE_ENGINEER = mkWave4({
    packKey: 'hse_engineer',
    roleKey: 'hse_engineer',
    domain: 'engineering',
    specialization: 'HSE',
    roleAliases: ['hse engineer', 'safety engineer', 'مهندس سلامة'],
    excludeKeywords: ['software', 'recruiter', 'payroll'],
    matchKeywords: ['hse', 'safety', 'permit to work', 'jsa', 'سلامة', 'حوادث'],
    terminology: ['PTW', 'JSA', 'LOTO', 'incident investigation', 'near miss', 'risk assessment', 'HSE audit', 'PPE', 'emergency response', 'stop work', 'TRIR', 'corrective action'],
    domainGuidance: 'Domain: HSE Engineering. Probe risk assessment, PTW/JSA, incident investigation, and measurable safety culture interventions.',
    competencies: [
        c('hse_engineer', 'risk_assessment', 'Risk Assessment', 'قياس تقييم المخاطر.', ['JSA', 'hierarchy'], ['تجاهل'], ['نشاط عالي المخاطر']),
        c('hse_engineer', 'permit_to_work', 'Permit to Work', 'قياس التصاريح.', ['PTW', 'isolation'], ['عمل بلا تصريح'], ['رفض تصريح']),
        c('hse_engineer', 'incident_investigation', 'Incident Investigation', 'قياس التحقيق.', ['root cause', 'CAPA'], ['لوم'], ['حادث/Near miss']),
        c('hse_engineer', 'hse_audits', 'HSE Audits', 'قياس التدقيق.', ['finding', 'closure'], ['شكلي'], ['تدقيق ميداني']),
        c('hse_engineer', 'training_culture', 'Training & Culture', 'قياس الثقافة.', ['toolbox', 'engagement'], ['محاضرة فقط'], ['تحسين سلوك']),
        c('hse_engineer', 'regulatory_compliance', 'Regulatory Compliance', 'قياس الامتثال.', ['regulation', 'report'], ['مخالفة'], ['تفتيش جهة']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي حادث أو near miss حققت فيه تحقيق — شنو السبب الجذري وشنو الإجراء؟',
        'شلون تفرض PTW أو إيقاف عمل عند مخاطرة عالية؟',
        'اذكرلي تدخل HSE خفّض مخاطر أو مخالفات بشكل ملموس؟',
    ],
    trackSignals: { academic: ['hse', 'safety', 'سلامة'], field: ['ptw', 'incident', 'jsa', 'audit'] },
    pathSteps: stdSteps(['risk_assessment', 'permit_to_work', 'incident_investigation', 'hse_audits', 'training_culture']),
});

export const PLANNING_ENGINEER = mkWave4({
    packKey: 'planning_engineer',
    roleKey: 'planning_engineer',
    domain: 'engineering',
    specialization: 'Planning',
    roleAliases: ['planning engineer', 'project planner', 'مهندس تخطيط'],
    excludeKeywords: ['software project only', 'recruiter', 'hr'],
    matchKeywords: ['planning engineer', 'primavera', 'p6', 'critical path', 'تخطيط', 'جدولة'],
    terminology: ['Primavera P6', 'baseline', 'critical path', 'float', 'lookahead', 'progress', 'S-curve', 'resource loading', 'delay analysis', 'milestone', 'EPC schedule', 'recovery plan'],
    domainGuidance: 'Domain: Planning Engineering. Probe baseline schedules, critical path, progress measurement, delay analysis, and recovery planning.',
    competencies: [
        c('planning_engineer', 'baseline_schedule', 'Baseline Scheduling', 'قياس الجدول الأساسي.', ['WBS', 'logic'], ['جدول غير واقعي'], ['baseline']),
        c('planning_engineer', 'critical_path', 'Critical Path Control', 'قياس المسار الحرج.', ['float', 'driving'], ['لا متابعة'], ['تأخير حرج']),
        c('planning_engineer', 'progress_measurement', 'Progress Measurement', 'قياس التقدم.', ['S-curve', 'rules'], ['تقدم وهمي'], ['قياس تقدم']),
        c('planning_engineer', 'delay_analysis', 'Delay Analysis', 'قياس تحليل التأخير.', ['cause', 'impact'], ['لوم'], ['تأخير كبير']),
        c('planning_engineer', 'recovery_planning', 'Recovery Planning', 'قياس خطط الاستعادة.', ['mitigation', 'resequence'], ['لا خطة'], ['استعادة جدول']),
        c('planning_engineer', 'stakeholder_reporting', 'Stakeholder Reporting', 'قياس التقارير.', ['lookahead', 'narrative'], ['أرقام بلا سياق'], ['تقرير إدارة']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي تأخير كبير حللته — شنو السبب وشنو خطة الاستعادة؟',
        'شلون تبني baseline واقعي لمشروع EPC أو إنشائي؟',
        'اذكرلي تقرير تقدم غيّر قرار الإدارة — شنو أظهرت؟',
    ],
    trackSignals: { academic: ['planning', 'primavera', 'تخطيط'], field: ['p6', 'critical path', 'baseline', 'delay'] },
    pathSteps: stdSteps(['baseline_schedule', 'critical_path', 'progress_measurement', 'delay_analysis', 'recovery_planning']),
});

export const ACCOUNTS_RECEIVABLE = mkWave4({
    packKey: 'accounts_receivable',
    roleKey: 'accounts_receivable',
    domain: 'business',
    specialization: 'Accounts Receivable',
    roleAliases: ['accounts receivable', 'ar officer', 'credit control', 'ذمم مدينة', 'حسابات مدينة'],
    excludeKeywords: ['accounts payable', 'payable only', 'recruiter', 'developer'],
    matchKeywords: ['accounts receivable', 'ar', 'collections', 'aging', 'credit', 'ذمم مدينة', 'تحصيل'],
    terminology: ['aging report', 'DSO', 'credit limit', 'invoice dispute', 'cash application', 'write-off', 'collection call', 'statement', 'reconciliation', 'bad debt', 'billing', 'SOX'],
    domainGuidance: 'Domain: Accounts Receivable. Probe billing accuracy, aging/collections, cash application, credit control, and reconciliation — distinct from AP.',
    competencies: [
        c('accounts_receivable', 'billing_accuracy', 'Billing Accuracy', 'قياس الفوترة.', ['invoice', 'pricing'], ['أخطاء'], ['فاتورة خاطئة']),
        c('accounts_receivable', 'collections', 'Collections Strategy', 'قياس التحصيل.', ['aging', 'call script'], ['تجاهل'], ['عميل متأخر']),
        c('accounts_receivable', 'cash_application', 'Cash Application', 'قياس تطبيق النقد.', ['remittance', 'match'], ['فروقات'], ['دفعة غير مطابقة']),
        c('accounts_receivable', 'credit_control', 'Credit Control', 'قياس الائتمان.', ['limit', 'hold'], ['تجاوز'], ['عميل مخاطر']),
        c('accounts_receivable', 'dispute_resolution', 'Dispute Resolution', 'قياس النزاعات.', ['root cause', 'credit note'], ['إنكار'], ['نزاع كبير']),
        c('accounts_receivable', 'reporting_ar', 'AR Reporting', 'قياس تقارير AR.', ['DSO', 'trend'], ['لا تحليل'], ['تحسين DSO']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي عميل متأخر كبير — شنو استراتيجية التحصيل وشنو النتيجة؟',
        'شلون تطبق cash application لدفعة معقدة أو غير مطابقة؟',
        'اذكرلي نزاع فوترة حليته دون خسارة علاقة العميل؟',
    ],
    trackSignals: { academic: ['accounts receivable', 'ذمم مدينة'], field: ['aging', 'collections', 'dso', 'cash application'] },
    pathSteps: stdSteps(['billing_accuracy', 'collections', 'cash_application', 'credit_control', 'dispute_resolution']),
});

export const PROCUREMENT_OFFICER = mkWave4({
    packKey: 'procurement_officer',
    roleKey: 'procurement_officer',
    domain: 'business',
    specialization: 'Procurement',
    roleAliases: ['procurement officer', 'buyer', 'مشتريات', 'مسؤول مشتريات'],
    excludeKeywords: ['recruiter', 'software developer', 'sales only'],
    matchKeywords: ['procurement', 'purchasing', 'rfq', 'vendor', 'مشتريات', 'توريد'],
    terminology: ['RFQ', 'RFP', 'PO', 'vendor scorecard', 'lead time', 'incoterms', 'three bids', 'approval matrix', 'spend analysis', 'supplier audit', 'contract', 'SLA'],
    domainGuidance: 'Domain: Procurement. Probe sourcing, PO controls, vendor negotiation, spend compliance, and delivery risk management.',
    competencies: [
        c('procurement_officer', 'sourcing', 'Sourcing & RFQ', 'قياس التوريد.', ['RFQ', 'evaluation'], ['مورد واحد'], ['مناقصة']),
        c('procurement_officer', 'po_control', 'PO Control', 'قياس أوامر الشراء.', ['approval', 'budget'], ['تجاوز'], ['PO عاجل']),
        c('procurement_officer', 'negotiation', 'Vendor Negotiation', 'قياس التفاوض.', ['TCO', 'terms'], ['قبول أول عرض'], ['تفاوض']),
        c('procurement_officer', 'vendor_management', 'Vendor Management', 'قياس إدارة الموردين.', ['scorecard', 'CAR'], ['لا متابعة'], ['مورد ضعيف']),
        c('procurement_officer', 'compliance_proc', 'Procurement Compliance', 'قياس الامتثال.', ['policy', 'audit'], ['مخالفة'], ['استثناء']),
        c('procurement_officer', 'delivery_risk', 'Delivery Risk', 'قياس مخاطر التسليم.', ['lead time', 'expedite'], ['مفاجأة'], ['تأخير حرج']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي شراء حرج أو باهظ — شنو عملية التوريد وشنو وفرت؟',
        'شلون تتعامل مع مورد متأخر يهدد المشروع؟',
        'اذكرلي مخالفة أو استثناء مشتريات عالجته بحوكمة صحيحة؟',
    ],
    trackSignals: { academic: ['procurement', 'مشتريات'], field: ['rfq', 'po', 'vendor', 'negotiation'] },
    pathSteps: stdSteps(['sourcing', 'po_control', 'negotiation', 'vendor_management', 'compliance_proc']),
});

export const PROJECT_MANAGER = mkWave4({
    packKey: 'project_manager',
    roleKey: 'project_manager',
    domain: 'business',
    specialization: 'Project / Program Management',
    roleAliases: ['project manager', 'pm', 'مدير مشروع'],
    excludeKeywords: ['product manager software only', 'scrum only', 'recruiter', 'learning and development', 'l&d', 'training specialist'],
    matchKeywords: ['project manager', 'program manager', 'raid', 'stakeholder', 'مشروع', 'تسليم'],
    terminology: ['scope', 'RAID log', 'Gantt', 'critical path', 'change request', 'milestone', 'RACI', 'budget variance', 'go-live', 'status report', 'risk register', 'steerco'],
    domainGuidance: 'Domain: Project Management. Probe scope/schedule control, RAID, stakeholder communication, change control, and delivery outcomes.',
    competencies: [
        c('project_manager', 'scope_control', 'Scope Control', 'قياس النطاق.', ['WBS', 'change'], ['زحف'], ['change request']),
        c('project_manager', 'schedule_control', 'Schedule Control', 'قياس الجدول.', ['critical path', 'buffer'], ['وعود'], ['تأخير']),
        c('project_manager', 'risk_issues', 'Risk & Issues', 'قياس RAID.', ['RAID', 'mitigation'], ['تجاهل'], ['خطر تحقق']),
        c('project_manager', 'stakeholder_mgmt', 'Stakeholder Management', 'قياس الأطراف.', ['steerco', 'expectations'], ['صراع'], ['تعارض أطراف']),
        c('project_manager', 'budget_delivery', 'Budget & Delivery', 'قياس التسليم.', ['variance', 'quality'], ['تجاوز'], ['go-live']),
        c('project_manager', 'team_leadership', 'Team Leadership', 'قياس قيادة الفريق.', ['delegation', 'motivation'], ['أبوة'], ['فريق تحت ضغط']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي مشروع تأخر أو تجاوز ميزانيته — شنو قراراتك وشنو النتيجة؟',
        'شلون تدير change request مفاجئ من عميل أو إدارة؟',
        'اذكرلي تعارض أطراف حليته دون إيقاف المشروع؟',
    ],
    trackSignals: { academic: ['project management', 'pmp'], field: ['raid', 'milestone', 'stakeholder', 'go-live'] },
    pathSteps: stdSteps(['scope_control', 'schedule_control', 'risk_issues', 'stakeholder_mgmt', 'budget_delivery']),
});

export const IT_SUPPORT = mkWave4({
    packKey: 'it_support',
    roleKey: 'it_support_specialist',
    domain: 'technology',
    specialization: 'IT Support',
    roleAliases: ['it support', 'helpdesk', 'desktop support', 'دعم تقني', 'IT technician'],
    excludeKeywords: ['customer support ticket product', 'sales support', 'software developer', 'devops'],
    matchKeywords: ['it support', 'helpdesk', 'active directory', 'desktop', 'laptop', 'vpn', 'دعم تقني', 'مسؤول نظام'],
    terminology: ['Active Directory', 'ticketing', 'VPN', 'imaging', 'password reset', 'SLA', 'escalation', 'knowledge base', 'remote support', 'asset management', 'Office 365', 'network basics'],
    domainGuidance: 'Domain: IT Support. Probe incident triage, end-user support, troubleshooting, documentation, and SLA/escalation — not customer product support.',
    competencies: [
        c('it_support', 'incident_triage', 'Incident Triage', 'قياس فرز الحوادث.', ['priority', 'category'], ['فوضى'], ['حادث حرج']),
        c('it_support', 'end_user_support', 'End-user Support', 'قياس دعم المستخدم.', ['remote', 'onsite'], ['مهلة'], ['مستخدم VIP']),
        c('it_support', 'system_troubleshoot', 'System Troubleshooting', 'قياس التشخيص.', ['logs', 'root cause'], ['إعادة تشغيل فقط'], ['مشكلة معقدة']),
        c('it_support', 'access_identity', 'Access & Identity', 'قياس الحسابات.', ['AD', 'MFA'], ['تجاوز'], ['صلاحيات']),
        c('it_support', 'documentation_kb', 'Documentation & KB', 'قياس التوثيق.', ['KB article'], ['لا توثيق'], ['مقال KB']),
        c('it_support', 'sla_escalation', 'SLA & Escalation', 'قياس التصعيد.', ['SLA', 'handoff'], ['تصعيد متأخر'], ['تصعيد L2']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي حادث IT حرج حليته — شنو التشخيص وشنو الإجراء؟',
        'شلون تدعم مستخدم غير تقني تحت ضغط وقت؟',
        'اذكرلي مشكلة متكررة وثّقتها أو منعت تكرارها؟',
    ],
    trackSignals: { academic: ['it support', 'helpdesk'], field: ['active directory', 'vpn', 'ticketing', 'imaging'] },
    pathSteps: stdSteps(['incident_triage', 'end_user_support', 'system_troubleshoot', 'access_identity', 'documentation_kb']),
});

export const SALES_EXECUTIVE = mkWave4({
    packKey: 'sales_executive',
    roleKey: 'sales_executive',
    domain: 'business',
    specialization: 'Sales',
    roleAliases: ['sales executive', 'sales rep', 'مبيعات', 'منفذ مبيعات'],
    excludeKeywords: ['marketing only', 'recruiter', 'developer'],
    matchKeywords: ['sales executive', 'sales representative', 'pipeline', 'quota', 'مبيعات', 'صفقة'],
    terminology: ['CRM', 'pipeline', 'quota', 'conversion', 'discovery', 'proposal', 'negotiation', 'upsell', 'forecast', 'territory', 'objection handling', 'closing'],
    domainGuidance: 'Domain: Sales Executive. Probe discovery, pipeline discipline, objection handling, closing, and quota/forecast ownership.',
    competencies: [
        c('sales_executive', 'discovery', 'Discovery & Needs', 'قياس الاكتشاف.', ['questions', 'pain'], ['عرض مبكر'], ['discovery call']),
        c('sales_executive', 'pipeline_mgmt', 'Pipeline Management', 'قياس الأنبوب.', ['stages', 'forecast'], ['أنبوب وهمي'], ['صفقة عالقة']),
        c('sales_executive', 'objection_handling', 'Objection Handling', 'قياس الاعتراضات.', ['reframe', 'proof'], ['خصم'], ['اعتراض سعر']),
        c('sales_executive', 'closing', 'Closing & Follow-up', 'قياس الإغلاق.', ['next step', 'commitment'], ['ضغط'], ['صفقة أغلقتها']),
        c('sales_executive', 'account_growth', 'Account Growth', 'قياس النمو.', ['upsell', 'cross-sell'], ['بيع لمرة'], ['توسيع حساب']),
        c('sales_executive', 'crm_discipline', 'CRM Discipline', 'قياس الانضباط.', ['activity log'], ['CRM فارغ'], ['تنبؤ دقيق']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي صفقة صعبة أغلقتها — شنو الاعتراض وشنو أسلوبك؟',
        'شلون تبني pipeline واقعي تحت ضغط quota؟',
        'اذكرلي عميل خسرته أو فزت به — شنو تعلمت؟',
    ],
    trackSignals: { academic: ['sales', 'مبيعات'], field: ['crm', 'pipeline', 'quota', 'negotiation'] },
    pathSteps: stdSteps(['discovery', 'pipeline_mgmt', 'objection_handling', 'closing', 'account_growth']),
});

export const BUSINESS_DEVELOPMENT = mkWave4({
    packKey: 'business_development',
    roleKey: 'business_development_manager',
    domain: 'business',
    specialization: 'Business Development',
    roleAliases: ['business development', 'bd specialist', 'bd manager', 'تطوير أعمال'],
    excludeKeywords: ['recruiter', 'software developer only', 'customer support', 'hr business partner', 'human resources', 'hr manager', 'hr generalist'],
    matchKeywords: ['business development', 'partnerships', 'market entry', 'تطوير أعمال', 'شراكات'],
    terminology: ['ICP', 'partnership', 'market entry', 'lead generation', 'value proposition', 'deal structure', 'pipeline', 'pitch deck', 'competitive landscape', 'RFP', 'MOU', 'revenue share'],
    domainGuidance: 'Domain: Business Development. Probe market/partnership opportunities, value proposition, deal structuring, and pipeline beyond transactional sales.',
    competencies: [
        c('business_development', 'market_opportunity', 'Market Opportunity', 'قياس الفرص.', ['ICP', 'segment'], ['عشوائي'], ['سوق جديد']),
        c('business_development', 'partnership_building', 'Partnership Building', 'قياس الشراكات.', ['MOU', 'alignment'], ['لا قيمة'], ['شراكة']),
        c('business_development', 'value_proposition', 'Value Proposition', 'قياس القيمة.', ['pitch', 'ROI'], ['عام'], ['عرض قيمة']),
        c('business_development', 'deal_structure', 'Deal Structuring', 'قياس الصفقات.', ['terms', 'risk'], ['تنازل'], ['هيكلة صفقة']),
        c('business_development', 'pipeline_bd', 'BD Pipeline', 'قياس الأنبوب.', ['stages', 'partners'], ['لا متابعة'], ['فرصة كبيرة']),
        c('business_development', 'competitive_intel', 'Competitive Intelligence', 'قياس المنافسة.', ['differentiation'], ['لا وعي'], ['منافس قوي']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي شراكة أو فرصة سوق طورتها — شنو الخطوات وشنو النتيجة؟',
        'شلون تبني value proposition لعميل أو شريك جديد؟',
        'اذكرلي صفقة BD تعثرت — شنو السبب وشنو تعلمت؟',
    ],
    trackSignals: { academic: ['business development', 'تطوير أعمال'], field: ['partnership', 'market entry', 'pitch', 'deal'] },
    pathSteps: stdSteps(['market_opportunity', 'partnership_building', 'value_proposition', 'deal_structure', 'pipeline_bd']),
});

export const CALL_CENTER = mkWave4({
    packKey: 'call_center',
    roleKey: 'call_center_agent',
    domain: 'customer_operations',
    specialization: 'Call Center',
    roleAliases: ['call center', 'call centre agent', 'كول سنتر', 'مركز اتصال'],
    excludeKeywords: ['software developer', 'it support', 'recruiter', 'field sales'],
    matchKeywords: ['call center', 'call centre', 'inbound', 'outbound', 'aht', 'كول سنتر', 'اتصال'],
    terminology: ['AHT', 'ACW', 'FCR', 'QA scorecard', 'wrap-up', 'hold time', 'CSAT', 'adherence', 'callback', 'script', 'queue', 'quality monitoring'],
    domainGuidance: 'Domain: Call Center. Probe call handling quality, script adherence, de-escalation, queue metrics, and QA coaching — distinct from async customer support.',
    competencies: [
        c('call_center', 'call_handling', 'Call Handling', 'قياس إدارة المكالمة.', ['opening', 'closing'], ['متسرع'], ['مكالمة صعبة']),
        c('call_center', 'script_adherence', 'Script Adherence', 'قياس الالتزام بالسكربت.', ['compliance', 'flex'], ['قراءة جامدة'], ['استثناء']),
        c('call_center', 'de_escalation', 'De-escalation', 'قياس تهدئة المتصل.', ['tone', 'empathy'], ['تصعيد'], ['متصل غاضب']),
        c('call_center', 'queue_metrics', 'Queue Metrics', 'قياس المؤشرات.', ['AHT', 'FCR'], ['لا وعي'], ['تحسين AHT']),
        c('call_center', 'quality_coaching', 'Quality Coaching', 'قياس الجودة.', ['QA scorecard'], ['تجاهل'], ['تغذية راجعة']),
        c('call_center', 'product_process', 'Product/Process Knowledge', 'قياس المعرفة.', ['policy', 'update'], ['أخطاء'], ['تحديث نظام']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي مكالمة صعبة هديت فيها المتصل — شنو استخدمت؟',
        'شلون توازن بين AHT وجودة الخدمة؟',
        'اذكرلي ملاحظة QA طبّقتها وحسّنت أداءك؟',
    ],
    trackSignals: { academic: ['call center', 'كول سنتر'], field: ['aht', 'fcr', 'script', 'queue'] },
    pathSteps: stdSteps(['call_handling', 'script_adherence', 'de_escalation', 'queue_metrics', 'quality_coaching']),
});

export const ACCOUNT_MANAGER = mkWave4({
    packKey: 'account_manager',
    roleKey: 'account_manager',
    domain: 'business',
    specialization: 'Account Management',
    roleAliases: ['account manager', 'key account', 'مدير حسابات', 'إدارة حسابات'],
    excludeKeywords: ['recruiter', 'developer', 'junior sales only'],
    matchKeywords: ['account manager', 'key account', 'customer retention', 'account plan', 'حسابات'],
    terminology: ['account plan', 'QBR', 'retention', 'churn', 'upsell', 'cross-sell', 'stakeholder map', 'SLA review', 'relationship', 'NRR', 'expansion', 'success plan'],
    domainGuidance: 'Domain: Account Management. Probe account planning, retention/expansion, QBRs, stakeholder mapping, and measurable account health.',
    competencies: [
        c('account_manager', 'account_planning', 'Account Planning', 'قياس تخطيط الحساب.', ['plan', 'goals'], ['رد فعل'], ['خطة سنوية']),
        c('account_manager', 'retention', 'Retention & Risk', 'قياس الاحتفاظ.', ['churn signal', 'save'], ['مفاجأة'], ['عميل معرض للخسارة']),
        c('account_manager', 'expansion', 'Expansion Revenue', 'قياس التوسع.', ['upsell', 'QBR'], ['لا فرص'], ['توسيع']),
        c('account_manager', 'stakeholder_map', 'Stakeholder Mapping', 'قياس أصحاب المصلحة.', ['champion', 'economic buyer'], ['جهة واحدة'], ['تغيير جهة']),
        c('account_manager', 'issue_resolution', 'Issue Resolution', 'قياس حل المشاكل.', ['escalation', 'RCA'], ['تجاهل'], ['أزمة حساب']),
        c('account_manager', 'value_review', 'Value Review', 'قياس مراجعات القيمة.', ['QBR', 'ROI'], ['اجتماع شكلي'], ['QBR مؤثر']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي حساباً كاد يضيع — شنو فعلت للاحتفاظ به؟',
        'شلون تبني خطة حساب لعميل استراتيجي؟',
        'اذكرلي توسيع إيراد من عميل قائم — شنو الفرصة وشنو النتيجة؟',
    ],
    trackSignals: { academic: ['account management', 'حسابات'], field: ['qbr', 'retention', 'upsell', 'account plan'] },
    pathSteps: stdSteps(['account_planning', 'retention', 'expansion', 'stakeholder_map', 'issue_resolution']),
});

export const WAVE_4_PACKS: DomainPack[] = [
    HR_GENERALIST,
    HR_OFFICER,
    TALENT_ACQUISITION,
    HR_MANAGER,
    PAYROLL_OFFICER,
    MECHANICAL_ENGINEER,
    ELECTRICAL_ENGINEER,
    QA_QC_ENGINEER,
    HSE_ENGINEER,
    PLANNING_ENGINEER,
    ACCOUNTS_RECEIVABLE,
    PROCUREMENT_OFFICER,
    PROJECT_MANAGER,
    IT_SUPPORT,
    SALES_EXECUTIVE,
    BUSINESS_DEVELOPMENT,
    CALL_CENTER,
    ACCOUNT_MANAGER,
];
