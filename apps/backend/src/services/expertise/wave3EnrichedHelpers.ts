// Wave 3 L3 Enriched — shared helpers (paths, rubrics, tracks)
import type {
    ExperienceTrackKey,
    ExperienceTrackSpec,
    InterviewPath,
    InterviewPathStep,
    ScoreRubric,
} from './domainPacks.js';

/** L3 Enriched pack version — structural QA bar for Wave 3 expansion. */
export const WAVE_3_ENRICHED_VERSION = '1.4.0';

/** All deep packs at L3 Enriched structural bar (v1.4.0). */
export const L3_ENRICHED_PACK_KEYS = [
    // Pilots / O&G
    'oil_gas_production',
    'petroleum_engineer',
    'reservoir_engineer',
    'drilling_engineer',
    'process_engineer',
    // HR
    'hr_recruiter',
    // Construction
    'civil_engineer',
    'site_engineer',
    'survey_engineer',
    // Tech
    'frontend_developer',
    'backend_developer',
    'devops_engineer',
    'qa_engineer',
    'data_analyst',
    // Ops / support
    'customer_support',
    'operations_coordinator',
    // Finance
    'general_accountant',
    'accounts_payable',
    'financial_analyst',
    'internal_auditor',
    // Wave 4
    'hr_generalist',
    'hr_officer',
    'talent_acquisition',
    'hr_manager',
    'payroll_officer',
    'mechanical_engineer',
    'electrical_engineer',
    'qa_qc_engineer',
    'hse_engineer',
    'planning_engineer',
    'accounts_receivable',
    'procurement_officer',
    'project_manager',
    'it_support',
    'sales_executive',
    'business_development',
    'call_center',
    'account_manager',
] as const;

export type L3EnrichedPackKey = (typeof L3_ENRICHED_PACK_KEYS)[number];

/** Wave 4 pack keys (subset of L3_ENRICHED_PACK_KEYS). */
export const WAVE_4_PACK_KEYS = [
    'hr_generalist',
    'hr_officer',
    'talent_acquisition',
    'hr_manager',
    'payroll_officer',
    'mechanical_engineer',
    'electrical_engineer',
    'qa_qc_engineer',
    'hse_engineer',
    'planning_engineer',
    'accounts_receivable',
    'procurement_officer',
    'project_manager',
    'it_support',
    'sales_executive',
    'business_development',
    'call_center',
    'account_manager',
] as const;

export const ACADEMIC_TRACKS: ExperienceTrackKey[] = ['academic_only', 'entry_level', 'trainee'];
export const FIELD_TRACKS: ExperienceTrackKey[] = ['experienced', 'senior', 'career_switcher'];

/** Path with preferredTracks + default clusterKey per step. */
export function enrichedPath(
    pathKey: string,
    preferredTracks: ExperienceTrackKey[],
    steps: InterviewPathStep[]
): InterviewPath {
    return {
        pathKey,
        preferredTracks,
        steps: steps.map((s) => ({
            ...s,
            clusterKey: s.clusterKey ?? s.competencyKey ?? s.stepKey,
        })),
    };
}

/** Competency-specific rubric — not shared RUBRIC_STD. */
export function uniqueRubric(
    score1: string,
    score5: string,
    score3 = 'مثال معقول بخطوات وبعض البيانات.',
    score4 = 'أدلة واضحة ونتيجة قابلة للمتابعة.'
): ScoreRubric {
    return {
        '1': score1,
        '2': 'مفاهيم عامة بلا تطبيق عملي على الدور.',
        '3': score3,
        '4': score4,
        '5': score5,
    };
}

