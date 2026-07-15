// Wave 2 L3 packs — technology, customer ops, finance (compact builder)
import type { DomainPack, PackCompetency } from './domainPacks.js';
import { rubricFor } from './packRubrics.js';
import {
    ACADEMIC_TRACKS,
    FIELD_TRACKS,
    WAVE_3_ENRICHED_VERSION,
    accountsPayableTracks,
    customerSupportTracks,
    dataAnalystTracks,
    devopsTracks,
    enrichedPath,
    financialAnalystTracks,
    frontendTracks,
    internalAuditorTracks,
    operationsCoordinatorTracks,
    qaTracks,
    uniqueRubric,
} from './wave3EnrichedHelpers.js';

export const WAVE_2_PACK_VERSION = '1.3.0';

/** Wave 3 enriched subset — bumped to 1.4.0 with expanded paths. */
export const WAVE_3_WAVE2_ENRICHED_KEYS = new Set<string>([
    'frontend_developer',
    'devops_engineer',
    'qa_engineer',
    'data_analyst',
    'customer_support',
    'operations_coordinator',
    'accounts_payable',
    'financial_analyst',
    'internal_auditor',
]);

const PLACEHOLDER_RUBRIC = uniqueRubric('—', '—');

function comp(
    packKey: string,
    competencyKey: string,
    title: string,
    questionObjective: string,
    expectedEvidence: string[],
    redFlags: string[],
    followUpRules: string[],
    priority: PackCompetency['priority'] = 'high'
): PackCompetency {
    return {
        competencyKey,
        title,
        priority,
        questionObjective,
        expectedEvidence,
        redFlags,
        scoreRubric: PLACEHOLDER_RUBRIC,
        followUpRules,
    };
}

