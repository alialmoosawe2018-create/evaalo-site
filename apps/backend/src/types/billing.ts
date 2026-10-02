/**
 * Billing types — single source of truth (backend).
 *
 * Architecture contract:
 *   types/billing.ts          → TYPES ONLY (this file)
 *   config/billingPlans.ts    → DATA ONLY (BILLING_PLANS constant)
 *   services/billingEngine.ts → ALL LOGIC (helpers, decisions)
 *
 * Frontend mirror lives at:
 *   apps/frontend/src/config/billingPlans.js   (data)
 *   apps/frontend/src/utils/billingDisplay.js  (display helpers only)
 *
 * Unified credit model:
 *   Each plan grants a single monthly pool of intelligence credits
 *   (`monthlyCredits`). Every metered service draws from that one pool.
 *   Internally the balance is tracked in microCredits (1 credit = 1e6 µ) so
 *   per-second interview billing stays exact.
 */

export type BillingPlanId = 'free' | 'starter' | 'team' | 'professional' | 'business';

/**
 * Metered usage types. Phase 1 wires VOICE_SECONDS + VIDEO_SECONDS at the
 * interview call sites. The remaining types are defined now (cost table below)
 * and wired to their own call sites in Phase 2.
 */
export type UsageType =
    | 'VOICE_SECONDS'
    | 'VIDEO_SECONDS'
    | 'SEARCH_CANDIDATE'
    | 'SCREENING'
    | 'TOP_CANDIDATES'
    | 'CV_ANALYSIS'
    | 'JOB_AD'
    | 'CONTACT_REVEAL'
    | 'COMPARE_EMAIL'
    | 'CRITERIA_SUGGESTION';

export type BillingFeature =
    | 'screening.basic'
    | 'screening.cv_compare'
    | 'screening.advanced'
    | 'interviews.voice'
    | 'interviews.video'
    | 'interviews.privateLinks'
    | 'search.headhunter'
    | 'jobs.display'
    | 'jobs.publish'
    | 'reports.ai_scoring'
    | 'ads.basic'
    | 'ads.campaigns'
    | 'voice.default'
    | 'voice.identity.customization'
    | 'voice.cloning'
    | 'avatar.branding'
    | 'recruitment.full'
    | 'api.access'
    | 'webhooks.inbound'
    | 'integrations.custom'
    | 'seats.management'
    | 'support.priority';

export type SeatLimit =
    | { type: 'fixed'; value: number }
    | { type: 'unlimited' };

export type PlanPrice =
    | { monthly: number; currency: 'USD' }
    | 'custom';

export type BillingPlan = {
    id: BillingPlanId;
    displayNameKey: string;
    displayDescKey: string;
    price: PlanPrice;
    seatLimit: SeatLimit;
    /** Monthly unified intelligence-credit allowance (whole credits). */
    monthlyCredits: number;
    /**
     * Monthly video minutes included with the plan, consumed before credits.
     * 0 (or undefined) means no included video (e.g. Starter has no video at all).
     */
    includedVideoMinutes?: number;
    features: BillingFeature[];
    flags?: {
        popular?: boolean;
        customCredits?: boolean;
        /** أخفِ الباقة من الكتالوج العام وقوائم الترقية (مثل free — تُمنح تلقائياً ولا تُشترى). */
        hidden?: boolean;
    };
};

// ────────────────────────────────────────────────────────────────────────────
// Unified credit accounting
// ────────────────────────────────────────────────────────────────────────────

/** Internal precision unit. 1 credit = 1,000,000 microCredits. */
export const MICRO_PER_CREDIT = 1_000_000;

/**
 * Exact video billing rate: 35 credits per minute, in microCredits.
 *
 * IMPORTANT: never derive a fixed per-second constant (e.g. round(35e6/60) =
 * 583,333) — that loses 20 µ/min and drifts over thousands of sessions. Always
 * compute against the whole duration:
 *   creditCostMicro       = ceil(creditSeconds  * VIDEO_CREDITS_PER_MINUTE_MICRO / 60)
 *   secondsCoveredByMicro = floor(availableMicro * 60 / VIDEO_CREDITS_PER_MINUTE_MICRO)
 */
export const VIDEO_CREDITS_PER_MINUTE_MICRO = 35_000_000;

