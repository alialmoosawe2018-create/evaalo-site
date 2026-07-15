// ============================================
// ملف: services/expertise/domainTaxonomy.ts
// الوظيفة: تصنيف خفيف لكل مجالات المنصة — يُستخدم لاستنتاج المجال/التخصص لأي وظيفة
//          وتوجيه التوليد الذكي حتى عند غياب حزمة خبرة عميقة (بدل السقوط لأسئلة عامة).
//
// مبذور من تصنيف المنصة الحالي (industry families في position_catalog.py).
// هذا المصدر "خفيف" عمداً: اسم المجال + تخصصاته الشائعة + كلمات مفتاحية + كفاءات متوقعة.
// الحزم العميقة (oil_gas_production / hr_recruiter) تعيش في domainPacks.ts.
// ============================================

/** مدخل تصنيف مجال واحد (خفيف). */
export interface DomainTaxonomyEntry {
    /** مفتاح المجال القانوني (snake_case) — متوافق مع industry_family في بنك الأسئلة. */
    domain: string;
    /** اسم المجال للعرض البشري. */
    label: string;
    /** التخصصات الفرعية الشائعة داخل المجال. */
    commonSpecializations: string[];
    /** كلمات مفتاحية لمطابقة الاستنتاج من عنوان/وصف الوظيفة. */
    keywords: string[];
    /** كفاءات متوقعة عامة لهذا المجال — تُلهم التوليد عند غياب حزمة عميقة. */
    expectedCompetencies: string[];
    /** مصطلحات خفيفة (10–15) تُمرَّر للوكيل عند L1 taxonomy_generated. */
    lightTerminology?: string[];
}

/**
 * تصنيف مجالات المنصة. القائمة قابلة للتوسعة دون تغيير الكود المستهلك.
 * `domain` يطابق industry_family المستخدم في بنك الأسئلة عند الإمكان.
 */