/** O&G production field tracks — domain-specific signals. */
export function ogProductionTracks(): ExperienceTrackSpec[] {
    return [
        {
            trackKey: 'academic_only',
            detectSignals: [
                'جامعة', 'تخرج', 'مشروع تخرج', 'محاكاة', 'nodal', 'thesis', 'اكاديمي',
                'ما عندي خبرة ميدانية', 'university', 'simulation',
            ],
            acceptableEvidence: ['مشروع تخرج', 'nodal analysis', 'well testing نظري', 'محاكاة'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي مشروع أو محاكاة إنتاج/بئر درستها — شنو المدخلات وشنو تعلمت؟',
                'شنو أصعب مفهوم إنتاج نفطي طبّقته نظرياً؟',
            ],
            followUpHints: ['لا تفترض خبرة حقل'],
            rubricAdjustments: 'اقبل أدلة أكاديمية ومحاكاة — لا تخصم غياب تجربة حقل.',
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'co-op', 'فترة تدريب'],
            acceptableEvidence: ['مهام محددة', 'إشراف', 'ملاحظات ميدانية'],
            questionDifficulty: 1,
            openingAnchors: ['شنو شفت وشنو تعلمت بفترة التدريب بالإنتاج النفطي؟'],
            followUpHints: ['اسأل عن الإشراف والأدوات'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'fresh graduate'],
            acceptableEvidence: ['أول مهمة', 'تعلم سريع'],
            questionDifficulty: 1,
            openingAnchors: ['اذكرلي أول مهمة إنتاج أو بئر بعد التخرج — شنو سويت؟'],
            followUpHints: ['خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: [
                'حقل', 'oilfield', 'بئر', 'آبار', 'water cut', 'gor', 'artificial lift',
                'اشتغلت', 'field', 'well', 'production engineer', 'ESP', 'gas lift',
            ],
            acceptableEvidence: ['بيانات بئر', 'Water Cut', 'GOR', 'إجراء', 'نتيجة'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي بئر أو موقع إنتاج تابعته — شنو المؤشرات اللي راجعتها يومياً؟',
                'شلون تشخّص انخفاض إنتاج بئر ببيانات حقيقية؟',
            ],
            followUpHints: ['اطلب أرقام ومؤشرات'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'manager', 'قاد', 'استراتيجية', 'optimization'],
            acceptableEvidence: ['قرار تشغيلي', 'تحسين إنتاج', 'فريق'],
            questionDifficulty: 3,
            openingAnchors: ['اذكرلي قرار تحسين إنتاج أو تشغيل مهم — شنو التأثير؟'],
            followUpHints: ['trade-offs بين الإنتاج والسلامة'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'من مجال'],
            acceptableEvidence: ['تعلم سريع', 'مهارات منقولة'],
            questionDifficulty: 2,
            openingAnchors: ['ليش انتقلت لإنتاج نفطي وشنو نقلته من مجالك السابق؟'],
            followUpHints: ['مثال تعلم سريع'],
        },
    ];
}

/** General accounting tracks. */
export function accountingTracks(): ExperienceTrackSpec[] {
    return [
        {
            trackKey: 'academic_only',
            detectSignals: ['جامعة', 'تخرج', 'مشروع تخرج', 'thesis', 'اكاديمي', 'محاسبة جامعية'],
            acceptableEvidence: ['مشروع تخرج', 'case study', 'تطبيق نظري'],
            questionDifficulty: 1,
            openingAnchors: ['اذكرلي مشروع أو case study محاسبي درسته — شنو تعلمت؟'],
            followUpHints: ['لا تفترض خبرة إقفال فعلية'],
            rubricAdjustments: 'اقبل أدلة أكاديمية — لا تخصم غياب month-end فعلي.',
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'trainee'],
            acceptableEvidence: ['مهام محددة', 'إشراف'],
            questionDifficulty: 1,
            openingAnchors: ['شنو تعلمت بفترة التدريب المحاسبي؟'],
            followUpHints: ['اسأل عن الإشراف'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'staff accountant'],
            acceptableEvidence: ['أول مهمة', 'قيود', 'تسويات بسيطة'],
            questionDifficulty: 1,
            openingAnchors: ['اذكرلي أول مهمة محاسبية بعد التخرج — شنو سويت؟'],
            followUpHints: ['خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: ['اشتغلت', 'سنوات', 'month-end', 'reconciliation', 'general ledger', 'إقفال'],
            acceptableEvidence: ['تسوية', 'إقفال', 'نتيجة', 'دقة'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي إقفال شهري أو تسوية معقدة — شنو الخطوات وشنو النتيجة؟',
                'شلون اكتشفت وصححت فرقاً بالميزان؟',
            ],
            followUpHints: ['اطلب أرقام وخطوات'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'supervisor', 'قاد', 'review'],
            acceptableEvidence: ['مراجعة', 'تحسين عملية', 'فريق'],
            questionDifficulty: 3,
            openingAnchors: ['اذكرلي تحسين عملية محاسبية قدته — شنو التأثير؟'],
            followUpHints: ['ضوابط داخلية'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'من مجال'],
            acceptableEvidence: ['تعلم سريع', 'مهارات منقولة'],
            questionDifficulty: 2,
            openingAnchors: ['ليش انتقلت للمحاسبة وشنو نقلته؟'],
            followUpHints: ['مثال تعلم'],
        },
    ];
}

