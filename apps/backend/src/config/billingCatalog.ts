/**
 * Central billing catalog — backend-owned public + internal views.
 *
 * Source data: billingPlans.ts, videoPacks.ts, stripePrices.ts, CREDIT_COST_MICRO.
 * Frontend should prefer GET /api/billing/catalog/public over the static mirror.
 */

import { BILLING_PLANS } from './billingPlans.js';
import { VIDEO_PACK_MINUTES, VIDEO_PACK_PRICE_USD } from './videoPacks.js';
import { getStripePriceId } from './stripePrices.js';
import { LAUNCH_PROMO, launchPromoBonus } from './launchPromo.js';
import { planAllowsVideo } from '../services/billingEngine.js';
import { CREDIT_COST_MICRO, MICRO_PER_CREDIT } from '../types/billing.js';
import type { BillingPlanId } from '../types/billing.js';

/**
 * Public usage cost rows (matches frontend USAGE_CREDIT_COSTS).
 * يعرض ما يُحصَّل فعلاً فقط:
 *  - voice: 15/دقيقة (VOICE_SECONDS)
 *  - search: 6/مرشح (SEARCH_CANDIDATE)
 *  - screening: 2/عملية (فرز المرشحين) — ظاهر في شريط التسعير
 *  - compare_candidate: 2/مرشح في تقرير أفضل المرشحين
 *  - cv_analysis: 2/سيرة (routes/cvComparison.ts)
 *  - job_ad: 1/توليد (routes/recruitmentCampaigns.ts /generate-ad)
 * مخفي من الشريط العام: contact_reveal، compare_email (ما زال التحصيل الفعلي قائماً).
 */
const PUBLIC_USAGE_COSTS = [
    { id: 'voice', credits: 15, labelKey: 'pricing_usage_voice', unitKey: 'pricing_usage_unit_per_minute' },
    { id: 'search', credits: 6, labelKey: 'pricing_usage_search', unitKey: 'pricing_usage_unit_per_candidate' },
    { id: 'screening', credits: 2, labelKey: 'pricing_usage_screening', unitKey: 'pricing_usage_unit_per_action' },
    { id: 'compare_candidate', credits: 2, labelKey: 'pricing_usage_compare_candidate', unitKey: 'pricing_usage_unit_per_candidate' },
    { id: 'cv_analysis', credits: 2, labelKey: 'pricing_usage_cv_analysis', unitKey: 'pricing_usage_unit_per_candidate' },
    { id: 'job_ad', credits: 1, labelKey: 'pricing_usage_job_ad', unitKey: 'pricing_usage_unit_per_action' },
] as const;

export function buildPublicBillingCatalog() {
    return {
        apiVersion: 1,
        billingCycle: 'monthly' as const,
        plans: BILLING_PLANS.filter((plan) => !plan.flags?.hidden).map((plan) => ({
            id: plan.id,
            displayNameKey: plan.displayNameKey,
            displayDescKey: plan.displayDescKey,
            price: plan.price,
            monthlyCredits: plan.monthlyCredits + launchPromoBonus(plan.id),
            promo: launchPromoBonus(plan.id) > 0
                ? { bonus: launchPromoBonus(plan.id), baseCredits: plan.monthlyCredits, labelKey: LAUNCH_PROMO.labelKey }
                : null,
            includedVideoMinutes: plan.includedVideoMinutes ?? 0,
            features: [...plan.features],
            flags: plan.flags ?? {},
            videoPack: planAllowsVideo(plan.id)
                ? {
                      minutes: VIDEO_PACK_MINUTES,
                      priceUsd: VIDEO_PACK_PRICE_USD[plan.id],
                  }
                : null,
            checkout: {
                monthlyConfigured: Boolean(getStripePriceId(plan.id, 'monthly')),
            },
        })),
        usageCosts: PUBLIC_USAGE_COSTS.map((row) => ({ ...row })),
    };
}

/** Whole credits per minute for video metering (after included minutes). */
export function videoCreditsPerMinute(): number {
    return CREDIT_COST_MICRO.VIDEO_SECONDS * 60 / MICRO_PER_CREDIT;
}

export function isOfficialPlanId(value: unknown): value is BillingPlanId {
    return typeof value === 'string' && BILLING_PLANS.some((p) => p.id === value);
}