export const DOMAIN_TAXONOMY: DomainTaxonomyEntry[] = [
    {
        domain: 'engineering',
        label: 'Engineering',
        commonSpecializations: [
            'Production Engineering (Oil & Gas)',
            'Petroleum Engineering',
            'Reservoir Engineering',
            'Drilling Engineering',
            'Survey Engineering',
            'Quantity Surveying',
            'Well Intervention',
            'HSE',
            'Civil / Site Engineering',
            'Mechanical Engineering',
            'Electrical / MEP',
            'Process Engineering',
            'Pipeline Engineering',
            'Quality (QA/QC)',
            'Planning',
            'BIM / Structural',
        ],
        keywords: [
            'engineer', 'engineering', 'oil', 'gas', 'petroleum', 'reservoir', 'drilling',
            'well', 'production engineer', 'hse', 'safety', 'civil', 'mechanical', 'electrical',
            'mep', 'process', 'pipeline', 'refinery', 'hvac', 'qa/qc', 'site', 'structural',
            'survey engineer', 'surveying', 'quantity surveyor', 'gnss', 'total station',
            'مهندس', 'هندسة', 'نفط', 'غاز', 'حفر', 'مكمن', 'إنتاج', 'سلامة', 'مدني', 'ميكانيك', 'كهرباء',
            'مساح', 'مسح', 'مساحة',
        ],
        expectedCompetencies: [
            'technical_problem_diagnosis',
            'data_driven_decision_making',
            'safety_and_compliance',
            'hands_on_experience',
            'cross_team_coordination',
            'deliverable_quality',
        ],
        lightTerminology: [
            'GPS', 'GNSS', 'Total Station', 'RTK', 'leveling', 'coordinates', 'HSE',
            'permit to work', 'well testing', 'water cut', 'GOR', 'artificial lift',
            'AutoCAD', 'Civil 3D', 'piping', 'structural', 'as-built', 'survey report',
        ],
    },
    {
        domain: 'business',
        label: 'Business & Corporate Functions',
        commonSpecializations: [
            // الموارد البشرية
            'HR Recruiter',
            'Talent Acquisition Specialist',
            'HR Officer / Generalist',
            'HR Manager',
            'Payroll Specialist',
            // المالية والمحاسبة (تخصصات دقيقة — يلتقطها inferSpecialization حتى بلا حزمة عميقة)
            'General Accountant',
            'Accounts Payable',
            'Accounts Receivable',
            'Cost Accountant',
            'Financial Analyst',
            'Internal Auditor',
            'Tax Accountant',
            // بقية وظائف الأعمال
            'Sales',
            'Marketing',
            'Procurement',
            'Supply Chain & Logistics',
            'Project / Program Management',
            'Business Development',
        ],
        keywords: [
            'hr', 'human resources', 'recruiter', 'recruitment', 'talent', 'talent acquisition',
            'payroll', 'hr officer', 'hr manager', 'hr generalist',
            'finance', 'accountant', 'accounting', 'general accountant', 'accounts payable',
            'accounts receivable', 'cost accountant', 'financial analyst', 'internal auditor',
            'auditor', 'tax', 'audit', 'general ledger', 'bookkeeping',
            'sales', 'marketing', 'procurement', 'supply chain', 'logistics',
            'project manager', 'business', 'analyst',
            'موارد بشرية', 'توظيف', 'استقطاب', 'رواتب', 'مبيعات', 'تسويق', 'محاسبة', 'محاسب',
            'مالية', 'مدقق', 'محلل مالي', 'تكاليف', 'ضرائب', 'مشتريات', 'لوجستيات', 'مشاريع',
        ],
        expectedCompetencies: [
            'stakeholder_management',
            'process_ownership',
            'analytical_thinking',
            'results_and_metrics',
            'communication',
            'compliance_and_accuracy',
        ],
        lightTerminology: [
            'KPI', 'Excel', 'ATS', 'LinkedIn', 'HRIS', 'GL', 'reconciliation',
            'month-end close', 'budget', 'forecast', 'audit trail', 'vendor management',
            'pipeline', 'time to fill', 'offer acceptance',
        ],
    },
    {
        domain: 'technology',
        label: 'Technology & Software',
        commonSpecializations: [
            'Backend Development',
            'Frontend Development',
            'Full Stack',
            'DevOps / Cloud',
            'Data Engineering',
            'Data Science / ML',
            'Data Analyst',
            'QA / Testing',
            'Cybersecurity',
            'Mobile Development',
            'Product Management',
        ],
        keywords: [
            'developer', 'engineer software', 'software', 'backend', 'frontend', 'fullstack',
            'devops', 'cloud', 'data', 'data analyst', 'data engineer', 'machine learning', 'ml',
            'ai', 'qa', 'tester', 'qa automation', 'cybersecurity', 'security', 'product manager',
            'sre', 'mobile', 'network', 'database', 'api', 'node', 'react',
            'مبرمج', 'برمجة', 'مطور', 'بيانات', 'محلل بيانات', 'ذكاء اصطناعي', 'سحابة', 'أمن سيبراني',
        ],
        expectedCompetencies: [
            'technical_depth',
            'system_design',
            'debugging_and_problem_solving',
            'code_quality',
            'collaboration',
            'production_reliability',
        ],
        lightTerminology: [
            'API', 'REST', 'SQL', 'Git', 'CI/CD', 'Docker', 'Kubernetes', 'AWS',
            'monitoring', 'unit testing', 'code review', 'PostgreSQL', 'Redis',
            'microservices', 'authentication', 'logging',
        ],
    },
    {
        domain: 'leadership_admin',
        label: 'Leadership & Administration',
        commonSpecializations: [
            'Executive Leadership',
            'General Management',
            'Administration',
            'Office Management',
            'Executive Assistance',
        ],
        keywords: [
            'manager', 'management', 'director', 'ceo', 'general manager', 'admin',
            'administrative', 'executive assistant', 'office manager', 'leadership',
            'مدير', 'إدارة', 'قيادة', 'إداري', 'سكرتير',
        ],
        expectedCompetencies: [
            'leadership_and_decision_making',
            'planning_and_organization',
            'people_management',
            'communication',
            'judgment',
            'delegation_and_accountability',
        ],
        lightTerminology: [
            'OKR', 'KPI', 'budget', 'headcount', 'stakeholder', 'governance',
            'risk register', 'escalation', 'prioritization',
        ],
    },
    {
        domain: 'customer_operations',
        label: 'Customer Operations',
        commonSpecializations: [
            'Customer Service',
            'Customer Success',
            'Call Center',
            'Reception / Front Desk',
            'Retail Store Operations',
        ],
        keywords: [
            'customer service', 'customer support', 'call center', 'customer success',
            'receptionist', 'front desk', 'cashier', 'store manager', 'retail',
            'خدمة عملاء', 'دعم', 'كول سنتر', 'استقبال', 'كاشير',
        ],
        expectedCompetencies: [
            'customer_handling',
            'communication',
            'problem_resolution',
            'patience_and_empathy',
            'process_adherence',
            'escalation_judgment',
        ],
        lightTerminology: [
            'SLA', 'ticket', 'CRM', 'first call resolution', 'CSAT', 'NPS',
            'escalation', 'knowledge base', 'queue', 'callback',
        ],
    },
    {
        domain: 'hospitality_services',
        label: 'Hospitality & Services',
        commonSpecializations: [
            'Hotel Management',
            'Restaurant Management',
            'Chef',
            'Sous Chef',
            'Pastry Chef',
            'Food Safety Officer',
            'Barista',
            'Food & Beverage Service',
        ],
        keywords: [
            'hotel', 'restaurant', 'chef', 'sous chef', 'pastry', 'cook', 'barista', 'waiter',
            'hospitality', 'kitchen', 'culinary', 'food', 'beverage', 'food safety', 'haccp',
            'فندق', 'مطعم', 'طباخ', 'شيف', 'طاهٍ', 'ضيافة', 'باريستا', 'مطبخ', 'سلامة غذائية',
        ],
        expectedCompetencies: [
            'service_quality',
            'speed_under_pressure',
            'hygiene_and_standards',
            'guest_experience',
            'teamwork',
            'cost_control',
        ],
        lightTerminology: [
            'HACCP', 'food safety', 'temperature log', 'mise en place', 'food cost',
            'kitchen brigade', 'allergen', 'HACCP', 'POS', 'guest complaint',
        ],
    },
    {
        domain: 'legal_services',
        label: 'Legal Services',
        commonSpecializations: [
            'Corporate Law',
            'Compliance',
            'Legal Advisory',
            'Contracts',
            'Legal Support',
        ],
        keywords: [
            'lawyer', 'legal', 'compliance', 'attorney', 'contracts', 'paralegal', 'legal advisor',
            'محامي', 'قانوني', 'امتثال', 'عقود',
        ],
        expectedCompetencies: [
            'legal_knowledge',
            'attention_to_detail',
            'risk_assessment',
            'drafting_and_documentation',
            'ethics_and_integrity',
            'client_advisory',
        ],
        lightTerminology: [
            'contract', 'NDA', 'compliance', 'regulatory', 'due diligence',
            'liability', 'jurisdiction', 'clause', 'memorandum',
        ],
    },
    {
        domain: 'healthcare_services',
        label: 'Healthcare Services',
        commonSpecializations: [
            'Nursing',
            'Pharmacy',
            'Medical Sales',
            'Clinical Support',
        ],
        keywords: [
            'nurse', 'nursing', 'pharmacist', 'pharmacy', 'medical', 'clinical', 'healthcare',
            'patient', 'ممرض', 'تمريض', 'صيدلي', 'صيدلة', 'طبي', 'رعاية صحية',
        ],
        expectedCompetencies: [
            'clinical_knowledge',
            'patient_care',
            'safety_and_protocols',
            'attention_to_detail',
            'composure_under_pressure',
            'documentation_accuracy',
        ],
        lightTerminology: [
            'patient chart', 'medication', 'dosage', 'infection control', 'triage',
            'vital signs', 'EMR', 'protocol', 'hand hygiene',
        ],
    },
    {
        domain: 'creative',
        label: 'Creative & Design',
        commonSpecializations: [
            'Graphic Design',
            'UI/UX Design',
            'Product Design',
            'Video Editing',
        ],
        keywords: [
            'designer', 'design', 'graphic', 'ui/ux', 'ux', 'ui', 'video editor', 'creative',
            'product designer', 'تصميم', 'مصمم', 'جرافيك', 'مونتاج',
        ],
        expectedCompetencies: [
            'design_craft',
            'portfolio_and_process',
            'user_empathy',
            'collaboration_with_stakeholders',
            'attention_to_detail',
            'iteration_and_feedback',
        ],
        lightTerminology: [
            'Figma', 'wireframe', 'prototype', 'brand guidelines', 'typography',
            'UI kit', 'user research', 'handoff', 'design system',
        ],
    },
    {
        domain: 'education_training',
        label: 'Education & Training',
        commonSpecializations: [
            'Teaching',
            'Training & Facilitation',
            'Curriculum Development',
        ],
        keywords: [
            'teacher', 'trainer', 'training', 'education', 'instructor', 'curriculum',
            'معلم', 'مدرب', 'تدريب', 'تعليم',
        ],
        expectedCompetencies: [
            'subject_mastery',
            'communication_and_delivery',
            'learner_engagement',
            'assessment_and_feedback',
            'planning',
            'adaptation_to_audience',
        ],
        lightTerminology: [
            'curriculum', 'learning objective', 'assessment', 'facilitation',
            'feedback', 'lesson plan', 'engagement', 'evaluation rubric',
        ],
    },
];

