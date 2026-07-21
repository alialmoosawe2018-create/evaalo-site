/**
 * Billing plans catalog — frontend data mirror.
 *
 * Keep in sync with apps/backend/src/config/billingPlans.ts (manual sync).
 *
 * Architecture rule: this file is DATA ONLY. Display formatting lives in
 * `utils/billingDisplay.js`, UI grouping lives in `utils/billingFeatureGroups.js`.
 * Frontend NEVER imports the backend engine — read mirror only.
 *
 * Unified credit model: a single monthly intelligence-credit pool per plan.
 */

const SEAT_LIMIT_SINGLE = Object.freeze({ type: 'fixed', value: 1 });

const STARTER_FEATURES = Object.freeze([
    'screening.basic',
    'screening.cv_compare',
    'interviews.voice',
    'search.headhunter',
    'jobs.display',
    'jobs.publish',
    'reports.ai_scoring',
    'ads.basic',
    'voice.default',
]);

const TEAM_FEATURES = Object.freeze([
    ...STARTER_FEATURES,
    'interviews.video',
    'interviews.privateLinks',
    'voice.identity.customization',
]);

const PROFESSIONAL_FEATURES = Object.freeze([
    ...TEAM_FEATURES,
    'screening.advanced',
    'avatar.branding',
]);

const BUSINESS_FEATURES = Object.freeze([
    ...PROFESSIONAL_FEATURES,
    'avatar.branding',
    'integrations.custom',
    'support.priority',
]);

export const BILLING_PLANS = Object.freeze([
    Object.freeze({
        // باقة تجريبية مجانية — تُمنح تلقائياً للحسابات الجديدة (150 كردت لمرة
        // واحدة). مخفية من صفحات التسعير وقوائم الترقية.
        id: 'free',
        displayNameKey: 'billing_plan_free_name',
        displayDescKey: 'billing_plan_free_desc',
        price: Object.freeze({ monthly: 0, currency: 'USD' }),
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 150,
        includedVideoMinutes: 0,
        features: STARTER_FEATURES,
        flags: Object.freeze({ hidden: true }),
    }),
    Object.freeze({
        id: 'starter',
        displayNameKey: 'billing_plan_starter_name',
        displayDescKey: 'pricing_tagline_starter',
        price: Object.freeze({ monthly: 39, currency: 'USD' }),
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 500,
        includedVideoMinutes: 0,
        features: STARTER_FEATURES,
        flags: Object.freeze({}),
    }),
    Object.freeze({
        id: 'team',
        displayNameKey: 'billing_plan_team_name',
        displayDescKey: 'pricing_tagline_team',
        price: Object.freeze({ monthly: 99, currency: 'USD' }),
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 1500,
        includedVideoMinutes: 50,
        features: TEAM_FEATURES,
        flags: Object.freeze({}),
    }),
    Object.freeze({
        id: 'professional',
        displayNameKey: 'billing_plan_professional_name',
        displayDescKey: 'pricing_tagline_professional',
        price: Object.freeze({ monthly: 189, currency: 'USD' }),
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 3500,
        includedVideoMinutes: 100,
        features: PROFESSIONAL_FEATURES,
        flags: Object.freeze({ popular: true }),
    }),
    Object.freeze({
        id: 'business',
        displayNameKey: 'billing_plan_business_name',
        displayDescKey: 'pricing_tagline_business',
        price: Object.freeze({ monthly: 359, currency: 'USD' }),
        seatLimit: SEAT_LIMIT_SINGLE,
        monthlyCredits: 7000,
        includedVideoMinutes: 150,
        features: BUSINESS_FEATURES,
        flags: Object.freeze({}),
    }),
]);

export const DEFAULT_PLAN_ID = 'starter';

/**
 * Per-operation credit costs — mirror of backend PUBLIC_USAGE_COSTS
 * (apps/backend/src/config/billingCatalog.ts). Keep in sync manually.
 * يعرض ما يُحصَّل فعلاً فقط: صوت 15/دقيقة، بحث 6/مرشح، فرز مرشحين 2،
 * تقرير أفضل المرشحين 2/مرشح، تحليل CV 2/عملية، وتوليد إعلان الوظيفة 1/توليد.
 * (كشف بيانات التواصل وتكلفة إيميل التقرير مخفيان من شريط التسعير العام.)
 */
export const USAGE_CREDIT_COSTS = Object.freeze([
    Object.freeze({ id: 'voice', credits: 15, labelKey: 'pricing_usage_voice', unitKey: 'pricing_usage_unit_per_minute' }),
    Object.freeze({ id: 'search', credits: 6, labelKey: 'pricing_usage_search', unitKey: 'pricing_usage_unit_per_candidate' }),
    Object.freeze({ id: 'screening', credits: 2, labelKey: 'pricing_usage_screening', unitKey: 'pricing_usage_unit_per_action' }),
    Object.freeze({ id: 'compare_candidate', credits: 2, labelKey: 'pricing_usage_compare_candidate', unitKey: 'pricing_usage_unit_per_candidate' }),
    Object.freeze({ id: 'cv_analysis', credits: 2, labelKey: 'pricing_usage_cv_analysis', unitKey: 'pricing_usage_unit_per_action' }),
    Object.freeze({ id: 'job_ad', credits: 1, labelKey: 'pricing_usage_job_ad', unitKey: 'pricing_usage_unit_per_action' }),
]);
