// ============================================
// ملف: services/expertise/domainPacks.ts
// الوظيفة: حزم خبرة عميقة مراجَعة يدوياً (أولياً: النفط/الإنتاج + التوظيف/HR).
//          تُلهم توليد JobExpertiseProfile + InterviewBlueprint وتعطي عمقاً أعلى
//          للمجالات الأكثر استخداماً. البنية قابلة للتوسعة دون تغيير الكود.
//
// كل مجال آخر يبقى مدعوماً عبر التوليد الذكي + domainTaxonomy.ts.
// ============================================

/** rubric من 1 إلى 5 — وصف نوعي لكل مستوى. */
export interface ScoreRubric {
    '1': string;
    '2': string;
    '3': string;
    '4': string;
    '5': string;
}

/** كفاءة قابلة للقياس داخل حزمة المجال. */
export interface PackCompetency {
    /** مفتاح ثابت للكفاءة (snake_case) — يُستخدم في competencyScores. */
    competencyKey: string;
    title: string;
    /** أهمية الكفاءة: حرِجة/عالية/متوسطة. */
    priority: 'critical' | 'high' | 'medium';
    /** ما الذي يقيسه السؤال في هذه الكفاءة. */
    questionObjective: string;
    /** الأدلة التي نتوقع سماعها في إجابة قوية. */
    expectedEvidence: string[];
    /** مؤشرات إجابة ضعيفة/خطر. */
    redFlags: string[];
    /** rubric تقييم من 1 إلى 5. */
    scoreRubric: ScoreRubric;
    /** قواعد توليد أسئلة المتابعة حسب جواب المرشح. */
    followUpRules: string[];
}

/** مسارات خبرة المرشّح داخل نفس الدور — L3 إلزامي عند اكتمال الحزمة. */
export type ExperienceTrackKey =
    | 'entry_level'
    | 'academic_only'
    | 'trainee'
    | 'experienced'
    | 'senior'
    | 'career_switcher';

export interface ExperienceTrackSpec {
    trackKey: ExperienceTrackKey;
    /** إشارات STT/نص لكشف المسار (normalized matching في المحرك لاحقاً). */
    detectSignals: string[];
    acceptableEvidence: string[];
    questionDifficulty: 1 | 2 | 3;
    openingAnchors: string[];
    followUpHints: string[];
    rubricAdjustments?: string;
}

export interface InterviewPathStep {
    stepKey: string;
    competencyKey?: string;
    /** Groups steps for skip/competency jump (Wave 3 Enriched). */
    clusterKey?: string;
    topicLabel: string;
    sampleQuestion?: string;
}

export interface InterviewPath {
    pathKey: string;
    /** Which experience tracks use this path (Wave 3 Enriched). */
    preferredTracks?: ExperienceTrackKey[];
    steps: InterviewPathStep[];
}

export type PackMatchConfidence = 'high' | 'medium' | 'low';

export type PackMatchSource = 'roleKey' | 'alias' | 'title_domain' | 'keywords' | 'none';

export interface PackMatchResult {
    pack: DomainPack | null;
    packKey: string | null;
    confidence: PackMatchConfidence;
    score: number;
    matchSource: PackMatchSource;
    /** Second-best pack key — for collision diagnostics. */
    runnerUpPackKey?: string | null;
    runnerUpScore?: number;
    /** Gap between winner and runner-up (winner score when no runner-up). */
    scoreMargin?: number;
    /** Terms that contributed to the winning score (debug). */
    matchedTerms?: string[];
}

/** Minimum score gap for any non-low confidence. */
export const PACK_MATCH_MARGIN_LOW = 2;
/** Minimum gap for high confidence (alias/roleKey path). */
export const PACK_MATCH_MARGIN_HIGH = 5;
/** Minimum gap for medium-confidence matches to activate deep_pack in blueprint. */
export const PACK_MATCH_MARGIN_DEEP = 4;

/** نسخة افتراضية للحزم قبل تعبئة tracks/paths كاملة (Wave 1A). */
export const DEFAULT_PACK_VERSION = '1.0.0';
/** نسخة Wave 1A — tracks + paths + حزم مرجعية كاملة. */
export const WAVE_1A_PACK_VERSION = '1.1.0';
/** نسخة Wave 1B — حزم هندسية موسّعة. */
export { WAVE_1B_PACK_VERSION } from './wave1bDomainPacks.js';
export { WAVE_2_PACK_VERSION } from './wave2DomainPacks.js';
export { WAVE_3_ENRICHED_VERSION, L3_ENRICHED_PACK_KEYS } from './wave3EnrichedHelpers.js';
import { WAVE_1B_PACKS } from './wave1bDomainPacks.js';
import { WAVE_2_PACKS } from './wave2DomainPacks.js';
import { WAVE_4_PACKS } from './wave4DomainPacks.js';
import {
    ACADEMIC_TRACKS,
    FIELD_TRACKS,
    WAVE_3_ENRICHED_VERSION,
    accountingTracks,
    backendTracks,
    enrichedPath,
    ogProductionTracks,
} from './wave3EnrichedHelpers.js';

/** حزمة خبرة مجال عميقة. */
export interface DomainPack {
    /** مفتاح الحزمة (snake_case) — مثل oil_gas_production. */
    packKey: string;
    /** Evaalo Job Catalog roleKey — one Deep Pack per roleKey. */
    roleKey: string;
    /** المجال (يطابق domainTaxonomy.domain عند الإمكان). */
    domain: string;
    /** التخصص الدقيق الذي تغطيه الحزمة. */
    specialization: string;
    /**
     * مسميات الدور المطابِقة مباشرةً (Backend Developer, Node.js Developer, ...).
     * مطابقة alias كاملة = إشارة قوية حاسمة لاختيار الحزمة.
     */
    roleAliases?: string[];
    /**
     * كلمات تُقصي الحزمة عند ورودها (تمنع ابتلاع تخصصات مجاورة).
     * مثال: general_accountant يُقصى عند "accounts payable" / "cost accountant".
     */
    excludeKeywords?: string[];
    /** كلمات مفتاحية مساعدة فقط — لا تُفعّل الحزمة منفردةً (تتطلب عدة كلمات معاً). */
    matchKeywords: string[];
    /**
     * مصطلحات المجال — تجعل الوكيل يتكلم بلغة الاختصاص. تُقصّ إلى عدد مناسب
     * (10-20) قبل تمريرها للوكيل عبر domain_guidance/expertise_prompt.
     */
    terminology?: string[];
    /**
     * نسخة مختصرة من معرفة المجال تُمرَّر للوكيل عبر metadata (domain_guidance).
     * يجب أن تكون مكتفية ذاتياً: الوكيل في مشروع منفصل لا يقرأ هذا الملف.
     */
    domainGuidance: string;
    /** الكفاءات القابلة للقياس في هذا التخصص. */
    competencies: PackCompetency[];
    /** أسئلة أساسية مقترحة (anchor) — نقطة انطلاق للتوليد قبل التخصيص. */
    suggestedAnchorQuestions: string[];
    /** semver للحزمة — يُنسخ إلى Blueprint/session. */
    packVersion?: string;
    /** مسارات خبرة المرشّح (Wave 1A+). */
    supportedExperienceTracks?: ExperienceTrackSpec[];
    /** ترتيب مواضيع المقابلة (Wave 1A+). */
    interviewPaths?: InterviewPath[];
}