/** Backend engineering tracks — API, data, production incidents. */
export function backendTracks(): ExperienceTrackSpec[] {
    return [
        {
            trackKey: 'academic_only',
            detectSignals: [
                'جامعة', 'تخرج', 'مشروع تخرج', 'thesis', 'اكاديمي', 'course project',
                'university', 'REST API project', 'graduation',
            ],
            acceptableEvidence: ['مشروع API', 'قاعدة بيانات أكاديمية', 'تعلم نظري'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي مشروع backend أو API درسته — شنو صممت وشنو تعلمت؟',
                'شنو أصعب قرار تصميم واجهة برمجية طبّقته نظرياً؟',
            ],
            followUpHints: ['لا تفترض خبرة إنتاج طويلة'],
            rubricAdjustments: 'اقبل مشاريع جامعية ومحاكاة — لا تخصم غياب حوادث إنتاج.',
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'co-op'],
            acceptableEvidence: ['مهام محددة', 'endpoint بإشراف', 'code review'],
            questionDifficulty: 1,
            openingAnchors: ['شنو تعلمت بفترة التدريب كمطور backend؟'],
            followUpHints: ['اسأل عن الإشراف والاختبارات'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'junior backend', 'fresh graduate'],
            acceptableEvidence: ['أول endpoint', 'أول bug fix', 'تعلم سريع'],
            questionDifficulty: 1,
            openingAnchors: ['اذكرلي أول مهمة backend بعد التخرج — شنو سويت؟'],
            followUpHints: ['خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: [
                'اشتغلت', 'production', 'microservices', 'api', 'postgres', 'node',
                'express', 'django', 'spring', 'إنتاج', 'خدمة', 'endpoint',
            ],
            acceptableEvidence: ['API حقيقي', 'استعلام حسّنه', 'حادث', 'نتيجة'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي خدمة أو API شغّلتها بالإنتاج — شنو التحدي وشنو النتيجة؟',
                'شلون شخّصت مشكلة أداء أو حادث backend؟',
            ],
            followUpHints: ['اطلب trade-offs وقياسات'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'staff', 'architect', 'قاد', 'tech lead'],
            acceptableEvidence: ['قرار معماري', 'مراجعة', 'تحسين موثوقية', 'فريق'],
            questionDifficulty: 3,
            openingAnchors: ['اذكرلي قرار معماري backend مهم — شنو المقايضة والتأثير؟'],
            followUpHints: ['اسأل عن observability وSLA'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'من مجال'],
            acceptableEvidence: ['تعلم سريع', 'مهارات منقولة'],
            questionDifficulty: 2,
            openingAnchors: ['ليش انتقلت لـ backend وشنو نقلته من مجالك السابق؟'],
            followUpHints: ['مثال تعلم سريع'],
        },
    ];
}

type DomainTrackConfig = {
    academicSignals?: string[];
    fieldSignals: string[];
    academicAnchors: string[];
    fieldAnchors: string[];
    academicEvidence?: string[];
    fieldEvidence?: string[];
    academicRubricAdj?: string;
    traineeAnchor?: string;
    entryAnchor?: string;
    seniorAnchor?: string;
    switcherAnchor?: string;
};

/** Reusable domain-specific experience tracks (replaces stdTracks boilerplate). */
export function buildDomainTracks(c: DomainTrackConfig): ExperienceTrackSpec[] {
    return [
        {
            trackKey: 'academic_only',
            detectSignals: [
                'جامعة', 'تخرج', 'مشروع تخرج', 'thesis', 'اكاديمي', 'نظري',
                ...(c.academicSignals ?? []),
            ],
            acceptableEvidence: c.academicEvidence ?? ['مشروع تخرج', 'دورة', 'تعلم نظري'],
            questionDifficulty: 1,
            openingAnchors: c.academicAnchors,
            followUpHints: ['لا تفترض خبرة عمل طويلة'],
            rubricAdjustments: c.academicRubricAdj,
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'co-op'],
            acceptableEvidence: ['مهام محددة', 'إشراف'],
            questionDifficulty: 1,
            openingAnchors: [c.traineeAnchor ?? 'شنو تعلمت بفترة التدريب؟'],
            followUpHints: ['اسأل عن الإشراف'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'fresh graduate'],
            acceptableEvidence: ['أول مهمة', 'تعلم سريع'],
            questionDifficulty: 1,
            openingAnchors: [c.entryAnchor ?? 'اذكرلي أول مهمة بعد التخرج — شنو سويت؟'],
            followUpHints: ['خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: ['اشتغلت', 'سنوات', 'خبرة', 'مشروع', 'فريق', ...(c.fieldSignals ?? [])],
            acceptableEvidence: c.fieldEvidence ?? ['مثال حقيقي', 'نتيجة', 'أرقام'],
            questionDifficulty: 3,
            openingAnchors: c.fieldAnchors,
            followUpHints: ['اطلب تفاصيل ونتيجة'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'manager', 'قاد', 'استراتيجية'],
            acceptableEvidence: ['قرار', 'قيادة', 'تأثير'],
            questionDifficulty: 3,
            openingAnchors: [c.seniorAnchor ?? 'اذكرلي قرار أو مبادرة قدتها — شنو التأثير؟'],
            followUpHints: ['trade-offs'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'من مجال'],
            acceptableEvidence: ['تعلم سريع', 'مهارات منقولة'],
            questionDifficulty: 2,
            openingAnchors: [c.switcherAnchor ?? 'ليش انتقلت لهذا المجال وشنو نقلته؟'],
            followUpHints: ['مثال تعلم'],
        },
    ];
}