function mkPack(p: Omit<DomainPack, 'packVersion'> & { packVersion?: string }): DomainPack {
    const ver = p.packVersion
        || (WAVE_3_WAVE2_ENRICHED_KEYS.has(p.packKey) ? WAVE_3_ENRICHED_VERSION : WAVE_2_PACK_VERSION);
    let interviewPaths = p.interviewPaths;
    if (WAVE_3_WAVE2_ENRICHED_KEYS.has(p.packKey) && interviewPaths?.length) {
        interviewPaths = interviewPaths.map((path) =>
            enrichedPath(
                path.pathKey,
                path.preferredTracks ?? [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
                path.steps
            )
        );
    }
    const competencies = p.competencies.map((c) => ({
        ...c,
        scoreRubric: rubricFor(p.packKey, c.competencyKey),
    }));
    return { ...p, packVersion: ver, interviewPaths, competencies };
}

export const FRONTEND_DEVELOPER = mkPack({
    packKey: 'frontend_developer',
    roleKey: 'frontend_developer',
    domain: 'technology',
    specialization: 'Frontend Development',
    roleAliases: ['frontend developer', 'front end developer', 'react developer', 'مطور واجهات', 'فرونت اند'],
    excludeKeywords: ['backend only', 'devops', 'data analyst', 'petroleum', 'recruiter'],
    matchKeywords: ['frontend', 'react', 'vue', 'angular', 'typescript', 'css', 'ui', 'واجهات', 'فرونت'],
    terminology: [
        'React', 'TypeScript', 'component architecture', 'state management', 'Redux', 'accessibility',
        'performance', 'Core Web Vitals', 'lazy loading', 'bundle size', 'responsive design',
        'testing library', 'Cypress', 'design system', 'API integration', 'SSR', 'hydration',
    ],
    domainGuidance:
        'Domain: Frontend Development. Probe real UI work: component design, state, performance, accessibility, and production bugs. Weak answers: tool lists without trade-offs or metrics.',
    competencies: [
        comp('frontend_developer', 'ui_architecture', 'UI Architecture', 'قياس تصميم مكونات قابلة للصيانة.', ['components', 'state', 'separation'], ['لا هيكلة'], ['اسأل عن قرار state management']),
        comp('frontend_developer', 'performance', 'Performance', 'قياس تحسين أداء الواجهة.', ['LCP', 'bundle', 'memo'], ['لا قياس'], ['اطلب رقم قبل/بعد']),
        comp('frontend_developer', 'accessibility', 'Accessibility', 'قياس a11y عملياً.', ['ARIA', 'keyboard', 'contrast'], ['يتجاهل a11y'], ['مثال مشكلة وصول']),
        comp('frontend_developer', 'api_integration', 'API Integration', 'قياس ربط الواجهة بالخدمات.', ['loading', 'errors', 'auth'], ['لا معالجة أخطاء'], ['اسأل عن edge case']),
        comp('frontend_developer', 'testing', 'Frontend Testing', 'قياس اختبارات واجهة.', ['unit', 'e2e', 'regression'], ['لا اختبارات'], ['شنو تغطي الاختبار']),
        comp('frontend_developer', 'collaboration', 'Design & Collaboration', 'قياس العمل مع التصميم والفريق.', ['handoff', 'review', 'design system'], ['عزلة'], ['كيف تتعامل مع تغيير تصميم']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي شاشة أو ميزة واجهة بنيتها — شنو التحدي التقني وشنو النتيجة؟',
        'شلون تحسّن أداء صفحة بطيئة — شنو القياسات اللي استخدمتها؟',
        'اذكرلي موقف اضطررت تتعاون وية التصميم أو الباكند لحل مشكلة بالواجهة؟',
    ],
    supportedExperienceTracks: frontendTracks(),
    interviewPaths: [{
        pathKey: 'frontend_delivery',
        preferredTracks: FIELD_TRACKS,
        steps: [
            { stepKey: 'feature', topicLabel: 'Feature', sampleQuestion: 'شنو الميزة أو الشاشة؟' },
            { stepKey: 'tech', competencyKey: 'ui_architecture', topicLabel: 'Tech', sampleQuestion: 'شنو قرارات المكونات والحالة؟' },
            { stepKey: 'api', competencyKey: 'api_integration', topicLabel: 'API', sampleQuestion: 'شلون ربطت الواجهة بالخدمات والأخطاء؟' },
            { stepKey: 'perf', competencyKey: 'performance', topicLabel: 'Performance', sampleQuestion: 'واجهت مشكلة أداء — شنو القياسات؟' },
            { stepKey: 'a11y', competencyKey: 'accessibility', topicLabel: 'Accessibility', sampleQuestion: 'شلون تأكدت من الوصول accessibility؟' },
            { stepKey: 'test', competencyKey: 'testing', topicLabel: 'Testing', sampleQuestion: 'شنو اختبرت قبل الإطلاق؟' },
            { stepKey: 'result', topicLabel: 'Result', sampleQuestion: 'شنو النتيجة؟' },
        ],
    }],
});

export const DEVOPS_ENGINEER = mkPack({
    packKey: 'devops_engineer',
    roleKey: 'devops_engineer',
    domain: 'technology',
    specialization: 'DevOps / Platform Engineering',
    roleAliases: ['devops engineer', 'platform engineer', 'sre', 'مهندس ديفوبس', 'مهندس منصات'],
    excludeKeywords: ['frontend developer', 'data analyst only', 'recruiter', 'petroleum'],
    matchKeywords: ['devops', 'ci/cd', 'kubernetes', 'terraform', 'docker', 'pipeline', 'ديفوبس', 'كوبر'],
    terminology: [
        'CI/CD', 'Kubernetes', 'Docker', 'Terraform', 'IaC', 'GitOps', 'observability',
        'prometheus', 'grafana', 'incident response', 'SLO', 'SLA', 'rollback', 'canary',
        'secrets management', 'autoscaling', 'helm',
    ],
    domainGuidance:
        'Domain: DevOps. Probe pipelines, infra as code, incidents, and measurable reliability improvements. Weak: buzzwords without incident or deployment example.',
    competencies: [
        comp('devops_engineer', 'cicd_pipelines', 'CI/CD Pipelines', 'قياس بناء وتحسين pipelines.', ['build', 'test', 'deploy'], ['يدوي بالكامل'], ['اسأل عن فشل pipeline']),
        comp('devops_engineer', 'infra_as_code', 'Infrastructure as Code', 'قياس Terraform/K8s.', ['terraform', 'modules', 'review'], ['تغيير يدوي'], ['كيف تتحقق قبل apply']),
        comp('devops_engineer', 'observability', 'Observability', 'قياس logs/metrics/traces.', ['alert', 'dashboard', 'on-call'], ['لا مراقبة'], ['مثال incident']),
        comp('devops_engineer', 'incident_response', 'Incident Response', 'قياس التعامل مع الحوادث.', ['root cause', 'rollback', 'postmortem'], ['لا تحليل'], ['شنو السبب الجذري']),
        comp('devops_engineer', 'security_ops', 'Security in Ops', 'قياس أسرار وصلاحيات.', ['secrets', 'RBAC', 'least privilege'], ['صلاحيات مفرطة'], ['rotate secrets']),
        comp('devops_engineer', 'collaboration', 'Dev Collaboration', 'قياس دعم الفرق.', ['self-service', 'docs', 'review'], ['عزلة'], ['كيف خفّفت على المطورين']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي pipeline أو بنية تحتية حسّنتها — شنو المشكلة وشنو النتيجة؟',
        'شلون تتعامل مع حادث إنتاج — شنو خطواتك من الاكتشاف للحل؟',
        'اذكرلي قرار استخدمت بيه Terraform أو Kubernetes وشنو المقايضة؟',
    ],
    supportedExperienceTracks: devopsTracks(),
    interviewPaths: [{
        pathKey: 'devops_incident',
        preferredTracks: FIELD_TRACKS,
        steps: [
            { stepKey: 'context', clusterKey: 'context', topicLabel: 'Context', sampleQuestion: 'شنو النظام أو الخدمة؟' },
            { stepKey: 'detect', competencyKey: 'observability', clusterKey: 'observability', topicLabel: 'Detect', sampleQuestion: 'شلون اكتشفت المشكلة؟' },
            { stepKey: 'cicd', competencyKey: 'cicd_pipelines', clusterKey: 'cicd', topicLabel: 'CI/CD', sampleQuestion: 'شلون pipeline ساعد أو تأثر؟' },
            { stepKey: 'fix', competencyKey: 'incident_response', clusterKey: 'incident', topicLabel: 'Fix', sampleQuestion: 'شنو الإجراء؟' },
            { stepKey: 'iac', competencyKey: 'infra_as_code', clusterKey: 'iac', topicLabel: 'IaC', sampleQuestion: 'هل Terraform/K8s لعب دور؟' },
            { stepKey: 'prevent', competencyKey: 'security_ops', clusterKey: 'prevent', topicLabel: 'Prevent', sampleQuestion: 'شنو منعت التكرار؟' },
            { stepKey: 'postmortem', topicLabel: 'Postmortem', sampleQuestion: 'شنو تعلمت من الحادث؟' },
        ],
    }],
});

export const DATA_ANALYST = mkPack({
    packKey: 'data_analyst',
    roleKey: 'data_analyst',
    domain: 'technology',
    specialization: 'Data Analysis',
    roleAliases: ['data analyst', 'business analyst data', 'محلل بيانات', 'تحليل بيانات'],
    excludeKeywords: ['data scientist only', 'ml engineer', 'recruiter', 'petroleum'],
    matchKeywords: ['data analyst', 'sql', 'dashboard', 'power bi', 'tableau', 'metrics', 'kpi', 'بيانات', 'تحليل'],
    terminology: [
        'SQL', 'Excel', 'Power BI', 'Tableau', 'ETL', 'data quality', 'KPI', 'cohort',
        'funnel', 'A/B test', 'dashboard', 'stakeholder', 'variance', 'data validation',
        'sampling', 'visualization', 'root cause',
    ],
    domainGuidance:
        'Domain: Data Analysis. Probe SQL, dashboards, business questions, data quality, and recommendations with numbers. Weak: charts without insight.',
    competencies: [
        comp('data_analyst', 'sql_analysis', 'SQL & Data Querying', 'قياس استخراج وتحليل البيانات.', ['joins', 'aggregates', 'filters'], ['لا SQL'], ['اسأل عن استعلام معقد']),
        comp('data_analyst', 'metrics_definition', 'Metrics & KPIs', 'قياس تعريف مؤشرات صحيحة.', ['KPI', 'definition', 'baseline'], ['مؤشرات غامضة'], ['ليش اخترت المؤشر']),
        comp('data_analyst', 'visualization', 'Visualization & Storytelling', 'قياس عرض البيانات.', ['dashboard', 'chart choice', 'insight'], ['رسم بلا رسالة'], ['شنو القرار من الرسم']),
        comp('data_analyst', 'data_quality', 'Data Quality', 'قياس التحقق من البيانات.', ['validation', 'anomaly', 'source'], ['يثق بلا فحص'], ['مثال بيانات خاطئة']),
        comp('data_analyst', 'stakeholder', 'Stakeholder Communication', 'قياس شرح لغير تقني.', ['summary', 'recommendation'], ['تعقيد'], ['كيف قنعت الإدارة']),
        comp('data_analyst', 'business_impact', 'Business Impact', 'قياس ربط التحليل بالقرار.', ['before/after', 'action'], ['لا توصية'], ['شنو تغيّر']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي تحليل بيانات أثر على قرار — شنو السؤال وشنو النتيجة؟',
        'شلون تتأكد من جودة البيانات قبل ما تقدم تقرير؟',
        'اذكرلي dashboard أو KPI تابعته — شنو اللي اكتشفته؟',
    ],
    supportedExperienceTracks: dataAnalystTracks(),
    interviewPaths: [{
        pathKey: 'data_insight',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'question', clusterKey: 'question', topicLabel: 'Question', sampleQuestion: 'شنو سؤال العمل؟' },
            { stepKey: 'data', competencyKey: 'sql_analysis', clusterKey: 'sql', topicLabel: 'Data', sampleQuestion: 'شنو البيانات والاستعلام؟' },
            { stepKey: 'quality', competencyKey: 'data_quality', clusterKey: 'quality', topicLabel: 'Quality', sampleQuestion: 'شلون تحققت من جودة البيانات؟' },
            { stepKey: 'metrics', competencyKey: 'metrics_definition', clusterKey: 'metrics', topicLabel: 'Metrics', sampleQuestion: 'شنو KPI أو المؤشر؟' },
            { stepKey: 'insight', competencyKey: 'visualization', clusterKey: 'viz', topicLabel: 'Insight', sampleQuestion: 'شنو الاستنتاج؟' },
            { stepKey: 'stakeholder', competencyKey: 'stakeholder', clusterKey: 'stakeholder', topicLabel: 'Stakeholder', sampleQuestion: 'شلون شرحت لغير تقني؟' },
            { stepKey: 'action', competencyKey: 'business_impact', clusterKey: 'action', topicLabel: 'Action', sampleQuestion: 'شنو القرار أو التأثير؟' },
        ],
    }],
});

export const QA_ENGINEER = mkPack({
    packKey: 'qa_engineer',
    roleKey: 'qa_engineer',
    domain: 'technology',
    specialization: 'Software QA / Test Engineering',
    roleAliases: ['qa engineer', 'quality assurance engineer', 'software tester', 'مهندس ضمان جودة', 'فاحص برمجيات'],
    excludeKeywords: ['petroleum', 'hse qa', 'quality inspector manufacturing only', 'recruiter'],
    matchKeywords: ['qa engineer', 'test automation', 'selenium', 'cypress', 'regression', 'bug', 'جودة', 'اختبار'],
    terminology: [
        'test plan', 'test case', 'regression', 'automation', 'Selenium', 'Cypress',
        'API testing', 'Postman', 'bug report', 'repro steps', 'severity', 'priority',
        'CI test gate', 'exploratory testing', 'acceptance criteria',
    ],
    domainGuidance:
        'Domain: Software QA. Probe test strategy, automation, bug advocacy, and release quality — not manufacturing QC unless software context.',
    competencies: [
        comp('qa_engineer', 'test_strategy', 'Test Strategy', 'قياس تخطيط الاختبار.', ['scope', 'risk', 'priority'], ['اختبار عشوائي'], ['كيف تختار الحالات']),
        comp('qa_engineer', 'automation', 'Test Automation', 'قياس أتمتة مناسبة.', ['framework', 'maintainability'], ['أتمتة بلا هدف'], ['متى لا تؤتمت']),
        comp('qa_engineer', 'bug_reporting', 'Bug Reporting', 'قياس تقارير أعطال واضحة.', ['repro', 'severity', 'logs'], ['تقارير غامضة'], ['مثال bug حرج']),
        comp('qa_engineer', 'regression', 'Regression & Release', 'قياس جودة الإصدار.', ['regression suite', 'smoke'], ['لا regression'], ['قبل release شنو تسوي']),
        comp('qa_engineer', 'collaboration', 'Dev Collaboration', 'قياس العمل مع التطوير.', ['triage', 'acceptance'], ['صراع'], ['كيف تتفاوض على الأولوية']),
        comp('qa_engineer', 'exploratory', 'Exploratory Testing', 'قياس اكتشاف مشاكل غير متوقعة.', ['charter', 'edge cases'], ['سكربت فقط'], ['مثال edge case']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي مشكلة جودة اكتشفتها قبل الإطلاق — شنو أثرها لو ما انكشفت؟',
        'شلون تختار شنو تؤتمت وشنو تختبر يدوياً؟',
        'اذكرلي bug صعب — شلون وثّقته وتابعته للإغلاق؟',
    ],
    supportedExperienceTracks: qaTracks(),
    interviewPaths: [{
        pathKey: 'qa_release',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'release', clusterKey: 'release', topicLabel: 'Release', sampleQuestion: 'شنو الإصدار أو المنتج؟' },
            { stepKey: 'strategy', competencyKey: 'test_strategy', clusterKey: 'strategy', topicLabel: 'Strategy', sampleQuestion: 'شنو خطتك؟' },
            { stepKey: 'automation', competencyKey: 'automation', clusterKey: 'automation', topicLabel: 'Automation', sampleQuestion: 'شنو أتمتت وشنو يدوي؟' },
            { stepKey: 'bug', competencyKey: 'bug_reporting', clusterKey: 'bug', topicLabel: 'Bug', sampleQuestion: 'اذكرلي عطل مهم.' },
            { stepKey: 'regression', competencyKey: 'regression', clusterKey: 'regression', topicLabel: 'Regression', sampleQuestion: 'شلون regression قبل الإطلاق؟' },
            { stepKey: 'explore', competencyKey: 'exploratory', clusterKey: 'explore', topicLabel: 'Exploratory', sampleQuestion: 'شنو edge case اكتشفته؟' },
            { stepKey: 'outcome', clusterKey: 'outcome', topicLabel: 'Outcome', sampleQuestion: 'شنو النتيجة؟' },
        ],
    }],
});

export const CUSTOMER_SUPPORT = mkPack({
    packKey: 'customer_support',
    roleKey: 'customer_support_specialist',
    domain: 'business',
    specialization: 'Customer Support',
    roleAliases: ['customer support', 'customer service', 'help desk', 'دعم عملاء', 'خدمة عملاء'],
    excludeKeywords: ['software developer', 'devops', 'petroleum', 'recruiter', 'it support', 'active directory', 'network engineer'],
    matchKeywords: ['customer support', 'ticket', 'helpdesk', 'sla', 'csat', 'عميل', 'دعم', 'شكوى'],
    terminology: [
        'ticket', 'SLA', 'CSAT', 'NPS', 'escalation', 'knowledge base', 'first contact resolution',
        'CRM', 'Zendesk', 'empathy', 'de-escalation', 'root cause', 'follow-up', 'queue',
    ],
    domainGuidance:
        'Domain: Customer Support. Probe empathy, policy balance, escalation, and measurable service outcomes.',
    competencies: [
        comp('customer_support', 'ticket_handling', 'Ticket Handling', 'قياس إدارة التذاكر.', ['triage', 'priority', 'documentation'], ['فوضى'], ['مثال تذكرة صعبة']),
        comp('customer_support', 'empathy', 'Empathy & De-escalation', 'قياس التعامل مع الغضب.', ['listen', 'tone', 'solution'], ['تصعيد'], ['كيف هديت العميل']),
        comp('customer_support', 'policy_balance', 'Policy vs Customer Need', 'قياس التوازن.', ['policy', 'exception', 'approval'], ['تجاوز عشوائي'], ['متى صعدت']),
        comp('customer_support', 'escalation', 'Escalation', 'قياس التصعيد الصحيح.', ['when', 'info pack', 'follow-up'], ['تصعيد متأخر'], ['شنو أرسلت للفريق']),
        comp('customer_support', 'product_knowledge', 'Product Knowledge', 'قياس فهم المنتج.', ['features', 'workaround'], ['لا يعرف'], ['كيف تتعلم منتج جديد']),
        comp('customer_support', 'metrics', 'Support Metrics', 'قياس CSAT/SLA.', ['FCR', 'CSAT', 'response time'], ['لا مؤشرات'], ['شنو حسّنت']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي شكوى عميل صعبة — شنو سويت وشنو النتيجة؟',
        'شلون توازن بين سياسة الشركة ورغبة العميل؟',
        'اذكرلي موقف اضطررت تصعّد فيه التذكرة — شنو الخطوات؟',
    ],
    supportedExperienceTracks: customerSupportTracks(),
    interviewPaths: [{
        pathKey: 'support_case',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'case', topicLabel: 'Case', sampleQuestion: 'شنو المشكلة؟' },
            { stepKey: 'empathy', competencyKey: 'empathy', topicLabel: 'Empathy', sampleQuestion: 'شلون تعاملت مع غضب أو إحباط العميل؟' },
            { stepKey: 'policy', competencyKey: 'policy_balance', topicLabel: 'Policy', sampleQuestion: 'شلون وازنت بين السياسة وحاجة العميل؟' },
            { stepKey: 'handle', competencyKey: 'ticket_handling', topicLabel: 'Handle', sampleQuestion: 'شنو خطوات التذكرة والتوثيق؟' },
            { stepKey: 'escalate', competencyKey: 'escalation', topicLabel: 'Escalation', sampleQuestion: 'متى صعدت وشنو أرسلت؟' },
            { stepKey: 'product', competencyKey: 'product_knowledge', topicLabel: 'Product', sampleQuestion: 'شلون استخدمت معرفة المنتج بالحل؟' },
            { stepKey: 'metric', competencyKey: 'metrics', topicLabel: 'Metric', sampleQuestion: 'شنو أثر على رضا العميل أو SLA؟' },
        ],
    }],
});