// ──────────────────────────────────────────────────────────────────────────
// حزمة: مهندس إنتاج نفطي (Oil & Gas — Production Engineering)
// L3 Enriched — Production Engineer in O&G field ops only; NOT general Petroleum Engineer.
// ──────────────────────────────────────────────────────────────────────────
const OIL_GAS_PRODUCTION: DomainPack = {
    packKey: 'oil_gas_production',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'production_engineer_oil_gas',
    domain: 'engineering',
    specialization: 'Production Engineering (Oil & Gas)',
    roleAliases: [
        'production engineer', 'production engineering', 'petroleum production engineer',
        'oil and gas production engineer', 'reservoir/production engineer',
        'مهندس إنتاج', 'مهندس إنتاج نفطي',
    ],
    excludeKeywords: [
        'drilling engineer', 'reservoir engineer', 'reservoir engineer only', 'hse officer',
        'process engineer', 'petroleum engineer', 'petroleum engineering', 'مهندس بترول',
        'مهندس نفط', 'survey engineer', 'civil engineer', 'site engineer',
        'manufacturing plant', 'lean manufacturing', 'assembly line', 'factory floor',
        'cnc machining', 'oee', 'production line', 'cement plant', 'cement', 'fmcg',
        'food manufacturing', 'food production',
    ],
    matchKeywords: [
        'production engineer', 'oil', 'gas', 'petroleum', 'oilfield', 'well',
        'artificial lift', 'reservoir', 'water cut', 'gor', 'well testing',
        'إنتاج', 'نفط', 'غاز', 'بئر', 'آبار', 'مكمن', 'رفع اصطناعي',
    ],
    terminology: [
        'bottomhole pressure', 'wellhead pressure', 'water cut', 'GOR', 'artificial lift',
        'ESP', 'gas lift', 'rod pump', 'nodal analysis', 'well testing', 'productivity index',
        'decline curve', 'production optimization', 'HSE', 'permit to work',
    ],
    domainGuidance: [
        'Domain: Oil & Gas — Production Engineering.',
        'A strong candidate reasons with real well/field data, not generalities.',
        'Key concepts to probe naturally: well performance diagnosis, declining production,',
        'bottomhole/wellhead pressure, Water Cut, GOR (Gas-Oil Ratio), Artificial Lift (ESP, gas lift,',
        'rod pump), production optimization, well testing, nodal analysis, and operational safety (HSE).',
        'Distinguish reservoir-related issues from artificial-lift or surface/flowline issues.',
        'Expect: specific data reviewed, how root cause was identified, the action taken, and the result.',
        'Weak answers stay vague ("I have experience optimizing production") with no data or method.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'production_well_diagnosis',
            title: 'Well Performance Diagnosis',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على تحليل انخفاض إنتاج بئر وتحديد السبب الجذري بالبيانات.',
            expectedEvidence: [
                'مراجعة ضغط البئر (bottomhole/wellhead)',
                'تحليل Water Cut و GOR',
                'مراجعة سجل الإنتاج (production history)',
                'التمييز بين مشكلة المكمن والرفع الاصطناعي وخط الإنتاج',
                'اقتراح إجراء عملي ومتابعة نتيجته',
            ],
            redFlags: [
                'إجابات عامة بلا بيانات',
                'عدم التمييز بين مشاكل المكمن والإنتاج',
                'اقتراحات بلا قياس أو متابعة',
            ],
            scoreRubric: {
                '1': 'إجابة عامة جداً، لا بيانات ولا منهجية.',
                '2': 'يذكر مفاهيم عامة دون ربطها ببيانات فعلية أو حالة حقيقية.',
                '3': 'يصف منهجية معقولة مع بعض البيانات لكن دون تمييز دقيق للسبب.',
                '4': 'منهجية واضحة ببيانات، يميّز مصادر المشكلة ويقترح إجراءً.',
                '5': 'حالة حقيقية كاملة: بيانات، تشخيص دقيق، إجراء، ونتيجة قابلة للقياس.',
            },
            followUpRules: [
                'إذا ذكر مراجعة الضغط/Water Cut/GOR، اسأل كيف فرّق بين مشكلة المكمن والرفع الاصطناعي وخط الإنتاج.',
                'إذا بقي عاماً، اطلب حالة محددة بأرقام ومؤشرات راجعها فعلاً.',
            ],
        },
        {
            competencyKey: 'artificial_lift',
            title: 'Artificial Lift',
            priority: 'high',
            questionObjective:
                'قياس فهم المرشح لأنظمة الرفع الاصطناعي واختيارها وتشخيص أعطالها.',
            expectedEvidence: [
                'معرفة ESP / Gas Lift / Rod Pump ومتى يُستخدم كلٌّ منها',
                'تشخيص أعطال نظام الرفع',
                'ربط اختيار النظام بخصائص البئر والمكمن',
            ],
            redFlags: [
                'خلط بين أنظمة الرفع',
                'لا يربط الاختيار بظروف البئر',
            ],
            scoreRubric: {
                '1': 'لا يعرف أنظمة الرفع الأساسية.',
                '2': 'يذكر الأسماء فقط دون فهم الاستخدام.',
                '3': 'يفهم الفروق العامة بين الأنظمة.',
                '4': 'يربط الاختيار بظروف البئر ويشخّص أعطالاً شائعة.',
                '5': 'خبرة عملية بتشغيل/تحسين نظام رفع مع نتائج ملموسة.',
            },
            followUpRules: [
                'اسأل عن حالة اختار فيها أو حسّن نظام رفع ولماذا.',
            ],
        },
        {
            competencyKey: 'production_optimization',
            title: 'Production Optimization & Well Testing',
            priority: 'high',
            questionObjective:
                'قياس قدرة المرشح على تحسين الإنتاج باستخدام اختبارات الآبار والتحليل.',
            expectedEvidence: [
                'استخدام Well Testing و Nodal Analysis',
                'مؤشرات قبل/بعد التحسين',
                'موازنة المخاطر التشغيلية مع المكاسب',
            ],
            redFlags: [
                'تحسين بلا قياس أو بيانات',
                'تجاهل المخاطر التشغيلية',
            ],
            scoreRubric: {
                '1': 'لا منهجية للتحسين.',
                '2': 'أفكار عامة دون قياس.',
                '3': 'يستخدم بعض الاختبارات/التحليل.',
                '4': 'تحسين مبني على بيانات بمؤشرات قبل/بعد.',
                '5': 'حالة تحسين كاملة بنتائج قابلة للقياس وإدارة مخاطر.',
            },
            followUpRules: [
                'اطلب مؤشرات الإنتاج قبل وبعد، وكيف تحقّق من أن التحسين سببه إجراؤه.',
            ],
        },
        {
            competencyKey: 'operational_safety_hse',
            title: 'Operational Safety (HSE)',
            priority: 'high',
            questionObjective: 'قياس وعي المرشح بالسلامة والإجراءات التشغيلية في الحقل.',
            expectedEvidence: [
                'الالتزام بإجراءات السلامة وتصاريح العمل',
                'إدارة المخاطر أثناء عمليات البئر',
                'التنسيق مع فرق العمليات',
            ],
            redFlags: [
                'الاستهانة بالسلامة',
                'لا يذكر إجراءات أو تصاريح',
            ],
            scoreRubric: {
                '1': 'لا وعي بالسلامة.',
                '2': 'وعي سطحي.',
                '3': 'يعرف الإجراءات الأساسية.',
                '4': 'يطبّق إدارة مخاطر فعلية في عمله.',
                '5': 'يقود ثقافة سلامة بأمثلة ملموسة.',
            },
            followUpRules: [
                'اسأل عن موقف وازن فيه بين ضغط الإنتاج ومتطلبات السلامة.',
            ],
        },
        {
            competencyKey: 'surface_facilities',
            title: 'Surface Facilities & Flowlines',
            priority: 'high',
            questionObjective: 'قياس فهم مرافق السطح وخطوط الإنتاج وتأثيرها على أداء البئر.',
            expectedEvidence: [
                'separator', 'flowline', 'choke', 'pressure drop',
                'التمييز بين مشكلة سطح وبئر',
            ],
            redFlags: ['يخلط السطح بالمكمن', 'لا يذكر ضغط أو تدفق'],
            scoreRubric: {
                '1': 'لا يميّز بين مشاكل السطح والبئر.',
                '2': 'يذكر معدات سطحية بلا تشخيص.',
                '3': 'يفهم دور المرافق السطحية بشكل عام.',
                '4': 'يشخّص مشكلة سطح/خط ببيانات ضغط وتدفق.',
                '5': 'حالة كاملة: تشخيص سطح، إجراء، ونتيجة على الإنتاج.',
            },
            followUpRules: ['اسأل كيف فرّقت بين choke/flowline و downhole.'],
        },
        {
            competencyKey: 'integrated_production_review',
            title: 'Integrated Production Review',
            priority: 'medium',
            questionObjective: 'قياس مراجعة الإنتاج المتكاملة (بئر + رفع + سطح) بقرار تشغيلي.',
            expectedEvidence: [
                'daily production report', 'trend analysis', 'action plan',
                'تنسيق مع العمليات',
            ],
            redFlags: ['مراجعة جزئية', 'لا خطة متابعة'],
            scoreRubric: {
                '1': 'لا منهجية مراجعة.',
                '2': 'يراجع مؤشراً واحداً فقط.',
                '3': 'يراجع عدة مؤشرات بشكل منفصل.',
                '4': 'مراجعة متكاملة بقرار واضح.',
                '5': 'مراجعة يومية/دورية أثرت على قرار تشغيلي قابل للقياس.',
            },
            followUpRules: ['اطلب مثال تقرير إنتاج راجعته وقرار اتخذته.'],
        },
    ],
    suggestedAnchorQuestions: [
        'اذكر حالة انخفض فيها إنتاج أحد الآبار بشكل ملحوظ — كيف حددت السبب، ما البيانات التي راجعتها، وما الإجراء الذي اقترحته أو نفذته؟',
        'في دور Production Engineer، ما المؤشرات التي تراجعها أولاً عند انخفاض معدل الإنتاج، وكيف تحدد إن كانت المشكلة من البئر أو نظام الرفع أو خط الإنتاج؟',
        'حدثني عن تجربة استخدمت فيها Well Testing أو Nodal Analysis لتحسين إنتاج بئر، وما النتيجة التي حققتها؟',
    ],
    supportedExperienceTracks: ogProductionTracks(),
    interviewPaths: [
        enrichedPath('production_field_ops', FIELD_TRACKS, [
            { stepKey: 'context', topicLabel: 'Context', sampleQuestion: 'شنو نوع الحقل أو الآبار اللي اشتغلت عليها؟' },
            { stepKey: 'diagnosis', competencyKey: 'production_well_diagnosis', topicLabel: 'Diagnosis', sampleQuestion: 'اذكرلي انخفاض إنتاج — شنو البيانات اللي راجعتها؟' },
            { stepKey: 'lift', competencyKey: 'artificial_lift', topicLabel: 'Lift', sampleQuestion: 'شلون فرّقت بين مشكلة الرفع والمكمن؟' },
            { stepKey: 'surface', competencyKey: 'surface_facilities', topicLabel: 'Surface', sampleQuestion: 'هل راجعت choke أو flowline أو separator؟' },
            { stepKey: 'optimize', competencyKey: 'production_optimization', topicLabel: 'Optimize', sampleQuestion: 'شنو الإجراء اللي اقترحته وشنو النتيجة؟' },
            { stepKey: 'hse', competencyKey: 'operational_safety_hse', topicLabel: 'HSE', sampleQuestion: 'شلون ضمنت السلامة أثناء الإجراء؟' },
            { stepKey: 'review', competencyKey: 'integrated_production_review', topicLabel: 'Review', sampleQuestion: 'شلون تتابع الإنتاج بعد التعديل؟' },
        ]),
        enrichedPath('production_academic', ACADEMIC_TRACKS, [
            { stepKey: 'project', competencyKey: 'production_optimization', topicLabel: 'Project', sampleQuestion: 'اذكرلي مشروع أو محاكاة إنتاج — شنو الهدف؟' },
            { stepKey: 'data', topicLabel: 'Data', sampleQuestion: 'شنو البيانات أو المدخلات اللي استخدمتها؟' },
            { stepKey: 'method', competencyKey: 'production_well_diagnosis', topicLabel: 'Method', sampleQuestion: 'شلون حللت المشكلة نظرياً؟' },
            { stepKey: 'lift_theory', competencyKey: 'artificial_lift', topicLabel: 'Lift theory', sampleQuestion: 'شنو نوع الرفع اللي درسته ولماذا؟' },
            { stepKey: 'learning', topicLabel: 'Learning', sampleQuestion: 'شنو أهم تعلم من المشروع؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: أخصائي توظيف / موارد بشرية (HR — Recruitment / Talent Acquisition)
// ──────────────────────────────────────────────────────────────────────────
const HR_RECRUITER: DomainPack = {
    packKey: 'hr_recruiter',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'recruiter',
    domain: 'business',
    specialization: 'Recruitment / Talent Acquisition',
    roleAliases: [
        'recruiter', 'recruitment specialist', 'talent acquisition specialist',
        'talent acquisition', 'technical recruiter', 'hr recruiter', 'sourcing specialist',
        'أخصائي توظيف', 'مسؤول توظيف', 'اخصائي استقطاب',
    ],
    excludeKeywords: [
        'payroll', 'compensation and benefits', 'hr generalist', 'hr manager',
        'كشوف رواتب', 'رواتب',
    ],
    matchKeywords: [
        'recruiter', 'recruitment', 'talent acquisition', 'sourcing', 'hiring',
        'ats', 'hris', 'hrbp', 'candidate pipeline',
        'توظيف', 'استقطاب', 'مرشحين',
    ],
    terminology: [
        'intake meeting', 'sourcing', 'candidate pipeline', 'ATS', 'HRIS',
        'time to fill', 'offer acceptance rate', 'source effectiveness', 'boolean search',
        'structured interview', 'candidate experience', 'screening', 'talent pool',
    ],
    domainGuidance: [
        'Domain: Human Resources — Recruitment / Talent Acquisition.',
        'A strong candidate describes a structured hiring process driven by data, not gut feeling.',
        'Key areas to probe: intake/role alignment with the hiring manager, sourcing strategy and channels,',
        'candidate pipeline management, structured interviewing and evaluation, candidate experience,',
        'and recruiting metrics (Time to Fill, Offer Acceptance, source effectiveness). Tools: ATS, HRIS, LinkedIn.',
        'Expect across separate interview turns (never one compound question): a hard-to-fill role example,',
        'how requirements were gathered from the hiring manager, sourcing channels used,',
        'and what they changed when initial sourcing failed.',
        'Weak answers stay generic ("I have recruiting experience") with no process, channels, or metrics.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'role_intake_alignment',
            title: 'Role Intake & Manager Alignment',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على استخراج متطلبات الدور الحقيقية من المدير المسؤول.',
            expectedEvidence: [
                'جلسة intake منظمة مع المدير',
                'التمييز بين المتطلبات الضرورية والمفضّلة',
                'تحديد المهارات غير القابلة للتنازل',
            ],
            redFlags: [
                'يأخذ الوصف الوظيفي كما هو دون نقاش',
                'لا يميّز الضروري عن المفضّل',
            ],
            scoreRubric: {
                '1': 'لا يتفاعل مع المدير لتحديد المتطلبات.',
                '2': 'يأخذ المتطلبات حرفياً دون تحليل.',
                '3': 'يناقش المتطلبات بشكل عام.',
                '4': 'يميّز الضروري عن المفضّل ويوائم التوقعات.',
                '5': 'يدير intake احترافياً ويعيد ضبط متطلبات غير واقعية بالبيانات.',
            },
            followUpRules: [
                'شلون فرّقت بين المتطلبات الضرورية والمفضّلة بهالدور؟',
            ],
        },
        {
            competencyKey: 'sourcing_strategy',
            title: 'Sourcing Strategy & Channels',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على بناء خطة بحث متعددة القنوات وتعديلها عند الفشل.',
            expectedEvidence: [
                'قنوات بحث متنوعة (LinkedIn, referrals, ATS, مجتمعات)',
                'تعديل الخطة عند نقص المرشحين',
                'تشخيص: السوق أم المتطلبات أم العرض المالي',
            ],
            redFlags: [
                'الاعتماد على قناة واحدة فقط',
                'لا يشخّص سبب نقص المرشحين',
            ],
            scoreRubric: {
                '1': 'لا خطة بحث.',
                '2': 'قناة واحدة دون تكيّف.',
                '3': 'عدة قنوات لكن دون تشخيص.',
                '4': 'خطة متعددة القنوات مع تعديل مبني على نتائج.',
                '5': 'استراتيجية بحث متقدمة بتشخيص دقيق (سوق/متطلبات/عرض) ونتائج.',
            },
            followUpRules: [
                'شنو القناة اللي نجحت أكثر بجذب المرشحين بهالمثال؟',
            ],
        },
        {
            competencyKey: 'structured_evaluation',
            title: 'Structured Interviewing & Evaluation',
            priority: 'high',
            questionObjective: 'قياس اعتماد المرشح على تقييم منظم مبني على الأدلة.',
            expectedEvidence: [
                'مقابلات منظمة ومعايير واضحة',
                'تقييم مبني على الأدلة لا الانطباع',
                'تقليل التحيّز',
            ],
            redFlags: [
                'تقييم انطباعي',
                'لا معايير موحّدة',
            ],
            scoreRubric: {
                '1': 'تقييم عشوائي.',
                '2': 'انطباعي غالباً.',
                '3': 'بعض الهيكلة.',
                '4': 'مقابلات منظمة بمعايير.',
                '5': 'نظام تقييم متّسق يقلّل التحيّز بأدلة.',
            },
            followUpRules: [
                'شلون تتأكد إن التقييم عادل بين المرشحين؟',
            ],
        },
        {
            competencyKey: 'recruiting_metrics',
            title: 'Recruiting Metrics & Pipeline',
            priority: 'high',
            questionObjective: 'قياس استخدام المرشح للمؤشرات لإدارة خط المرشحين.',
            expectedEvidence: [
                'Time to Fill, Offer Acceptance, source effectiveness',
                'إدارة pipeline المرشحين',
                'قرارات مبنية على البيانات',
            ],
            redFlags: [
                'لا يتابع أي مؤشرات',
                'لا يدير pipeline',
            ],
            scoreRubric: {
                '1': 'لا مؤشرات.',
                '2': 'يعرف الأسماء فقط.',
                '3': 'يتابع بعض المؤشرات.',
                '4': 'يستخدم المؤشرات لتحسين العملية.',
                '5': 'يقود قرارات التوظيف بالبيانات بنتائج ملموسة.',
            },
            followUpRules: [
                'شنو مؤشر واحد غيّر قرارك بعملية التوظيف؟',
            ],
        },
        {
            competencyKey: 'candidate_experience',
            title: 'Candidate Experience',
            priority: 'high',
            questionObjective: 'قياس اهتمام المرشح بتجربة المرشّح خلال عملية التوظيف.',
            expectedEvidence: [
                'تواصل واضح مع المرشحين',
                'إدارة توقعات المرشح والمدير',
                'متابعة بعد الرفض أو القبول',
            ],
            redFlags: [
                'ghosting للمرشحين',
                'لا متابعة بعد المقابلة',
            ],
            scoreRubric: {
                '1': 'لا اهتمام بتجربة المرشح.',
                '2': 'تواصل ضعيف.',
                '3': 'تواصل مقبول.',
                '4': 'تجربة مرشح منظمة.',
                '5': 'تجربة متميزة بنتائج (قبول/إحالة/سمعة).',
            },
            followUpRules: [
                'شلون تتعامل وية مرشح ممتاز رُفض بسبب العرض المالي؟',
            ],
        },
        {
            competencyKey: 'hard_to_fill_roles',
            title: 'Hard-to-Fill Roles',
            priority: 'medium',
            questionObjective: 'قياس تعامل المرشح مع الأدوار الصعبة أو نادرة المرشحين.',
            expectedEvidence: [
                'إعادة تعريف المتطلبات أو السوق',
                'توسيع القنوات أو العرض',
                'تنسيق مع المدير لتعديل التوقعات',
            ],
            redFlags: [
                'يستسلم بسرعة',
                'لا يغيّر الاستراتيجية',
            ],
            scoreRubric: {
                '1': 'لا خطة للأدوار الصعبة.',
                '2': 'محاولات عشوائية.',
                '3': 'بعض التكيّف.',
                '4': 'استراتيجية واضحة متعددة الخطوات.',
                '5': 'ملء دور صعب بنتيجة قابلة للقياس.',
            },
            followUpRules: [
                'شنو غيّرت بالمتطلبات أو القنوات لما فشل البحث الأول؟',
            ],
        },
    ],
    suggestedAnchorQuestions: [
        'اذكرلي دور واجهت صعوبة بتوظيفه، شنو كان أصعب تحدي بيه؟',
        'شلون تاخذ متطلبات الدور من المدير قبل ما تبدي البحث؟',
        'شنو قنوات الاستقطاب اللي تعتمد عليها أكثر شي؟',
    ],
    supportedExperienceTracks: [
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'fresh graduate', 'first recruiting'],
            acceptableEvidence: ['تدريب HR', 'مشاريع جامعية', 'تطوع'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي أول مهمة سويتها بالتوظيف أو الHR — شنو تعلمت منها؟',
                'شنو أصعب موقف واجهته وأنت لسه مبتدئ بالاستقطاب؟',
            ],
            followUpHints: ['اطلب خطوة بخطوة', 'اسأل شنو ساعدك تتعلم'],
        },
        {
            trackKey: 'academic_only',
            detectSignals: ['جامعة', 'تخرج', 'اكاديمي', 'بدون خبرة عملية', 'university', 'hr degree only'],
            acceptableEvidence: ['مشاريع جامعية', 'معرفة نظرية ATS', 'تدريب قصير'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي مشروع أو دراسة حالة درستها بالجامعة عن التوظيف أو الاستقطاب؟',
                'شنو تعلمت نظرياً عن pipeline المرشحين قبل أول خبرة عملية؟',
            ],
            followUpHints: ['اربط النظرية بسيناريو افتراضي واقعي'],
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'trainee', 'co-op'],
            acceptableEvidence: ['مهام محددة بالتدريب', 'ملاحظات من المشرف'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي شنو سويت بفترة التدريب بالتوظيف — شنو كان دورك؟',
                'شنو أهم أداة أو عملية تعرّفت عليها بالتدريب؟',
            ],
            followUpHints: ['اسأل عن دور الفريق والإشراف'],
        },
        {
            trackKey: 'experienced',
            detectSignals: ['اشتغلت', 'سنوات', 'pipeline', 'filled roles', 'time to fill', 'linkedin'],
            acceptableEvidence: ['أدوار ملّيتها', 'قنوات متعددة', 'مؤشرات'],
            questionDifficulty: 2,
            openingAnchors: [
                'اذكرلي دور صعب ملّيته — شنو القنوات اللي نجحت وشنو المؤشرات اللي تابعتها؟',
                'شلون بنيت خطة استقطاب لدور تقني أو متخصص؟',
            ],
            followUpHints: ['اسأل عن تعديل الخطة عند الفشل'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'manager', 'strategy', 'قاد', 'كبير', 'استراتيجية'],
            acceptableEvidence: ['قيادة فريق توظيف', 'تحسين عملية', 'تعاون مع الإدارة'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي قرار استراتيجي غيّرت بيه عملية التوظيف بالشركة؟',
                'شلون توازن بين سرعة التوظيف وجودة المرشح وتجربتهم؟',
            ],
            followUpHints: ['اسأل عن مقاييس قبل/بعد'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'switched from', 'من مجال'],
            acceptableEvidence: ['مهارات قابلة للنقل', 'تعلم سريع', 'نتائج مبكرة'],
            questionDifficulty: 2,
            openingAnchors: [
                'ليش انتقلت للتوظيف وشنو نقلته من مجالك السابق؟',
                'شنو أصعب فرق لاحظته بين شغلك السابق والاستقطاب؟',
            ],
            followUpHints: ['اربط بمثال نجاح مبكر'],
        },
    ],
    interviewPaths: [
        enrichedPath('recruiter_default', [...ACADEMIC_TRACKS, ...FIELD_TRACKS], [
            { stepKey: 'background', topicLabel: 'Background', sampleQuestion: 'شنو نوع الأدوار اللي ركّزت عليها أكثر بالتوظيف؟' },
            { stepKey: 'sourcing_channels', competencyKey: 'sourcing_strategy', topicLabel: 'Sourcing channels', sampleQuestion: 'شنو قنوات الاستقطاب اللي استخدمتها بآخر دور صعب؟' },
            { stepKey: 'channel_quality', competencyKey: 'sourcing_strategy', topicLabel: 'Channel quality', sampleQuestion: 'شلون قيّمت جودة المرشحين من كل قناة؟' },
            { stepKey: 'screening', competencyKey: 'structured_evaluation', topicLabel: 'Screening', sampleQuestion: 'شلون تفرّق بين مرشح قوي ومرشح يبدو جيد بس ضعيف بالتقييم؟' },
            { stepKey: 'manager_alignment', competencyKey: 'role_intake_alignment', topicLabel: 'Hiring manager alignment', sampleQuestion: 'شلون تتفق وية المدير على المتطلبات الضرورية مقابل المفضّلة؟' },
            { stepKey: 'difficult_role', competencyKey: 'hard_to_fill_roles', topicLabel: 'Difficult role', sampleQuestion: 'اذكرلي دور ما لقيت له مرشح بسرعة — شنو سويت؟' },
            { stepKey: 'candidate_experience', competencyKey: 'candidate_experience', topicLabel: 'Candidate experience', sampleQuestion: 'شلون تحافظ على تجربة مرشح جيد حتى لو ما نجح بالعرض؟' },
            { stepKey: 'metrics', competencyKey: 'recruiting_metrics', topicLabel: 'Metrics', sampleQuestion: 'شنو مؤشر واحد تتابعه دايماً بخط المرشحين؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: مهندس بترول (Wave 1A — Petroleum Engineering)
// ──────────────────────────────────────────────────────────────────────────
const PETROLEUM_ENGINEER: DomainPack = {
    packKey: 'petroleum_engineer',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'petroleum_engineer',
    domain: 'engineering',
    specialization: 'Petroleum Engineering',
    roleAliases: [
        'petroleum engineer', 'petroleum engineering', 'petroleum eng',
        'مهندس بترول', 'هندسة بترول', 'مهندس نفط',
    ],
    excludeKeywords: [
        'survey engineer', 'quantity surveyor', 'civil engineer', 'structural engineer',
        'reservoir engineer', 'drilling engineer', 'site engineer', 'process engineer',
        'manufacturing', 'production line', 'recruiter', 'مساح', 'مدني',
        'مهندس حفر', 'مهندس مكامن', 'مهندس موقع',
    ],
    matchKeywords: [
        'petroleum', 'reservoir', 'drilling', 'well', 'oil', 'gas', 'oilfield',
        'water cut', 'gor', 'well testing', 'nodal', 'cmg', 'eclipse', 'petrel',
        'بترول', 'نفط', 'مكمن', 'حفر', 'بئر', 'آبار',
    ],
    terminology: [
        'reservoir simulation', 'CMG', 'Eclipse', 'Petrel', 'well testing', 'nodal analysis',
        'water cut', 'GOR', 'bottomhole pressure', 'wellhead pressure', 'productivity index',
        'decline curve', 'artificial lift', 'ESP', 'gas lift', 'HSE', 'permit to work',
        'PVT', 'material balance', 'history matching',
    ],
    domainGuidance: [
        'Domain: Petroleum Engineering (reservoir, drilling awareness, production, field operations).',
        'Adapt difficulty to the candidate track: academic-only candidates should be probed on concepts,',
        'simulations, graduation projects, and theoretical data — NOT assumed field well experience.',
        'Field-experienced candidates should give real well/field examples with data reviewed and outcomes.',
        'Key concepts: reservoir behavior, well performance, Water Cut, GOR, well testing, artificial lift, HSE.',
        'Weak answers stay generic with no method, data, or measurable result.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'reservoir_fundamentals',
            title: 'Reservoir & Well Fundamentals',
            priority: 'critical',
            questionObjective: 'قياس فهم المرشح لسلوك المكمن والبئر بمفاهيم أو بيانات.',
            expectedEvidence: ['ضغط', 'تشبع', 'PVT أو history matching', 'ربط بالإنتاج'],
            redFlags: ['مفاهيم عامة بلا تطبيق', 'خلط بين المكمن والسطح'],
            scoreRubric: {
                '1': 'لا فهم أساسي.',
                '2': 'مصطلحات فقط.',
                '3': 'فهم معقول.',
                '4': 'ربط ببيانات أو محاكاة.',
                '5': 'تحليل عميق بحالة كاملة.',
            },
            followUpRules: ['اسأل كيف تأثرت النتائج على قرار الإنتاج أو التصميم.'],
        },
        {
            competencyKey: 'field_data_analysis',
            title: 'Field Data Analysis',
            priority: 'critical',
            questionObjective: 'قياس قدرة المرشح على قراءة بيانات الحقل واتخاذ قرار.',
            expectedEvidence: ['Water Cut', 'GOR', 'ضغط', 'سجل إنتاج', 'خطوات التحليل'],
            redFlags: ['لا بيانات', 'قرار بدون تحليل'],
            scoreRubric: {
                '1': 'لا بيانات.',
                '2': 'بيانات عامة.',
                '3': 'بعض التحليل.',
                '4': 'تحليل واضح بخطوات.',
                '5': 'قرار ميداني بنتيجة قابلة للقياس.',
            },
            followUpRules: ['اطلب الأرقام أو المؤشرات التي راجعها فعلاً.'],
        },
        {
            competencyKey: 'simulation_and_tools',
            title: 'Simulation & Engineering Tools',
            priority: 'high',
            questionObjective: 'قياس استخدام أدوات المحاكاة أو البرامج الهندسية.',
            expectedEvidence: ['CMG/Eclipse/Petrel', 'مدخلات النموذج', 'نتائج المحاكاة', 'التحقق'],
            redFlags: ['أسماء برامج بلا فهم', 'لا تحقق من النتائج'],
            scoreRubric: {
                '1': 'لا أدوات.',
                '2': 'يعرف الأسماء.',
                '3': 'استخدام أساسي.',
                '4': 'محاكاة بمدخلات ونتائج.',
                '5': 'محاكاة متقدمة مربوطة بقرار.',
            },
            followUpRules: ['اسأل شنو افتراضات النموذج وكيف تحققت منها.'],
        },
        {
            competencyKey: 'production_operations',
            title: 'Production Operations Awareness',
            priority: 'high',
            questionObjective: 'قياس وعي المرشح بعمليات الإنتاج والرفع الاصطناعي.',
            expectedEvidence: ['ESP/gas lift', 'تحسين إنتاج', 'تنسيق مع العمليات'],
            redFlags: ['لا يميّز أنظمة الرفع', 'لا يذكر السلامة'],
            scoreRubric: {
                '1': 'لا وعي إنتاجي.',
                '2': 'مفاهيم سطحية.',
                '3': 'فهم عام.',
                '4': 'تجربة أو تحليل واضح.',
                '5': 'تحسين إنتاج بنتائج.',
            },
            followUpRules: ['اسأل عن مؤشر قبل/بعد التدخل.'],
        },
        {
            competencyKey: 'hse_field_safety',
            title: 'HSE & Field Safety',
            priority: 'high',
            questionObjective: 'قياس الالتزام بالسلامة والتصاريح في بيئة نفطية.',
            expectedEvidence: ['permit to work', 'تقييم مخاطر', 'إجراءات حرجة'],
            redFlags: ['تجاهل HSE', 'لا إجراءات'],
            scoreRubric: {
                '1': 'لا وعي.',
                '2': 'وعي نظري.',
                '3': 'يعرف الإجراءات.',
                '4': 'يطبّق بأمثلة.',
                '5': 'ثقافة سلامة بأدلة.',
            },
            followUpRules: ['اسأل عن موقف وازن بين الإنتاج والسلامة.'],
        },
        {
            competencyKey: 'technical_communication',
            title: 'Technical Communication',
            priority: 'medium',
            questionObjective: 'قياس قدرة المرشح على شرح نتائج تقنية للإدارة أو الفريق.',
            expectedEvidence: ['تقارير', 'عروض', 'توصيات واضحة'],
            redFlags: ['تعقيد بلا رسالة', 'لا توصية'],
            scoreRubric: {
                '1': 'لا تواصل.',
                '2': 'غامض.',
                '3': 'مقبول.',
                '4': 'واضح ومنظم.',
                '5': 'تواصل مؤثر بقرار.',
            },
            followUpRules: ['اسأل كيف قنعت فريقاً بتوصية تقنية.'],
        },
    ],
    suggestedAnchorQuestions: [
        'شنو أهم مشروع بترولي اشتغلت عليه — أكاديمي أو ميداني — وشنو كان دورك؟',
        'شلون تقرأ بيانات بئر أو مكمن عشان تتخذ قرار — شنو المؤشرات اللي تبدي بيها؟',
        'اذكرلي موقف اضطررت تختار بين السلامة وضغط الإنتاج — شنو سويت؟',
    ],
    supportedExperienceTracks: [
        {
            trackKey: 'academic_only',
            detectSignals: [
                'جامعة', 'تخرج', 'مشروع تخرج', 'محاكاة', 'cmg', 'eclipse', 'petrel',
                'ما عندي خبرة ميدانية', 'نظري', 'thesis', 'graduation project',
            ],
            acceptableEvidence: ['مشروع تخرج', 'محاكاة مكمن', 'بيانات أكاديمية', 'PVT lab'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي مشروع تخرج أو محاكاة مكمن سويتها — شنو كان الهدف وشنو تعلمت؟',
                'شنو أصعب مفهوم بترولي درسته وطبّقته بمثال نظري أو محاكاة؟',
            ],
            followUpHints: ['لا تفترض خبرة حقل', 'اسأل عن مدخلات وافتراضات النموذج'],
            rubricAdjustments: 'اقبل أدلة أكاديمية ومحاكاة — لا تخصم غياب تجربة حقل.',
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'co-op', 'فترة تدريب'],
            acceptableEvidence: ['ملاحظات ميدان', 'مهام محددة', 'إشراف'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي شنو شفت وشنو تعلمت بفترة التدريب بنفط وغاز؟',
                'شنو أهم أداة أو إجراء تعرّفت عليه بالموقع وأنت متدرب؟',
            ],
            followUpHints: ['اسأل عن دور الفريق والإشراف'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'fresh graduate'],
            acceptableEvidence: ['أول مهمة', 'تعلم سريع', 'إشراف'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي أول مهمة بترولية بعد التخرج — شنو سويت وشنو ساعدك؟',
                'شلون تتأكد إن تحليلك صحيح وأنت لسه مبتدئ؟',
            ],
            followUpHints: ['اطلب خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: ['حقل', 'بئر', 'ميدان', 'اشتغلت', 'water cut', 'gor', 'well testing', 'field'],
            acceptableEvidence: ['بيانات حقيقية', 'إجراء ميداني', 'نتيجة قابلة للقياس'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي بئر أو حقل اشتغلت عليه — شنو كان التحدي وشنو البيانات اللي راجعتها؟',
                'شلون فرّقت بين مشكلة مكمن ومشكلة رفع اصطناعي بحالة حقيقية؟',
            ],
            followUpHints: ['اطلب أرقام ومؤشرات', 'اسأل عن النتيجة بعد الإجراء'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'manager', 'قاد', 'استراتيجية', 'تحسين إنتاج'],
            acceptableEvidence: ['قرار استراتيجي', 'قيادة فريق', 'تحسين قابل للقياس'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي قرار تشغيلي أو فني مهم قدته — شنو كان التأثير على الإنتاج أو الفريق؟',
                'شلون قدت تحسين إنتاج أو عملية بحقل أو مجموعة آبار؟',
            ],
            followUpHints: ['اسأل عن trade-offs ومخاطر'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'switched from', 'من مجال'],
            acceptableEvidence: ['مهارات قابلة للنقل', 'تعلم بترول', 'نتائج مبكرة'],
            questionDifficulty: 2,
            openingAnchors: [
                'ليش انتقلت لهندسة البترول وشنو نقلته من مجالك السابق؟',
                'شنو أصعب فرق لاحظته بين مجالك السابق والنفط والغاز؟',
            ],
            followUpHints: ['اربط بمثال تعلم سريع'],
        },
    ],
    interviewPaths: [
        enrichedPath('petroleum_experienced', FIELD_TRACKS, [
            { stepKey: 'experience_mode', topicLabel: 'Experience mode', sampleQuestion: 'خبرتك أكثر أكاديمية ولا ميدانية ولا الاثنين؟' },
            { stepKey: 'background', topicLabel: 'Background', sampleQuestion: 'شنو نوع المشاريع اللي اشتغلت عليها — حفر، إنتاج، محاكاة؟' },
            { stepKey: 'project_example', competencyKey: 'field_data_analysis', topicLabel: 'Project example', sampleQuestion: 'اذكرلي مثال محدد — شنو المشكلة وشنو البيانات اللي استخدمتها؟' },
            { stepKey: 'data_reviewed', competencyKey: 'field_data_analysis', topicLabel: 'Data reviewed', sampleQuestion: 'شنو المؤشرات أو التقارير اللي راجعتها قبل القرار؟' },
            { stepKey: 'problem', topicLabel: 'Problem', sampleQuestion: 'شنو كان أصعب جزء بالتحليل أو التشخيص؟' },
            { stepKey: 'analysis', competencyKey: 'reservoir_fundamentals', topicLabel: 'Analysis', sampleQuestion: 'شلون وصلت للسبب الجذري — شنو الخطوات؟' },
            { stepKey: 'action', competencyKey: 'production_operations', topicLabel: 'Action', sampleQuestion: 'شنو الإجراء اللي اقترحته أو نفذته؟' },
            { stepKey: 'result', topicLabel: 'Result', sampleQuestion: 'شنو النتيجة أو التعلم اللي طلع من هالحالة؟' },
        ]),
        enrichedPath('petroleum_academic_only', ACADEMIC_TRACKS, [
            { stepKey: 'experience_mode', topicLabel: 'Academic background', sampleQuestion: 'شنو تركيزك بالجامعة — مكمن، حفر، إنتاج؟' },
            { stepKey: 'graduation_project', competencyKey: 'simulation_and_tools', topicLabel: 'Graduation project', sampleQuestion: 'اذكرلي مشروع تخرجك — شنو النموذج أو الأداة اللي استخدمتها؟' },
            { stepKey: 'simulation_data', competencyKey: 'simulation_and_tools', topicLabel: 'Simulation data', sampleQuestion: 'شنو المدخلات والافتراضات اللي بنيت عليها المحاكاة؟' },
            { stepKey: 'findings', competencyKey: 'reservoir_fundamentals', topicLabel: 'Findings', sampleQuestion: 'شنو أهم نتيجة طلعت من المشروع أو المحاكاة؟' },
            { stepKey: 'learning', topicLabel: 'Learning', sampleQuestion: 'شنو التحدي الأكبر وشنو تعلمت منه؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: مهندس مساحة (Wave 1A — Survey Engineering)
// ──────────────────────────────────────────────────────────────────────────
const SURVEY_ENGINEER: DomainPack = {
    packKey: 'survey_engineer',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'survey_engineer',
    domain: 'engineering',
    specialization: 'Survey Engineering',
    roleAliases: [
        'survey engineer', 'survey engineering', 'land surveyor', 'geomatics engineer',
        'مهندس مساحة', 'مساح', 'هندسة مساحة',
    ],
    excludeKeywords: [
        'quantity surveyor', 'cost estimate', 'petroleum', 'reservoir', 'recruiter',
        'مسّاح كميات', 'حساب كميات',
    ],
    matchKeywords: [
        'survey', 'surveying', 'gnss', 'gps', 'total station', 'rtk', 'leveling',
        'topographic', 'coordinates', 'geomatics', 'theodolite',
        'مسح', 'مساحة', 'طبوغرافي', 'إحداثيات', 'ميزان', 'محطة شاملة',
    ],
    terminology: [
        'GPS', 'GNSS', 'RTK', 'Total Station', 'leveling', 'benchmark', 'control point',
        'coordinate system', 'UTM', 'geoid', 'datum', 'traversing', 'stakeout',
        'as-built survey', 'topographic survey', 'closure error', 'accuracy tolerance',
    ],
    domainGuidance: [
        'Domain: Survey Engineering — topographic and construction surveying.',
        'Probe real projects: instrument used (GPS/GNSS vs Total Station), control network,',
        'accuracy checks, error handling, and deliverables (coordinates, reports, CAD).',
        'Never attribute Total Station if the candidate said GPS only — honor corrections.',
        'Weak answers confuse tools, skip accuracy/closure checks, or stay generic.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'survey_project_setup',
            title: 'Survey Project Setup',
            priority: 'critical',
            questionObjective: 'قياس فهم المرشح لتخطيط مشروع مسح قبل الجمع الميداني.',
            expectedEvidence: ['نوع المشروع', 'نطاق العمل', 'معايير الدقة', 'تنسيق مع الجهات'],
            redFlags: ['يبدأ بدون تخطيط', 'لا معايير دقة'],
            scoreRubric: {
                '1': 'لا تخطيط.',
                '2': 'عام.',
                '3': 'تخطيط أساسي.',
                '4': 'خطة واضحة بمعايير.',
                '5': 'تخطيط محكم بأمثلة.',
            },
            followUpRules: ['اسأل شنو راجعت قبل النزول للموقع.'],
        },
        {
            competencyKey: 'instrument_selection',
            title: 'Instrument & Method Selection',
            priority: 'critical',
            questionObjective: 'قياس اختيار الأداة المناسبة (GPS/GNSS/Total Station/Level).',
            expectedEvidence: ['سبب الاختيار', 'ظروف الموقع', 'الدقة المطلوبة'],
            redFlags: ['أداة واحدة لكل شيء', 'خلط GPS وTotal Station'],
            scoreRubric: {
                '1': 'لا اختيار منطقي.',
                '2': 'اختيار عشوائي.',
                '3': 'اختيار معقول.',
                '4': 'مبرر تقني واضح.',
                '5': 'اختيار محسّن بحالة حقيقية.',
            },
            followUpRules: ['إذا ذكر GPS اسأل عن RTK أو base/rover.'],
        },
        {
            competencyKey: 'coordinate_control',
            title: 'Coordinate Systems & Control',
            priority: 'high',
            questionObjective: 'قياس التعامل مع نقاط التحكم والإحداثيات والمرجع.',
            expectedEvidence: ['control points', 'datum/UTM', 'ربط شبكة', 'تحويل إحداثيات'],
            redFlags: ['لا يذكر مرجع', 'أخطاء إحداثيات متكررة'],
            scoreRubric: {
                '1': 'لا فهم إحداثيات.',
                '2': 'أساسيات فقط.',
                '3': 'تطبيق مقبول.',
                '4': 'تحكم واضح بالشبكة.',
                '5': 'إدارة تحكم متقدمة.',
            },
            followUpRules: ['اسأل كيف تحققت من نقاط التحكم.'],
        },
        {
            competencyKey: 'accuracy_qc',
            title: 'Accuracy & Quality Control',
            priority: 'high',
            questionObjective: 'قياس فحوصات الدقة وإغلاق الأخطاء قبل التسليم.',
            expectedEvidence: ['closure error', 'تكرار قياس', 'tolerance', 'مراجعة QA'],
            redFlags: ['لا فحص دقة', 'تسليم بدون مراجعة'],
            scoreRubric: {
                '1': 'لا QC.',
                '2': 'فحص شكلي.',
                '3': 'بعض الفحوصات.',
                '4': 'QC منظم.',
                '5': 'QC صارم بنتائج.',
            },
            followUpRules: ['اطلب مثال خطأ اكتشفته قبل التسليم.'],
        },
        {
            competencyKey: 'field_problem_solving',
            title: 'Field Problem Solving',
            priority: 'high',
            questionObjective: 'قياس التعامل مع مشاكل ميدانية (إشارة، مناخ، وصول، أخطاء).',
            expectedEvidence: ['تشخيص', 'حل بديل', 'توثيق', 'سلامة'],
            redFlags: ['يتجاهل الخطأ', 'لا حل بديل'],
            scoreRubric: {
                '1': 'لا حل.',
                '2': 'حل ضعيف.',
                '3': 'حل مقبول.',
                '4': 'حل منهجي.',
                '5': 'حل ممتاز موثّق.',
            },
            followUpRules: ['اسأل شنو سويت لما فشل GPS أو ضعفت الإشارة.'],
        },
        {
            competencyKey: 'deliverable_reporting',
            title: 'Deliverables & Reporting',
            priority: 'medium',
            questionObjective: 'قياس جودة المخرجات (تقارير، CAD، handover).',
            expectedEvidence: ['تنسيق التسليم', 'metadata', 'مراجعة العميل'],
            redFlags: ['مخرجات ناقصة', 'لا توثيق'],
            scoreRubric: {
                '1': 'لا مخرجات واضحة.',
                '2': 'أساسي.',
                '3': 'مقبول.',
                '4': 'مخرجات منظمة.',
                '5': 'تسليم احترافي كامل.',
            },
            followUpRules: ['اسأل شنو يتأكد منه قبل التسليم النهائي.'],
        },
    ],
    suggestedAnchorQuestions: [
        'اذكرلي مشروع مسح أو رفع طبوغرافي — شنو كان نوعه وشنو دورك؟',
        'شنو الجهاز أو الطريقة اللي استخدمتها أكثر — GPS ولا Total Station ولا غيره؟',
        'شلون تتأكد من دقة الإحداثيات قبل ما تسلّم الملف؟',
    ],
    supportedExperienceTracks: [
        {
            trackKey: 'academic_only',
            detectSignals: ['جامعة', 'تخرج', 'مشروع تخرج', 'اكاديمي', 'بدون ميدان', 'thesis'],
            acceptableEvidence: ['مشاريع جامعية', 'معمل', 'تمارين إحداثيات'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي مشروع مساحة أو رفع طبوغرافي درستته بالجامعة — شنو تعلمت؟',
                'شنو أهم مفهوم إحداثيات أو دقة درسته نظرياً؟',
            ],
            followUpHints: ['لا تفترض معدات ميدانية بلا ذكر'],
            rubricAdjustments: 'اقبل مشروع تخرج وأدوات أكاديمية — لا تخصم غياب موقع بناء.',
        },
        {
            trackKey: 'trainee',
            detectSignals: ['تدريب', 'متدرب', 'internship', 'trainee'],
            acceptableEvidence: ['مهام ميدانية محدودة', 'إشراف'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي شنو سويت بفترة التدريب بمشروع مسح — شنو كان دورك؟',
                'شنو أول جهاز تعاملت ويةه بالميدان؟',
            ],
            followUpHints: ['اسأل عن الإشراف والسلامة'],
        },
        {
            trackKey: 'entry_level',
            detectSignals: ['خريج', 'حديث تخرج', 'أول وظيفة', 'fresh graduate'],
            acceptableEvidence: ['أول مشروع', 'تعلم أدوات'],
            questionDifficulty: 1,
            openingAnchors: [
                'اذكرلي أول مشروع مسح اشتغلت عليه — شنو الأداة وشنو التحدي؟',
                'شلون تطلب المساعدة لما تتردد بالدقة؟',
            ],
            followUpHints: ['اطلب خطوات محددة'],
        },
        {
            trackKey: 'experienced',
            detectSignals: ['gps', 'gnss', 'total station', 'rtk', 'ميدان', 'اشتغلت', 'مسح', 'field'],
            acceptableEvidence: ['مشروع حقيقي', 'دقة', 'تصحيح أخطاء'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي مشروع مسح صعب — شنو الأداة وشنو معيار الدقة اللي التزمت بيه؟',
                'شلون تعاملت وية فرق إحداثيات أو إغلاق خطأ قبل التسليم؟',
            ],
            followUpHints: ['ميّز GPS عن Total Station حسب كلام المرشح'],
        },
        {
            trackKey: 'senior',
            detectSignals: ['senior', 'lead', 'supervisor', 'قاد', 'مسؤول مساحة'],
            acceptableEvidence: ['إدارة فريق', 'مراجعة QA', 'تسليم للعميل'],
            questionDifficulty: 3,
            openingAnchors: [
                'اذكرلي مشروع قدت فيه فريق مسح — شنو ضبطت الجودة والدقة؟',
                'شلون راجعت مخرجات الفريق قبل التسليم للعميل؟',
            ],
            followUpHints: ['اسأل عن معايير القبول'],
        },
        {
            trackKey: 'career_switcher',
            detectSignals: ['غيرت مجال', 'انتقلت', 'career change', 'من مجال'],
            acceptableEvidence: ['تعلم مساحة', 'شهادات', 'مشروع انتقالي'],
            questionDifficulty: 2,
            openingAnchors: [
                'ليش انتقلت للمساحة وشنو نقلته من مجالك السابق؟',
                'شنو أصعب فرق بين شغلك السابق ومهندس المساحة؟',
            ],
            followUpHints: ['اربط بمثال تعلم أدوات'],
        },
    ],
    interviewPaths: [
        enrichedPath('survey_default', [...ACADEMIC_TRACKS, ...FIELD_TRACKS], [
            { stepKey: 'project_type', competencyKey: 'survey_project_setup', topicLabel: 'Project type', sampleQuestion: 'شنو نوع مشروع المسح اللي اشتغلت عليه — طبوغرافي، stakeout، as-built؟' },
            { stepKey: 'tool_used', competencyKey: 'instrument_selection', topicLabel: 'Tool used', sampleQuestion: 'شنو الجهاز أو النظام اللي استخدمته ولماذا اخترته؟' },
            { stepKey: 'coordinate_control', competencyKey: 'coordinate_control', topicLabel: 'Coordinate control', sampleQuestion: 'شلون ثبتّ نقاط التحكم أو نظام الإحداثيات بالمشروع؟' },
            { stepKey: 'accuracy_check', competencyKey: 'accuracy_qc', topicLabel: 'Accuracy check', sampleQuestion: 'شنو فحوصات الدقة اللي سويتها قبل التسليم؟' },
            { stepKey: 'issue_error', competencyKey: 'field_problem_solving', topicLabel: 'Issue/error', sampleQuestion: 'اذكرلي خطأ أو مشكلة ميدانية واجهتها — شنو كان السبب؟' },
            { stepKey: 'correction', competencyKey: 'field_problem_solving', topicLabel: 'Correction', sampleQuestion: 'شلون صححت الخطأ أو عالجت المشكلة؟' },
            { stepKey: 'deliverable', competencyKey: 'deliverable_reporting', topicLabel: 'Deliverable', sampleQuestion: 'شنو سلّمت بالنهاية وكيف تأكدت إن الملف مقبول؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: مطوّر Backend (Technology — Backend Engineering)
// ──────────────────────────────────────────────────────────────────────────
const BACKEND_DEVELOPER: DomainPack = {
    packKey: 'backend_developer',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'backend_developer',
    domain: 'technology',
    specialization: 'Backend Development',
    roleAliases: [
        'backend developer', 'back-end developer', 'back end developer',
        'backend engineer', 'back-end engineer', 'server-side developer',
        'node.js developer', 'nodejs developer', 'node developer',
        'api developer', 'api engineer', 'software engineer (backend)',
        'مطور backend', 'مبرمج backend', 'مطور خلفية',
    ],
    excludeKeywords: [
        'frontend', 'front-end', 'front end', 'devops', 'qa engineer', 'qa automation',
        'data analyst', 'data engineer', 'mobile developer', 'product manager',
        'ui/ux', 'designer',
    ],
    matchKeywords: [
        'backend', 'api', 'rest', 'restful', 'graphql', 'microservices', 'server-side',
        'database', 'sql', 'nosql', 'node', 'express', 'django', 'spring', 'postgres',
        'mongodb', 'redis', 'docker', 'kubernetes',
    ],
    terminology: [
        'idempotency', 'rate limiting', 'database indexing', 'transactions', 'ACID',
        'authentication', 'authorization', 'JWT', 'pagination', 'caching', 'logging',
        'observability', 'queue processing', 'message broker', 'API versioning',
        'connection pooling', 'horizontal scaling', 'N+1 query',
    ],
    domainGuidance: [
        'Domain: Technology — Backend Engineering.',
        'A strong candidate reasons about real production systems, not just syntax.',
        'Key areas to probe naturally: API design (REST/GraphQL, versioning, pagination, validation),',
        'data modeling and databases (indexing, transactions, N+1, SQL vs NoSQL trade-offs),',
        'authentication/authorization, error handling and retries, performance and caching,',
        'observability (logging, metrics, tracing), testing, and handling production incidents.',
        'Expect concrete examples: a real endpoint/service they designed, the trade-off they made,',
        'how they measured the result, and how they debugged a production issue.',
        'Weak answers stay theoretical ("I know REST") with no design decision, data, or trade-off.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'api_design',
            title: 'API Design',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على تصميم API واضح وقابل للتطوير مع شرح قرارات التصميم.',
            expectedEvidence: [
                'تصميم REST أو GraphQL مع تبرير الاختيار',
                'المصادقة والتفويض (authentication/authorization)',
                'التقسيم (pagination)، التحقق (validation)، ومعالجة الأخطاء',
                'إدارة الإصدارات (API versioning)',
            ],
            redFlags: [
                'لا يستطيع شرح قرارات تصميم endpoint',
                'معرفة نظرية فقط بلا مثال حقيقي',
            ],
            scoreRubric: {
                '1': 'لا فهم عملي لتصميم API.',
                '2': 'يعرف مفاهيم عامة دون قرارات تصميم.',
                '3': 'يشرح تصميماً معقولاً وله بعض الخبرة الحقيقية.',
                '4': 'يبرّر قرارات التصميم ويتعامل مع الإصدار والتحقق والأخطاء.',
                '5': 'يشرح المقايضات وقرارات الإنتاج بأمثلة حقيقية ونتائج.',
            },
            followUpRules: [
                'اطلب مثال endpoint حقيقياً صممه ولماذا اختار شكله الحالي.',
                'إذا بقي عاماً، اسأل كيف عالج pagination/validation/أخطاء العميل.',
            ],
        },
        {
            competencyKey: 'databases_data_modeling',
            title: 'Databases & Data Modeling',
            priority: 'critical',
            questionObjective:
                'قياس فهم المرشح للنمذجة والفهرسة والمعاملات ومقايضات SQL/NoSQL.',
            expectedEvidence: [
                'الفهرسة (indexing) وأثرها على الأداء',
                'المعاملات (transactions) والتناسق',
                'متى SQL ومتى NoSQL',
                'تشخيص مشاكل مثل N+1 أو الاستعلامات البطيئة',
            ],
            redFlags: [
                'لا يفرّق بين أنواع قواعد البيانات',
                'لا يعرف أثر الفهارس على الأداء',
            ],
            scoreRubric: {
                '1': 'لا أساس في قواعد البيانات.',
                '2': 'مفاهيم سطحية دون أداء.',
                '3': 'يفهم الفهرسة/المعاملات نظرياً مع بعض التطبيق.',
                '4': 'يحسّن استعلامات فعلية ويختار النموذج بوعي.',
                '5': 'حالة تحسين حقيقية بمؤشرات قبل/بعد وقرار مدروس.',
            },
            followUpRules: [
                'اسأل عن استعلام بطيء حسّنه فعلاً وكيف قاس التحسّن.',
            ],
        },
        {
            competencyKey: 'auth_security',
            title: 'Authentication, Authorization & Security',
            priority: 'high',
            questionObjective: 'قياس وعي المرشح بالمصادقة والتفويض وأساسيات الأمان.',
            expectedEvidence: [
                'آليات المصادقة (sessions/JWT/OAuth)',
                'التفويض والصلاحيات (RBAC)',
                'أساسيات الأمان (إدخال موثوق، أسرار، حدود المعدّل)',
            ],
            redFlags: [
                'يخلط بين المصادقة والتفويض',
                'لا وعي بأساسيات الأمان',
            ],
            scoreRubric: {
                '1': 'لا فهم للمصادقة/التفويض.',
                '2': 'يعرف المصطلحات فقط.',
                '3': 'يطبّق المصادقة بشكل أساسي.',
                '4': 'يميّز المصادقة عن التفويض ويطبّق ضوابط أمان.',
                '5': 'خبرة بتأمين أنظمة إنتاج بقرارات مبرّرة.',
            },
            followUpRules: [
                'اسأل عن الفرق بين authentication وauthorization بمثال من نظامه.',
            ],
        },
        {
            competencyKey: 'reliability_observability',
            title: 'Performance, Reliability & Production Incidents',
            priority: 'high',
            questionObjective:
                'قياس قدرة المرشح على الأداء والموثوقية والتعامل مع حوادث الإنتاج.',
            expectedEvidence: [
                'caching وتحسين الأداء',
                'logging/metrics/tracing (observability)',
                'تشخيص حادث إنتاج حقيقي وحلّه',
                'الاختبار (testing) قبل النشر',
            ],
            redFlags: [
                'لا يراقب الأنظمة (no observability)',
                'لا تجربة حقيقية مع حوادث إنتاج',
            ],
            scoreRubric: {
                '1': 'لا وعي بالموثوقية أو المراقبة.',
                '2': 'أفكار عامة دون قياس.',
                '3': 'يستخدم بعض السجلات/الاختبارات.',
                '4': 'يراقب ويشخّص ويحسّن بمؤشرات.',
                '5': 'قاد حلّ حادث إنتاج كامل بجذر السبب والوقاية.',
            },
            followUpRules: [
                'اطلب حادث إنتاج حقيقياً: كيف اكتشفه، شخّصه، حلّه، ومنع تكراره؟',
            ],
        },
    ],
    suggestedAnchorQuestions: [
        'حدثني عن خدمة أو API صممته فعلياً — لماذا اخترت هذا الشكل، وما المقايضة التي قبلتها، وكيف تعاملت مع المصادقة والأخطاء؟',
        'صف مشكلة أداء أو استعلام بطيء واجهته في الإنتاج — كيف شخّصتها، ما الذي غيّرته، وكيف قست التحسّن؟',
        'احكِ عن حادث إنتاج حقيقي تعاملت معه — كيف اكتشفته، ما السبب الجذري، وكيف منعت تكراره؟',
    ],
    supportedExperienceTracks: backendTracks(),
    interviewPaths: [
        enrichedPath('backend_production', FIELD_TRACKS, [
            { stepKey: 'service', topicLabel: 'Service', sampleQuestion: 'شنو الخدمة أو النظام — وشنو دورك؟' },
            { stepKey: 'api', competencyKey: 'api_design', topicLabel: 'API', sampleQuestion: 'شلون صممت الـ API — versioning، validation، errors؟' },
            { stepKey: 'data', competencyKey: 'databases_data_modeling', topicLabel: 'Data', sampleQuestion: 'شنو قرارات النمذجة أو الفهرسة اللي أثرت على الأداء؟' },
            { stepKey: 'auth', competencyKey: 'auth_security', topicLabel: 'Auth', sampleQuestion: 'شلون طبّقت authentication وauthorization؟' },
            { stepKey: 'incident', competencyKey: 'reliability_observability', topicLabel: 'Incident', sampleQuestion: 'اذكرلي حادث أو bottleneck — شلون اكتشفته؟' },
            { stepKey: 'fix', competencyKey: 'reliability_observability', topicLabel: 'Fix', sampleQuestion: 'شنو السبب الجذري والحل والوقاية؟' },
            { stepKey: 'result', topicLabel: 'Result', sampleQuestion: 'شنو النتيجة أو التحسين القابل للقياس؟' },
        ]),
        enrichedPath('backend_academic', ACADEMIC_TRACKS, [
            { stepKey: 'project', competencyKey: 'api_design', topicLabel: 'Project', sampleQuestion: 'اذكرلي مشروع backend — شنو الهدف؟' },
            { stepKey: 'design', competencyKey: 'api_design', topicLabel: 'Design', sampleQuestion: 'شلون صممت endpoints أو نموذج البيانات؟' },
            { stepKey: 'data', competencyKey: 'databases_data_modeling', topicLabel: 'Data', sampleQuestion: 'شنو اخترت SQL أو NoSQL ولماذا؟' },
            { stepKey: 'security', competencyKey: 'auth_security', topicLabel: 'Security', sampleQuestion: 'شلون فكرت بالمصادقة أو التحقق؟' },
            { stepKey: 'learning', topicLabel: 'Learning', sampleQuestion: 'شنو أهم تعلم من المشروع؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: محاسب عام (Business/Finance — General Accounting)
// ملاحظة: مقصورة على المحاسب العام؛ تُقصى صراحةً عن AP/AR/Cost/Auditor/Analyst/Tax.
// ──────────────────────────────────────────────────────────────────────────
const GENERAL_ACCOUNTANT: DomainPack = {
    packKey: 'general_accountant',
    packVersion: WAVE_3_ENRICHED_VERSION,
    roleKey: 'general_accountant',
    domain: 'business',
    specialization: 'General Accounting',
    roleAliases: [
        'general accountant', 'staff accountant', 'general ledger accountant',
        'accountant', 'accounting officer', 'محاسب', 'محاسب عام',
    ],
    excludeKeywords: [
        'accounts payable', 'accounts receivable', 'ap accountant', 'ar accountant',
        'cost accountant', 'cost accounting', 'internal auditor', 'auditor',
        'financial analyst', 'tax accountant', 'tax', 'payroll',
        'محاسب تكاليف', 'مدقق', 'محلل مالي', 'ضرائب', 'رواتب', 'ذمم',
    ],
    matchKeywords: [
        'accounting', 'general ledger', 'journal entries', 'trial balance',
        'reconciliation', 'month-end', 'financial statements', 'bookkeeping',
        'محاسبة', 'قيود', 'ميزان مراجعة', 'تسويات',
    ],
    terminology: [
        'journal entries', 'general ledger', 'trial balance', 'reconciliation',
        'accruals', 'prepayments', 'accounts payable', 'accounts receivable',
        'financial statements', 'month-end closing', 'depreciation', 'fixed assets',
        'chart of accounts', 'IFRS', 'VAT',
    ],
    domainGuidance: [
        'Domain: Finance — General Accounting.',
        'A strong candidate is accurate with the numbers and understands the full accounting cycle.',
        'Key areas to probe: journal entries, general ledger, trial balance, bank/account reconciliation,',
        'accruals and prepayments, month-end closing, and preparing/reading financial statements.',
        'Expect: a real reconciliation or closing they owned, how they found and fixed a discrepancy,',
        'and how they ensured accuracy and met deadlines.',
        'Weak answers stay generic ("I do accounting") with no cycle, controls, or discrepancy example.',
        'Do not confuse general accounting with specialized AP/AR, cost accounting, audit, or tax roles.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'accounting_cycle',
            title: 'Accounting Cycle & Journal Entries',
            priority: 'critical',
            questionObjective:
                'قياس إتقان المرشح للدورة المحاسبية من القيد إلى ميزان المراجعة.',
            expectedEvidence: [
                'تسجيل القيود (journal entries) بشكل صحيح',
                'الترحيل إلى الأستاذ العام (general ledger)',
                'إعداد ميزان المراجعة (trial balance)',
                'التمييز بين المستحقات (accruals) والمدفوعات المقدمة (prepayments)',
            ],
            redFlags: [
                'لا يعرف الطرف المدين/الدائن بثقة',
                'يخلط بين المستحق والمقدّم',
            ],
            scoreRubric: {
                '1': 'لا يتقن أساسيات القيد المزدوج.',
                '2': 'يعرف المفاهيم دون تطبيق دقيق.',
                '3': 'يطبّق الدورة المحاسبية بشكل معقول.',
                '4': 'يتقن القيود والترحيل والتسويات بثقة.',
                '5': 'يدير الدورة كاملة بدقة ويصحّح أخطاء معقدة.',
            },
            followUpRules: [
                'اطلب مثال قيد معقّد سجّله (استحقاق/تسوية) وكيف تأكد من صحته.',
            ],
        },
        {
            competencyKey: 'reconciliation',
            title: 'Reconciliation & Accuracy',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على التسويات واكتشاف الفروقات وتصحيحها.',
            expectedEvidence: [
                'تسوية الحسابات البنكية والحسابات الفرعية',
                'اكتشاف فرق حقيقي وتتبّع سببه',
                'ضوابط لضمان الدقة',
            ],
            redFlags: [
                'لا منهجية لتتبّع الفروقات',
                'يتجاوز الفروقات الصغيرة دون تفسير',
            ],
            scoreRubric: {
                '1': 'لا يفهم التسوية.',
                '2': 'يعرفها نظرياً.',
                '3': 'يسوّي حسابات بسيطة.',
                '4': 'يتتبّع الفروقات ويصححها بمنهجية.',
                '5': 'حالة حقيقية لفرق معقّد اكتشفه وحلّه مع ضوابط منع التكرار.',
            },
            followUpRules: [
                'اسأل عن فرق في تسوية اكتشفه — كيف تتبّعه وما كان سببه الجذري؟',
            ],
        },
        {
            competencyKey: 'month_end_close',
            title: 'Month-End Closing & Financial Statements',
            priority: 'high',
            questionObjective:
                'قياس مشاركة المرشح في الإقفال الشهري وإعداد/قراءة القوائم المالية.',
            expectedEvidence: [
                'خطوات الإقفال الشهري والالتزام بالمواعيد',
                'إعداد/قراءة الميزانية وقائمة الدخل',
                'تسجيل المستحقات والإهلاك',
            ],
            redFlags: [
                'لم يشارك في إقفال فعلي',
                'لا يقرأ القوائم المالية',
            ],
            scoreRubric: {
                '1': 'لا خبرة بالإقفال.',
                '2': 'مشاركة هامشية.',
                '3': 'يشارك في مهام الإقفال.',
                '4': 'يدير بنود إقفال ويلتزم بالمواعيد.',
                '5': 'يقود إقفالاً شهرياً كاملاً بدقة وفي الوقت.',
            },
            followUpRules: [
                'اطلب وصف دوره في آخر إقفال شهري وما أصعب بند تعامل معه.',
            ],
        },
        {
            competencyKey: 'financial_reporting_controls',
            title: 'Financial Reporting & Internal Controls',
            priority: 'high',
            questionObjective: 'قياس قراءة القوائم المالية وضوابط داخلية أساسية.',
            expectedEvidence: [
                'قراءة ميزانية/قائمة دخل',
                'فصل مهام', 'مراجعة', 'تصحيح أخطاء',
            ],
            redFlags: ['لا يفهم القوائم', 'لا ضوابط'],
            scoreRubric: {
                '1': 'لا يقرأ القوائم ولا يعرف ضوابط.',
                '2': 'معرفة نظرية بلا تطبيق.',
                '3': 'يقرأ بنوداً أساسية بمساعدة.',
                '4': 'يحلل بنوداً ويطبّق ضوابط عملية.',
                '5': 'يحسّن ضابطاً أو تقريراً أثر على دقة الإقفال.',
            },
            followUpRules: ['اسأل عن خطأ اكتشفه بالتقرير أو ضابط طبّقته.'],
        },
    ],
    suggestedAnchorQuestions: [
        'صف دورة محاسبية كاملة عملت عليها — من تسجيل القيود حتى ميزان المراجعة، وكيف تضمن دقة الأرقام؟',
        'حدثني عن فرق في تسوية حساب اكتشفته — كيف تتبّعت سببه وماذا فعلت لتصحيحه ومنع تكراره؟',
        'احكِ عن دورك في الإقفال الشهري الأخير — ما الخطوات التي توليتها، وكيف التزمت بالموعد مع الحفاظ على الدقة؟',
    ],
    supportedExperienceTracks: accountingTracks(),
    interviewPaths: [
        enrichedPath('accounting_core', [...ACADEMIC_TRACKS, ...FIELD_TRACKS], [
            { stepKey: 'cycle', competencyKey: 'accounting_cycle', topicLabel: 'Cycle', sampleQuestion: 'اذكرلي مثال قيد أو دورة محاسبية — شنو الخطوات؟' },
            { stepKey: 'reconcile', competencyKey: 'reconciliation', topicLabel: 'Reconcile', sampleQuestion: 'شلون سويت تسوية واكتشفت فرق؟' },
            { stepKey: 'close', competencyKey: 'month_end_close', topicLabel: 'Close', sampleQuestion: 'شنو دورك بالإقفال الشهري؟' },
            { stepKey: 'statements', competencyKey: 'financial_reporting_controls', topicLabel: 'Statements', sampleQuestion: 'شلون تقرأ أو تراجع قائمة مالية؟' },
            { stepKey: 'controls', competencyKey: 'financial_reporting_controls', topicLabel: 'Controls', sampleQuestion: 'شنو ضابط داخلي طبّقته أو حسّنته؟' },
            { stepKey: 'accuracy', competencyKey: 'reconciliation', topicLabel: 'Accuracy', sampleQuestion: 'شلون تضمن الدقة قبل التسليم؟' },
            { stepKey: 'result', topicLabel: 'Result', sampleQuestion: 'شنو النتيجة أو التحسين اللي حققته؟' },
        ]),
    ],
};

// ──────────────────────────────────────────────────────────────────────────
// حزمة: شيف/طاهٍ (Hospitality — Culinary / Kitchen)
// ──────────────────────────────────────────────────────────────────────────
const CHEF: DomainPack = {
    packKey: 'chef',
    packVersion: DEFAULT_PACK_VERSION,
    roleKey: 'chef',
    domain: 'hospitality_services',
    specialization: 'Culinary / Chef',
    roleAliases: [
        'chef', 'head chef', 'executive chef', 'sous chef', 'chef de partie',
        'cook', 'line cook', 'kitchen chef', 'شيف', 'طاهٍ', 'طباخ', 'رئيس مطبخ',
    ],
    excludeKeywords: [
        'waiter', 'barista', 'dishwasher', 'restaurant manager', 'steward',
        'نادل', 'باريستا',
    ],
    matchKeywords: [
        'kitchen', 'culinary', 'cooking', 'menu', 'food cost', 'food safety',
        'haccp', 'recipe', 'plating', 'مطبخ', 'طبخ', 'قائمة طعام', 'سلامة غذائية',
    ],
    terminology: [
        'mise en place', 'food cost', 'portion control', 'HACCP', 'allergen control',
        'kitchen workflow', 'inventory rotation', 'FIFO', 'menu execution',
        'food safety', 'plating', 'prep list', 'temperature control', 'cross-contamination',
    ],
    domainGuidance: [
        'Domain: Hospitality — Culinary / Kitchen.',
        'A strong candidate runs a clean, fast, consistent kitchen and controls cost and safety.',
        'Key areas to probe: mise en place and prep, menu execution and consistency, food cost and',
        'portion control, food safety and hygiene (HACCP, allergens, temperature, FIFO/rotation),',
        'kitchen workflow under rush, and leading/coordinating the kitchen team.',
        'Expect: a real busy service they handled, how they kept quality and speed, and how they',
        'controlled cost/waste and enforced food safety.',
        'Weak answers stay generic ("I can cook") with no cost, safety, or service-under-pressure detail.',
    ].join(' '),
    competencies: [
        {
            competencyKey: 'food_safety_hygiene',
            title: 'Food Safety & Hygiene',
            priority: 'critical',
            questionObjective:
                'قياس التزام المرشح بسلامة الغذاء والنظافة وفق معايير معتمدة.',
            expectedEvidence: [
                'تطبيق HACCP والتحكم في الحرارة',
                'منع التلوث المتبادل وإدارة المسبّبات (allergens)',
                'دوران المخزون (FIFO) والتخزين السليم',
            ],
            redFlags: [
                'الاستهانة بالسلامة الغذائية',
                'لا يعرف ضوابط الحرارة أو التلوث المتبادل',
            ],
            scoreRubric: {
                '1': 'لا وعي بسلامة الغذاء.',
                '2': 'وعي سطحي.',
                '3': 'يعرف الأساسيات ويطبّقها.',
                '4': 'يطبّق HACCP وضوابط واضحة باستمرار.',
                '5': 'يقود ثقافة سلامة غذائية بأمثلة وإجراءات موثّقة.',
            },
            followUpRules: [
                'اسأل كيف يتعامل مع طبق فيه مسبّب حساسية وكيف يمنع التلوث المتبادل.',
            ],
        },
        {
            competencyKey: 'kitchen_execution',
            title: 'Menu Execution Under Pressure',
            priority: 'critical',
            questionObjective:
                'قياس قدرة المرشح على تقديم جودة ثابتة وسرعة أثناء الذروة.',
            expectedEvidence: [
                'mise en place وتنظيم محطة العمل',
                'الحفاظ على الجودة والسرعة وقت الازدحام',
                'التنسيق مع فريق المطبخ',
            ],
            redFlags: [
                'يفقد الجودة تحت الضغط',
                'لا تنظيم مسبق للمحطة',
            ],
            scoreRubric: {
                '1': 'لا ينظّم عمله.',
                '2': 'يعمل دون منهجية واضحة.',
                '3': 'ينجز خدمة عادية بثبات معقول.',
                '4': 'يحافظ على الجودة والسرعة وقت الذروة.',
                '5': 'يدير خدمة ضغط عالية بجودة ثابتة وقيادة فريق.',
            },
            followUpRules: [
                'اطلب وصف أكثر خدمة ازدحاماً مرّ بها وكيف حافظ على الجودة.',
            ],
        },
        {
            competencyKey: 'food_cost_control',
            title: 'Food Cost & Portion Control',
            priority: 'high',
            questionObjective: 'قياس وعي المرشح بإدارة التكلفة وتقليل الهدر.',
            expectedEvidence: [
                'حساب تكلفة الطبق (food cost)',
                'التحكم في الحصص (portion control)',
                'تقليل الهدر وإدارة المخزون',
            ],
            redFlags: [
                'لا وعي بالتكلفة أو الهدر',
                'لا يضبط الحصص',
            ],
            scoreRubric: {
                '1': 'لا وعي بالتكلفة.',
                '2': 'وعي عام دون أرقام.',
                '3': 'يضبط الحصص بشكل أساسي.',
                '4': 'يدير التكلفة والهدر بمؤشرات.',
                '5': 'خفّض تكلفة/هدراً فعلياً مع الحفاظ على الجودة.',
            },
            followUpRules: [
                'اسأل عن إجراء اتخذه لخفض تكلفة الطعام أو الهدر وما النتيجة.',
            ],
        },
    ],
    suggestedAnchorQuestions: [
        'صف أكثر خدمة ازدحاماً تعاملت معها في المطبخ — كيف نظّمت محطتك وفريقك للحفاظ على الجودة والسرعة؟',
        'كيف تضمن سلامة الغذاء في مطبخك — حدثني عن تطبيقك لضوابط الحرارة والتلوث المتبادل والمسبّبات؟',
        'احكِ عن إجراء اتخذته لخفض تكلفة الطعام أو الهدر دون التأثير على الجودة — وما النتيجة التي تحققت؟',
    ],
};

/** كل الحزم العميقة المتاحة. تُضاف حزم أعمق تدريجياً هنا دون تغيير المستهلكين. */
export const DOMAIN_PACKS: DomainPack[] = [
    OIL_GAS_PRODUCTION,
    HR_RECRUITER,
    PETROLEUM_ENGINEER,
    SURVEY_ENGINEER,
    ...WAVE_1B_PACKS,
    ...WAVE_2_PACKS,
    ...WAVE_4_PACKS,
    BACKEND_DEVELOPER,
    GENERAL_ACCOUNTANT,
    CHEF,
];

/** يبحث عن حزمة عميقة بمفتاحها. */
export function getDomainPackByKey(packKey: string): DomainPack | undefined {
    return DOMAIN_PACKS.find((p) => p.packKey === packKey);
}

/** Match Deep Pack by Evaalo Job Catalog roleKey (priority over text matching). */
export function matchDomainPackByRoleKey(roleKey?: string | null): DomainPack | undefined {
    const rk = String(roleKey || '').trim();
    if (!rk) return undefined;
    return DOMAIN_PACKS.find((p) => p.roleKey === rk || p.packKey === rk);
}

/** يُرجع نسخة الحزمة الفعلية (semver). */
export function getPackVersion(pack: DomainPack | undefined | null): string {
    const v = (pack?.packVersion || '').trim();
    return v || DEFAULT_PACK_VERSION;
}

/** يحوّل score + مصدر المطابقة إلى مستوى ثقة (بدون margin — للاختبارات البسيطة). */
export function resolvePackMatchConfidence(
    score: number,
    matchSource: PackMatchSource
): PackMatchConfidence {
    if (matchSource === 'roleKey' || score >= 100) return 'high';
    if (score >= 10) return 'medium';
    if (score >= 2) return 'low';
    return 'low';
}

/** يحوّل الفائز + الوصيف إلى ثقة مع مراعاة score margin (لا يعتمد على ترتيب DOMAIN_PACKS). */
export function resolvePackMatchConfidenceWithMargin(
    best: { score: number; matchSource: PackMatchSource },
    runnerUp: { score: number } | null
): PackMatchConfidence {
    const margin = runnerUp ? best.score - runnerUp.score : best.score;
    if (best.score < 2 || margin < PACK_MATCH_MARGIN_LOW) return 'low';

    const strongSource =
        best.matchSource === 'roleKey' || best.matchSource === 'alias';
    if (strongSource && margin >= PACK_MATCH_MARGIN_HIGH) return 'high';
    if (strongSource && margin >= PACK_MATCH_MARGIN_LOW) return 'medium';

    if (margin >= PACK_MATCH_MARGIN_HIGH && best.score >= 10) return 'high';
    if (margin >= PACK_MATCH_MARGIN_LOW) return 'medium';
    return 'low';
}

/** هل تُفعَّل deep_pack من نتيجة المطابقة؟ */
export function shouldUseDeepPackMatch(packMatch: PackMatchResult): boolean {
    if (!packMatch.pack || packMatch.confidence === 'low') return false;
    if (packMatch.confidence === 'high') return true;
    return (
        packMatch.confidence === 'medium'
        && (packMatch.scoreMargin ?? 0) >= PACK_MATCH_MARGIN_DEEP
    );
}

interface _ScoredPack {
    pack: DomainPack;
    score: number;
    matchSource: PackMatchSource;
    matchedTerms: string[];
}

function _scorePackAgainstScope(
    pack: DomainPack,
    haystack: string,
    scope: string,
    title: string,
    inferredDomain?: string
): _ScoredPack | null {
        const excludes = (pack.excludeKeywords || [])
            .map((k) => k.toLowerCase().trim())
            .filter(Boolean);
    if (excludes.some((k) => scope.includes(k))) return null;

        let score = 0;
    let matchSource: PackMatchSource = 'none';
    const matchedTerms: string[] = [];

    const aliasHit = (pack.roleAliases || []).find((a) => {
            const k = a.toLowerCase().trim();
            return !!k && scope.includes(k);
        });
    if (aliasHit) {
        score += 100;
        matchSource = 'alias';
        matchedTerms.push(`alias:${aliasHit}`);
    }

        if (title && inferredDomain && pack.domain === inferredDomain) {
            const specTokens = pack.specialization
                .toLowerCase()
                .replace(/[()/,&]/g, ' ')
                .split(/\s+/)
                .filter((t) => t.length >= 4 && !['and', 'the', 'of', 'general'].includes(t));
        const hitToken = specTokens.find((t) => title.includes(t));
        if (hitToken) {
            score += 10;
            if (matchSource === 'none') matchSource = 'title_domain';
            matchedTerms.push(`title_domain:${hitToken}`);
        }
    }

        let kwHits = 0;
        for (const kw of pack.matchKeywords) {
            const k = kw.toLowerCase();
        if (k && haystack.includes(k)) {
            kwHits += 1;
            matchedTerms.push(`kw:${kw}`);
        }
    }
    if (kwHits >= 2) {
        score += kwHits;
        if (matchSource === 'none') matchSource = 'keywords';
    }

    if (score <= 0) return null;
    return { pack, score, matchSource, matchedTerms };
}

/** مطابقة حزمة مع ثقة — يُستخدم في التوليد وQA. */
export function matchDomainPackWithConfidence(
    text: string,
    jobTitle?: string,
    inferredDomain?: string
): PackMatchResult {
    const haystack = String(text || '').toLowerCase();
    if (!haystack.trim()) {
        return { pack: null, packKey: null, confidence: 'low', score: 0, matchSource: 'none' };
    }
    const title = String(jobTitle || '').toLowerCase().trim();
    const scope = title ? `${title} ${haystack}` : haystack;

    const scored: _ScoredPack[] = [];
    for (const pack of DOMAIN_PACKS) {
        const result = _scorePackAgainstScope(pack, haystack, scope, title, inferredDomain);
        if (result) scored.push(result);
    }
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0] ?? null;
    const runnerUp = scored[1] ?? null;

    if (!best || best.score < 2) {
        return { pack: null, packKey: null, confidence: 'low', score: 0, matchSource: 'none' };
    }

    const scoreMargin = runnerUp ? best.score - runnerUp.score : best.score;
    const confidence = resolvePackMatchConfidenceWithMargin(best, runnerUp);
    return {
        pack: confidence === 'low' ? null : best.pack,
        packKey: confidence === 'low' ? null : best.pack.packKey,
        confidence,
        score: best.score,
        matchSource: best.matchSource,
        runnerUpPackKey: runnerUp?.pack.packKey ?? null,
        runnerUpScore: runnerUp?.score,
        scoreMargin,
        matchedTerms: best.matchedTerms,
    };
}

/** مطابقة roleKey من الكتالوج — ثقة عالية دائماً عند التطابق. */
export function matchDomainPackByRoleKeyWithConfidence(
    roleKey?: string | null
): PackMatchResult {
    const rk = String(roleKey || '').trim();
    if (!rk) {
        return { pack: null, packKey: null, confidence: 'low', score: 0, matchSource: 'none' };
    }
    const pack = DOMAIN_PACKS.find((p) => p.roleKey === rk || p.packKey === rk);
    if (!pack) {
        return { pack: null, packKey: null, confidence: 'low', score: 0, matchSource: 'none' };
    }
    return {
        pack,
        packKey: pack.packKey,
        confidence: 'high',
        score: 100,
        matchSource: 'roleKey',
        runnerUpPackKey: null,
        runnerUpScore: 0,
        scoreMargin: 100,
    };
}

/**
 * يطابق أفضل حزمة عميقة لوظيفة، بترتيب أولويات صارم يمنع تفعيل حزمة بكلمة واحدة عامة:
 *   1. تطابق مباشر مع roleAliases (حاسم).
 *   2. تطابق عنوان الوظيفة مع تخصص الحزمة + توافق المجال (title + domain).
 *   3. عدّة كلمات مفتاحية قوية معاً (≥2) كعامل مساعد فقط.
 * مع حارس excludeKeywords الذي يُقصي الحزمة عند ورود مصطلح تخصص مجاور.
 *
 * يرجع `undefined` إن لم تتجاوز المطابقة الحد الأدنى — عندها يعتمد التوليد على الـTaxonomy.
 */
export function matchDomainPack(
    text: string,
    jobTitle?: string,
    inferredDomain?: string
): DomainPack | undefined {
    return matchDomainPackWithConfidence(text, jobTitle, inferredDomain).pack ?? undefined;
}