export const frontendTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['react', 'vue', 'typescript', 'frontend', 'واجهات'],
        fieldSignals: ['react', 'production', 'typescript', 'component', 'ui', 'واجهات', 'فرونت'],
        academicAnchors: [
            'اذكرلي مشروع واجهة أو React بالجامعة — شنو التقنيات؟',
            'شنو أصعب تحدي UI طبّقته نظرياً؟',
        ],
        fieldAnchors: [
            'اذكرلي ميزة React شغّلتها بالإنتاج — شنو المشكلة اللي حليتها؟',
            'شلون حسّنت أداء صفحة — شنو القياسات؟',
        ],
        academicRubricAdj: 'اقبل مشاريع واجهة أكاديمية — لا تخصم غياب إنتاج.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كمطور واجهات؟',
        entryAnchor: 'اذكرلي أول مهمة frontend بعد التخرج.',
        seniorAnchor: 'اذكرلي قرار معماري UI مهم — شنو التأثير؟',
        switcherAnchor: 'ليش انتقلت لتطوير الواجهات؟',
    });

export const devopsTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['kubernetes', 'terraform', 'ci/cd', 'docker', 'lab'],
        fieldSignals: ['kubernetes', 'terraform', 'ci/cd', 'incident', 'on-call', 'pipeline', 'ديفوبس'],
        academicAnchors: ['اذكرلي مشروع DevOps أكاديمي أو معملي.', 'شنو تعلمت عن CI/CD نظرياً؟'],
        fieldAnchors: [
            'اذكرلي incident أو deployment حسّنته فعلياً.',
            'شلون pipeline أو K8s أثر على الموثوقية؟',
        ],
        academicRubricAdj: 'اقبل مشاريع معملية — لا تخصم غياب on-call.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كـ DevOps/SRE؟',
        seniorAnchor: 'اذكرلي تحسين موثوقية أو تكلفة بنية — شنو المقايضة؟',
        switcherAnchor: 'ليش انتقلت لـ DevOps/SRE؟',
    });

export const dataAnalystTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['sql', 'power bi', 'tableau', 'تحليل', 'dashboard'],
        fieldSignals: ['sql', 'power bi', 'tableau', 'kpi', 'dashboard', 'stakeholder', 'بيانات'],
        academicAnchors: ['اذكرلي مشروع تحليل بيانات بالجامعة.', 'شنو استعلام SQL أو رسم درسته؟'],
        fieldAnchors: [
            'اذكرلي تحليل SQL أو BI أثر على قرار عمل.',
            'شلون dashboard غيّر توصية الإدارة؟',
        ],
        academicRubricAdj: 'اقبل تحليلات أكاديمية — لا تخصم غياب stakeholder حقيقي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كمحلل بيانات؟',
        seniorAnchor: 'اذكرلي KPI أو نموذج قدته — شنو التأثير؟',
        switcherAnchor: 'ليش انتقلت لتحليل البيانات؟',
    });

export const qaTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['selenium', 'cypress', 'test', 'bootcamp', 'اختبار'],
        fieldSignals: ['regression', 'automation', 'selenium', 'cypress', 'release', 'bug', 'جودة'],
        academicAnchors: ['اذكرلي مشروع اختبار بالجامعة أو bootcamp.', 'شنو test plan درسته؟'],
        fieldAnchors: [
            'اذكرلي release أو regression suite مسؤول عنه.',
            'شلون automation منع عطلاً حرجاً؟',
        ],
        academicRubricAdj: 'اقبل مشاريع اختبار أكاديمية — لا تخصم غياب إنتاج.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كـ QA؟',
        seniorAnchor: 'اذكرلي استراتيجية جودة قدتها — شنو التأثير؟',
        switcherAnchor: 'ليش انتقلت لضمان الجودة البرمجية؟',
    });