export const OPERATIONS_COORDINATOR = mkPack({
    packKey: 'operations_coordinator',
    roleKey: 'operations_manager',
    domain: 'business',
    specialization: 'Operations Coordination',
    roleAliases: [
        'operations coordinator', 'operations specialist', 'operations supervisor',
        'منسق عمليات', 'أخصائي عمليات',
    ],
    excludeKeywords: ['devops', 'software', 'petroleum field', 'recruiter'],
    matchKeywords: ['operations', 'coordinator', 'scheduling', 'vendor', 'process improvement', 'عمليات', 'تنسيق'],
    terminology: [
        'SOP', 'KPI', 'vendor management', 'scheduling', 'inventory', 'workflow',
        'bottleneck', 'SLA', 'cross-functional', 'reporting', 'continuous improvement',
        'resource planning', 'escalation', 'standardization',
    ],
    domainGuidance:
        'Domain: Business Operations. Probe coordination, vendors, schedules, and process fixes with measurable outcomes — not software DevOps.',
    competencies: [
        comp('operations_coordinator', 'process_coordination', 'Process Coordination', 'قياس تنسيق العمليات.', ['workflow', 'handoff', 'SOP'], ['فوضى'], ['مثال bottleneck']),
        comp('operations_coordinator', 'vendor_mgmt', 'Vendor Management', 'قياس التعامل مع الموردين.', ['SLA', 'follow-up', 'issue'], ['لا متابعة'], ['مورد فشل شنو سويت']),
        comp('operations_coordinator', 'scheduling', 'Scheduling & Priorities', 'قياس الأولويات.', ['priority', 'deadline', 'resource'], ['لا أولويات'], ['يوم مزدحم شنو تسوي']),
        comp('operations_coordinator', 'reporting', 'Reporting & KPIs', 'قياس التقارير.', ['KPI', 'dashboard', 'variance'], ['لا أرقام'], ['شنو المؤشر']),
        comp('operations_coordinator', 'problem_solving', 'Operational Problem Solving', 'قياس حل مشاكل تشغيلية.', ['root cause', 'action'], ['ترقيع'], ['مثال تحسين']),
        comp('operations_coordinator', 'stakeholder', 'Stakeholder Alignment', 'قياس التوافق.', ['meeting', 'alignment'], ['صمت'], ['خلاف أقسام']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي عملية أو تدفق عمل حسّنته — شنو كان الخلل وشنو النتيجة؟',
        'شلون تنسّق بين فرق أو موردين لما يصير ضغط على الجدول؟',
        'اذكرلي مؤشر عمليات تتابعه دايماً — ليش اخترته؟',
    ],
    supportedExperienceTracks: operationsCoordinatorTracks(),
    interviewPaths: [{
        pathKey: 'ops_improvement',
        preferredTracks: FIELD_TRACKS,
        steps: [
            { stepKey: 'process', topicLabel: 'Process', sampleQuestion: 'شنو العملية؟' },
            { stepKey: 'issue', competencyKey: 'problem_solving', topicLabel: 'Issue', sampleQuestion: 'شنو المشكلة أو الاختناق؟' },
            { stepKey: 'vendor', competencyKey: 'vendor_mgmt', topicLabel: 'Vendor', sampleQuestion: 'هل المورد أو SLA كان جزء من المشكلة؟' },
            { stepKey: 'schedule', competencyKey: 'scheduling', topicLabel: 'Schedule', sampleQuestion: 'شلون أعدت الأولويات والجدول؟' },
            { stepKey: 'action', competencyKey: 'process_coordination', topicLabel: 'Action', sampleQuestion: 'شنو سويت لتنسيق الفرق؟' },
            { stepKey: 'kpi', competencyKey: 'reporting', topicLabel: 'KPI', sampleQuestion: 'شنو المؤشر قبل/بعد؟' },
            { stepKey: 'stakeholder', competencyKey: 'stakeholder', topicLabel: 'Stakeholder', sampleQuestion: 'شلون أبلغت أصحاب المصلحة؟' },
        ],
    }],
});

export const ACCOUNTS_PAYABLE = mkPack({
    packKey: 'accounts_payable',
    roleKey: 'accounts_payable',
    domain: 'business',
    specialization: 'Accounts Payable',
    roleAliases: ['accounts payable', 'ap officer', 'payables', 'ذمم دائنة', 'حسابات دائنة'],
    excludeKeywords: ['accounts receivable', 'receivable', 'ar officer', 'ذمم مدينة', 'recruiter', 'software developer'],
    matchKeywords: ['accounts payable', 'invoice', 'vendor payment', 'three-way match', 'ذمم', 'فواتير', 'موردين'],
    terminology: [
        'three-way match', 'invoice processing', 'purchase order', 'GRN', 'payment run',
        'vendor statement', 'reconciliation', 'accruals', 'duplicate payment', 'approval workflow',
        'ERP', 'aging', 'cut-off', 'SOX control',
    ],
    domainGuidance:
        'Domain: Accounts Payable. Probe invoice validation, 3-way match, controls, and vendor reconciliation.',
    competencies: [
        comp('accounts_payable', 'invoice_processing', 'Invoice Processing', 'قياس معالجة الفواتير.', ['PO', 'GRN', 'match'], ['دفع بلا تحقق'], ['مثال عدم مطابقة']),
        comp('accounts_payable', 'controls', 'Financial Controls', 'قياس الضوابط.', ['approval', 'segregation', 'SOX'], ['تجاوز'], ['ضابط منع خطأ']),
        comp('accounts_payable', 'reconciliation', 'Vendor Reconciliation', 'قياس مطابقة الموردين.', ['statement', 'variance'], ['فروقات معلقة'], ['فرق كبير']),
        comp('accounts_payable', 'payment_runs', 'Payment Runs', 'قياس دورات الدفع.', ['cut-off', 'batch', 'priority'], ['تأخير'], ['ضغط نهاية شهر']),
        comp('accounts_payable', 'erp_tools', 'ERP & Tools', 'قياس أنظمة AP.', ['ERP', 'workflow'], ['يدوي كامل'], ['أتمتة']),
        comp('accounts_payable', 'communication', 'Vendor Communication', 'قياس التواصل.', ['dispute', 'documentation'], ['صراع'], ['نزاع مورد']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي فاتورة أو دفعة اكتشفت فيها خطأ — شنو سويت؟',
        'شلون تسوي three-way match عملياً قبل ما توافق على الدفع؟',
        'اذكرلي نهاية شهر ضاغطة — شلون ضليت الدقة والموعد؟',
    ],
    supportedExperienceTracks: accountsPayableTracks(),
    interviewPaths: [{
        pathKey: 'ap_control',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'invoice', clusterKey: 'invoice', topicLabel: 'Invoice', sampleQuestion: 'شنو الحالة؟' },
            { stepKey: 'check', competencyKey: 'invoice_processing', clusterKey: 'match', topicLabel: 'Check', sampleQuestion: 'شنو فحصت؟' },
            { stepKey: 'three_way', competencyKey: 'invoice_processing', clusterKey: 'three_way', topicLabel: '3-way match', sampleQuestion: 'شلون three-way match؟' },
            { stepKey: 'control', competencyKey: 'controls', clusterKey: 'control', topicLabel: 'Control', sampleQuestion: 'شنو الضابط؟' },
            { stepKey: 'reconcile', competencyKey: 'reconciliation', clusterKey: 'reconcile', topicLabel: 'Reconcile', sampleQuestion: 'شلون مطابقة المورد؟' },
            { stepKey: 'payment', competencyKey: 'payment_runs', clusterKey: 'payment', topicLabel: 'Payment', sampleQuestion: 'شلون دورة الدفع؟' },
            { stepKey: 'outcome', clusterKey: 'outcome', topicLabel: 'Outcome', sampleQuestion: 'شنو النتيجة؟' },
        ],
    }],
});