/** مجال احتياطي عام عند تعذّر الاستنتاج — يبقى مهنياً وليس عاماً مبتذلاً. */
export const GENERIC_DOMAIN: DomainTaxonomyEntry = {
    domain: 'general_professional',
    label: 'General Professional',
    commonSpecializations: [],
    keywords: [],
    expectedCompetencies: [
        'role_understanding',
        'relevant_experience',
        'problem_solving',
        'communication',
        'results_orientation',
        'adaptability',
    ],
    lightTerminology: [
        'KPI', 'stakeholder', 'deadline', 'priority', 'documentation', 'handover',
    ],
};

/** يطبّع نصاً للمطابقة (lowercase + trim). */
function normalizeForMatch(text: string): string {
    return String(text || '').toLowerCase();
}

/**
 * يستنتج مجال التصنيف الأنسب من نص حر (عنوان الوظيفة + وصفها + معاييرها).
 * يعتمد على عدّ مطابقات الكلمات المفتاحية. يرجع `GENERIC_DOMAIN` إن لم يطابق شيء.
 */
export function inferDomain(text: string): DomainTaxonomyEntry {
    const haystack = normalizeForMatch(text);
    if (!haystack.trim()) return GENERIC_DOMAIN;

    let best: { entry: DomainTaxonomyEntry; score: number } | null = null;
    for (const entry of DOMAIN_TAXONOMY) {
        let score = 0;
        for (const kw of entry.keywords) {
            const k = kw.toLowerCase();
            if (!k) continue;
            if (haystack.includes(k)) score += 1;
        }
        if (!best || score > best.score) {
            best = { entry, score };
        }
    }
    if (!best || best.score === 0) return GENERIC_DOMAIN;
    return best.entry;
}