export const customerSupportTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['customer service', 'crm', 'خدمة عملاء', 'شكوى'],
        fieldSignals: ['ticket', 'zendesk', 'csat', 'sla', 'escalation', 'عميل', 'دعم'],
        academicAnchors: ['اذكرلي تدريب أو مشروع خدمة عملاء.', 'شنو تعلمت عن التعامل مع العملاء؟'],
        fieldAnchors: [
            'اذكرلي عميل غاضب هديته وحققت حل.',
            'شلون وازنت بين السياسة وحاجة العميل؟',
        ],
        academicRubricAdj: 'اقبل سيناريوهات تدريب — لا تخصم غياب queue حقيقي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب بدعم العملاء؟',
        seniorAnchor: 'اذكرلي تحسين CSAT أو عملية تصعيد قدته.',
        switcherAnchor: 'ليش انتقلت لدعم العملاء؟',
    });

export const operationsCoordinatorTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['operations', 'coordination', 'sop', 'تنسيق', 'عمليات'],
        fieldSignals: ['vendor', 'sop', 'kpi', 'scheduling', 'workflow', 'bottleneck', 'عمليات'],
        academicAnchors: ['اذكرلي مشروع تنسيق أو عمليات بالجامعة.', 'شنو عملية درستها؟'],
        fieldAnchors: [
            'اذكرلي تحسين عملية بقياس قبل/بعد.',
            'شلون نسّقت موردين تحت ضغط جدول؟',
        ],
        academicRubricAdj: 'اقبل مشاريع تنسيق أكاديمية — لا تخصم غياب vendor حقيقي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كمنسق عمليات؟',
        seniorAnchor: 'اذكرلي تحسين SOP أو KPI على مستوى الفريق.',
        switcherAnchor: 'ليش انتقلت لتنسيق العمليات؟',
    });

export const accountsPayableTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['accounting', 'invoice', 'ap', 'ذمم', 'فواتير'],
        fieldSignals: ['three-way match', 'invoice', 'payment run', 'vendor', 'erp', 'ذمم دائنة'],
        academicAnchors: ['اذكرلي تدريب محاسبة أو AP.', 'شنو تعلمت عن مطابقة الفواتير؟'],
        fieldAnchors: [
            'اذكرلي دورة دفع أو مطابقة مورد.',
            'شلون three-way match منع خطأ دفع؟',
        ],
        academicRubricAdj: 'اقبل تمارين AP أكاديمية — لا تخصم غياب payment run فعلي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب في AP؟',
        seniorAnchor: 'اذكرلي تحسين ضابط أو عملية دفع قدته.',
        switcherAnchor: 'ليش انتقلت لـ Accounts Payable؟',
    });

export const financialAnalystTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['fp&a', 'excel model', 'variance', 'budget', 'تحليل مالي'],
        fieldSignals: ['forecast', 'variance', 'fp&a', 'budget', 'model', 'محلل مالي'],
        academicAnchors: ['اذكرلي مشروع مالي أكاديمي.', 'شنو نموذج Excel أو variance درسته؟'],
        fieldAnchors: [
            'اذكرلي تقرير variance أو forecast أثر على قرار.',
            'شنو أهم افتراضات نموذجك المالي؟',
        ],
        academicRubricAdj: 'اقبل نماذج أكاديمية — لا تخصم غياب FP&A فعلي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب كمحلل مالي؟',
        seniorAnchor: 'اذكرلي توصية مالية قدتها للإدارة.',
        switcherAnchor: 'ليش انتقلت للتحليل المالي؟',
    });

export const internalAuditorTracks = (): ExperienceTrackSpec[] =>
    buildDomainTracks({
        academicSignals: ['audit', 'controls', 'compliance', 'تدقيق', 'رقابة'],
        fieldSignals: ['internal audit', 'sox', 'control testing', 'finding', 'sampling', 'تدقيق داخلي'],
        academicAnchors: ['اذكرلي مشروع تدقيق أكاديمي.', 'شنو ضابط أو عينة درستها؟'],
        fieldAnchors: [
            'اذكرلي finding مهم وتابعته للإغلاق.',
            'شلون اخترت العينة بناءً على المخاطر؟',
        ],
        academicRubricAdj: 'اقبل case studies تدقيق — لا تخصم غياب engagement فعلي.',
        traineeAnchor: 'شنو تعلمت بفترة التدريب في التدقيق؟',
        seniorAnchor: 'اذكرلي مراجعة مخاطر أو ضوابط قدتها.',
        switcherAnchor: 'ليش انتقلت للتدقيق الداخلي؟',
    });
