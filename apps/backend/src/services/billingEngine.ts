/**
 * Billing Engine — Single Source of Truth for billing decisions.
 *
 * Read-only catalog helpers + unified-credit cost math. No DB writes, no Stripe.
 * All decisions are pure functions over BILLING_PLANS + CREDIT_COST_MICRO.
 *
 * Boundaries:
 *   - This file owns ALL billing logic.
 *   - `config/billingPlans.ts` owns DATA only.
 *   - Frontend NEVER imports this file; frontend reads `billingPlans.js` mirror
 *     and uses `utils/billingDisplay.js` for formatting only.
 */

import { BILLING_PLANS } from '../config/billingPlans.js';
import { VIDEO_PACK_MINUTES, VIDEO_PACK_PRICE_USD } from '../config/videoPacks.js';
import { launchPromoBonus } from '../config/launchPromo.js';
import type {
    BillingFeature,
    BillingPlan,
    BillingPlanId,
    SeatLimit,
    UsageType,
} from '../types/billing.js';
import { CREDIT_COST_MICRO } from '../types/billing.js';

/** Maps a metered usage type to the catalog feature gate that must be enabled. */
export function featureForUsageType(usageType: UsageType): BillingFeature {
    switch (usageType) {
        case 'VOICE_SECONDS':
            return 'interviews.voice';
        case 'VIDEO_SECONDS':
            return 'interviews.video';
        case 'SEARCH_CANDIDATE':
            return 'search.headhunter';
        case 'SCREENING':
            return 'screening.basic';
        case 'CV_ANALYSIS':
            return 'screening.basic';
        case 'TOP_CANDIDATES':
            return 'reports.ai_scoring';
        case 'JOB_AD':
            return 'jobs.display';
        case 'CONTACT_REVEAL':
            return 'search.headhunter';
        case 'COMPARE_EMAIL':
            return 'reports.ai_scoring';
        case 'CRITERIA_SUGGESTION':
            return 'jobs.display';
        default: {
            const _exhaustive: never = usageType;
            return _exhaustive;
        }
    }
}

/**
 * Cost (in microCredits) of `units` of `usageType`.
 *   - units = seconds for VOICE/VIDEO interviews
 *   - units = operation count for the rest
 * Ceil so partial units never undercharge.
 */
export function creditCostMicro(usageType: UsageType, units: number): number {
    const perUnit = CREDIT_COST_MICRO[usageType];
    const safeUnits = Number.isFinite(units) && units > 0 ? units : 0;
    return Math.ceil(perUnit * safeUnits);
}

export function getPlanById(id: BillingPlanId): BillingPlan | undefined {
    return BILLING_PLANS.find((p) => p.id === id);
}

/** Returns plans in canonical display order: starter → team → professional → business. */
export function listPlans(): BillingPlan[] {
    return BILLING_PLANS.slice();
}

export function planHasFeature(planId: BillingPlanId, feature: BillingFeature): boolean {
    const plan = getPlanById(planId);
    return plan ? plan.features.includes(feature) : false;
}

export function listFeaturesForPlan(planId: BillingPlanId): BillingFeature[] {
    const plan = getPlanById(planId);
    return plan ? plan.features.slice() : [];
}

/** Monthly unified credit allowance (whole credits) for a plan, incl. any active launch promo. */
export function getMonthlyCredits(planId: BillingPlanId): number {
    const plan = getPlanById(planId);
    return plan ? plan.monthlyCredits + launchPromoBonus(planId) : 0;
}

/** Monthly included video minutes for a plan (0 when none, e.g. Starter). */
export function getIncludedVideoMinutes(planId: BillingPlanId): number {
    const plan = getPlanById(planId);
    return plan ? plan.includedVideoMinutes ?? 0 : 0;
}

/** Monthly included video seconds for a plan (minutes * 60). */
export function getIncludedVideoSeconds(planId: BillingPlanId): number {
    return getIncludedVideoMinutes(planId) * 60;
}

/** True when the plan includes the video interview feature (Team and above). */
export function planAllowsVideo(planId: BillingPlanId): boolean {
    return planHasFeature(planId, 'interviews.video');
}

/** Minutes granted by a single extra video pack (plan-independent). */
export function getVideoPackMinutes(): number {
    return VIDEO_PACK_MINUTES;
}

/** Display price (USD) of one extra video pack for a plan; null when not offered. */
export function getVideoPackPriceUsd(planId: BillingPlanId): number | null {
    return VIDEO_PACK_PRICE_USD[planId] ?? null;
}

export function getSeatLimit(planId: BillingPlanId): SeatLimit | undefined {
    const plan = getPlanById(planId);
    return plan ? plan.seatLimit : undefined;
}