export const FINANCIAL_ANALYST = mkPack({
    packKey: 'financial_analyst',
    roleKey: 'financial_analyst',
    domain: 'business',
    specialization: 'Financial Analysis',
    roleAliases: ['financial analyst', 'finance analyst', 'محلل مالي', 'تحليل مالي'],
    excludeKeywords: ['data analyst only', 'accountant only', 'recruiter'],
    matchKeywords: ['financial analyst', 'forecast', 'budget', 'variance', 'fp&a', 'نماذج مالية', 'توقعات'],
    terminology: [
        'FP&A', 'budget', 'forecast', 'variance analysis', 'P&L', 'cash flow',
        'sensitivity', 'scenario planning', 'Excel model', 'drivers', 'KPI',
        'month-end', 'management report', 'working capital',
    ],
    domainGuidance:
        'Domain: Financial Analysis. Probe models, variance, forecasts, and recommendations with numbers.',
    competencies: [
        comp('financial_analyst', 'modeling', 'Financial Modeling', 'قياس بناء نماذج.', ['drivers', 'assumptions', 'scenarios'], ['أرقام بلا منطق'], ['حساسية']),
        comp('financial_analyst', 'variance', 'Variance Analysis', 'قياس تحليل الانحراف.', ['budget vs actual', 'root cause'], ['وصف فقط'], ['أكبر variance']),
        comp('financial_analyst', 'forecasting', 'Forecasting', 'قياس التوقعات.', ['rolling forecast', 'update'], ['توقع ثابت'], ['تغيّر التوقع ليش']),
        comp('financial_analyst', 'reporting', 'Management Reporting', 'قياس تقارير الإدارة.', ['pack', 'story', 'KPI'], ['جداول فقط'], ['توصية']),
        comp('financial_analyst', 'business_partner', 'Business Partnering', 'قياس شراكة الأعمال.', ['stakeholder', 'influence'], ['عزلة'], ['قرار أثر']),
        comp('financial_analyst', 'data_integrity', 'Data Integrity', 'قياس دقة البيانات.', ['source', 'reconciliation'], ['أخطاء'], ['خطأ اكتشفته']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي تحليل variance أثر على قرار — شنو السبب والرقم؟',
        'شلون تبني أو تحدّث توقعات مالية لربع أو سنة؟',
        'اذكرلي نموذج مالي — شنو أهم افتراضاته؟',
    ],
    supportedExperienceTracks: financialAnalystTracks(),
    interviewPaths: [{
        pathKey: 'fpna_cycle',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'period', clusterKey: 'period', topicLabel: 'Period', sampleQuestion: 'شنو الفترة أو القسم؟' },
            { stepKey: 'data', competencyKey: 'data_integrity', clusterKey: 'data', topicLabel: 'Data', sampleQuestion: 'شنو مصدر البيانات وكيف تحققت؟' },
            { stepKey: 'variance', competencyKey: 'variance', clusterKey: 'variance', topicLabel: 'Variance', sampleQuestion: 'شنو الانحراف؟' },
            { stepKey: 'driver', competencyKey: 'modeling', clusterKey: 'driver', topicLabel: 'Driver', sampleQuestion: 'شنو السبب أو الافتراض؟' },
            { stepKey: 'forecast', competencyKey: 'forecasting', clusterKey: 'forecast', topicLabel: 'Forecast', sampleQuestion: 'شلون تأثرت التوقعات؟' },
            { stepKey: 'report', competencyKey: 'reporting', clusterKey: 'report', topicLabel: 'Report', sampleQuestion: 'شلون قدمت للإدارة؟' },
            { stepKey: 'recommend', competencyKey: 'business_partner', clusterKey: 'recommend', topicLabel: 'Recommend', sampleQuestion: 'شنو التوصية؟' },
        ],
    }],
});