/**
 * Cost per unit in microCredits.
 *   - VOICE_SECONDS / VIDEO_SECONDS → per second of interview.
 *   - everything else → per operation.
 *
 * Voice  = 15 credits/min = 250,000 µ/s.
 * Video  = 35 credits/min ≈ 583,333 µ/s.
 */
export const CREDIT_COST_MICRO: Record<UsageType, number> = {
    VOICE_SECONDS: (15 * MICRO_PER_CREDIT) / 60,
    VIDEO_SECONDS: Math.round((35 * MICRO_PER_CREDIT) / 60),
    SEARCH_CANDIDATE: 6 * MICRO_PER_CREDIT,
    // SCREENING يُحصَّل في موضعين: services/screeningBilling.ts (2/مرشح عند نجاح
    // تقييم Stage 1) وضمن تقرير أفضل المرشحين (لكل مرشح في الـ pool).
    SCREENING: 2 * MICRO_PER_CREDIT,
    // TOP_CANDIDATES غير مفعّل — لا موقع consumeCredits يستخدمه (تكلفة التقرير
    // الفعلية = COMPARE_EMAIL + SCREENING). يبقى لأن الـ enum مستخدم في الموديلات.
    TOP_CANDIDATES: 5 * MICRO_PER_CREDIT,
    // CV_ANALYSIS يُحصَّل في routes/cvComparison.ts (2/سيرة).
    CV_ANALYSIS: 2 * MICRO_PER_CREDIT,
    // JOB_AD يُحصَّل في routes/recruitmentCampaigns.ts /generate-ad (1/توليد).
    JOB_AD: 1 * MICRO_PER_CREDIT,
    // Per available contact piece (phone/email/linkedin) revealed.
    CONTACT_REVEAL: 1 * MICRO_PER_CREDIT,
    // Per recipient email of an AI compare report.
    COMPARE_EMAIL: 1 * MICRO_PER_CREDIT,
    // AI job-criteria suggestion — charged in routes/recruitmentCampaigns.ts /suggest-criteria (1/suggestion).
    CRITERIA_SUGGESTION: 1 * MICRO_PER_CREDIT,
};

// ────────────────────────────────────────────────────────────────────────────
// Runtime billing types
// ────────────────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'incomplete';

/** Checkout → webhook lifecycle for UI (Phase 3.4). */
export type SubscriptionLifecycleState =
    | 'requested'
    | 'checkout_created'
    | 'payment_pending'
    | 'payment_confirmed'
    | 'subscription_active';

export type BillingCycle = 'monthly' | 'annual';

export type BillingProvider = 'manual' | 'stripe';

export type LedgerSource =
    | 'video_interview'
    | 'voice_ws'
    | 'headhunter'
    | 'contact_reveal'
    | 'ai_compare_email'
    | 'screening'
    | 'cv_analysis'
    | 'job_ad'
    | 'criteria_suggestion'
    | 'manual_adjustment'
    | 'monthly_refresh'
    | 'topup'
    // One-time purchase of an extra video-minutes pack (separate from credits).
    | 'video_pack';

/** Public activity row for GET /api/billing/activity. */
export type BillingActivityEntry = {
    id: string;
    createdAt: string;
    usageType: UsageType;
    source: LedgerSource;
    units?: number;
    /** Whole credits charged (0 when covered by included video minutes). */
    credits: number;
    amountMicro: number;
};

export type ConsumeCreditsInput = {
    organizationId: string;
    usageType: UsageType;
    /** Units to bill: seconds for interviews, operation count for the rest. */
    units: number;
    idempotencyKey: string;
    source: LedgerSource;
    sourceId?: string;
    metadata?: Record<string, unknown>;
};

export type ConsumeCreditsErrorCode =
    | 'INSUFFICIENT_CREDITS'
    | 'FEATURE_DENIED'
    | 'INACTIVE_SUBSCRIPTION'
    | 'ORG_NOT_FOUND';

export type ConsumeCreditsResult =
    | {
          ok: true;
          balanceAfterMicro: number;
          ledgerEntryId: string;
          duplicate?: boolean;
      }
    | {
          ok: false;
          code: ConsumeCreditsErrorCode;
          message: string;
      };

export type AdjustCreditsInput = {
    organizationId: string;
    /** Signed microCredits to apply (positive grants, negative deducts). */
    amountMicro: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
};