/**
 * يستنتج التخصص الأنسب داخل مجال معيّن من نص حر، بمطابقة كلمات من اسم التخصص.
 * يرجع سلسلة فارغة إن لم يُطابق تخصص بعينه (يترك التوليد يخصّص لاحقاً).
 */
export function inferSpecialization(entry: DomainTaxonomyEntry, text: string): string {
    const haystack = normalizeForMatch(text);
    if (!haystack.trim() || !entry.commonSpecializations.length) return '';
    let best: { spec: string; score: number } | null = null;
    for (const spec of entry.commonSpecializations) {
        const tokens = spec
            .toLowerCase()
            .replace(/[()/]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 3 && !['and', 'the', 'of'].includes(t));
        let score = 0;
        for (const t of tokens) {
            if (haystack.includes(t)) score += 1;
        }
        if (score > 0 && (!best || score > best.score)) {
            best = { spec, score };
        }
    }
    return best ? best.spec : '';
}

/** مصطلحات L1 من التصنيف — مقصوصة لحجم البرومت. */
export function getTaxonomyLightTerminology(entry: DomainTaxonomyEntry): string[] {
    if (!entry.lightTerminology?.length) return [];
    return entry.lightTerminology
        .map((t) => String(t || '').trim())
        .filter(Boolean)
        .slice(0, 18);
}