export const INTERNAL_AUDITOR = mkPack({
    packKey: 'internal_auditor',
    roleKey: 'internal_auditor',
    domain: 'business',
    specialization: 'Internal Audit',
    roleAliases: ['internal auditor', 'audit officer', 'مدقق داخلي', 'تدقيق داخلي'],
    excludeKeywords: ['external audit only', 'recruiter', 'qa engineer software'],
    matchKeywords: ['internal audit', 'controls', 'compliance', 'sampling', 'finding', 'تدقيق', 'رقابة'],
    terminology: [
        'risk assessment', 'control testing', 'sampling', 'finding', 'recommendation',
        'follow-up', 'SOX', 'compliance', 'workpaper', 'evidence', 'materiality',
        'process walkthrough', 'remediation', 'IA charter',
    ],
    domainGuidance:
        'Domain: Internal Audit. Probe risk-based planning, control testing, findings, and follow-up — evidence-based.',
    competencies: [
        comp('internal_auditor', 'risk_assessment', 'Risk Assessment', 'قياس تقييم المخاطر.', ['inherent', 'residual', 'scope'], ['تدقيق عشوائي'], ['ليش اخترت العملية']),
        comp('internal_auditor', 'control_testing', 'Control Testing', 'قياس اختبار الضوابط.', ['design', 'operating', 'sample'], ['لا دليل'], ['ضعف ضابط']),
        comp('internal_auditor', 'findings', 'Findings & Recommendations', 'قياس صياغة الملاحظات.', ['criteria', 'condition', 'cause'], ['غامض'], ['مثال finding']),
        comp('internal_auditor', 'evidence', 'Evidence & Workpapers', 'قياس توثيق الأدلة.', ['workpaper', 'trace'], ['لا توثيق'], ['كيف تحققت']),
        comp('internal_auditor', 'follow_up', 'Follow-up', 'قياس متابعة المعالجة.', ['remediation', 'status'], ['يسقط المتابعة'], ['إغلاق ملاحظة']),
        comp('internal_auditor', 'communication', 'Stakeholder Communication', 'قياس التواصل مع الإدارة.', ['interview', 'tact'], ['مواجهة'], ['مقاومة إدارة']),
    ],
    suggestedAnchorQuestions: [
        'اذكرلي تدقيق أو مراجعة ضوابط — شنو اكتشفت وشنو التوصية؟',
        'شلون تختار عينة أو نطاق مراجعة بناءً على المخاطر؟',
        'اذكرلي ملاحظة متابعةتها لحد الإغلاق — شنو كان التحدي؟',
    ],
    supportedExperienceTracks: internalAuditorTracks(),
    interviewPaths: [{
        pathKey: 'audit_engagement',
        preferredTracks: [...ACADEMIC_TRACKS, ...FIELD_TRACKS],
        steps: [
            { stepKey: 'scope', competencyKey: 'risk_assessment', clusterKey: 'scope', topicLabel: 'Scope', sampleQuestion: 'شنو نطاق المراجعة؟' },
            { stepKey: 'risk', competencyKey: 'risk_assessment', clusterKey: 'risk', topicLabel: 'Risk', sampleQuestion: 'شلون قيّمت المخاطر؟' },
            { stepKey: 'walkthrough', competencyKey: 'control_testing', clusterKey: 'walkthrough', topicLabel: 'Walkthrough', sampleQuestion: 'شلون walkthrough للعملية؟' },
            { stepKey: 'test', competencyKey: 'control_testing', clusterKey: 'test', topicLabel: 'Test', sampleQuestion: 'شلون اختبرت الضابط؟' },
            { stepKey: 'evidence', competencyKey: 'evidence', clusterKey: 'evidence', topicLabel: 'Evidence', sampleQuestion: 'شنو الأدلة اللي جمعتها؟' },
            { stepKey: 'finding', competencyKey: 'findings', clusterKey: 'finding', topicLabel: 'Finding', sampleQuestion: 'شنو الملاحظة؟' },
            { stepKey: 'follow', competencyKey: 'follow_up', clusterKey: 'follow', topicLabel: 'Follow-up', sampleQuestion: 'شنو المعالجة؟' },
        ],
    }],
});

export const WAVE_2_PACKS: DomainPack[] = [
    FRONTEND_DEVELOPER,
    DEVOPS_ENGINEER,
    DATA_ANALYST,
    QA_ENGINEER,
    CUSTOMER_SUPPORT,
    OPERATIONS_COORDINATOR,
    ACCOUNTS_PAYABLE,
    FINANCIAL_ANALYST,
    INTERNAL_AUDITOR,
];
