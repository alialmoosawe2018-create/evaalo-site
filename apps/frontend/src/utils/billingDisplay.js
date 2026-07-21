/**
 * Billing display helpers — frontend ONLY, format/lookup only.
 *
 * Allowed: data lookups, currency formatting, label suffixes, popular badge check.
 * Forbidden: multipliers, seat enforcement, credit deduction, anything that
 *            represents a billing decision. Decisions live in
 *            apps/backend/src/services/billingEngine.ts.
 *
 * This file MUST only import from `../config/billingPlans` and pure utils —
 * never from `apps/backend/**` or any backend engine path.
 */

import { BILLING_PLANS, DEFAULT_PLAN_ID, USAGE_CREDIT_COSTS } from '../config/billingPlans';
import { VIDEO_PACK_MINUTES, VIDEO_PACK_PRICE_USD } from '../config/videoPacks';

const ANNUAL_DISCOUNT = 0.8;

/** The video-interview feature gate (Team and above include video). */
const VIDEO_FEATURE = 'interviews.video';

/** Catalog feature replaced on pricing cards by the free-video-minutes row. */
const PRICING_VIDEO_FEATURE = VIDEO_FEATURE;

/** Billing features omitted from public plan cards (still enforced server-side). */
const PRICING_HIDDEN_FEATURES = new Set(['jobs.display', 'ads.basic']);

export function getPlanById(planId) {
    return BILLING_PLANS.find((p) => p.id === planId);
}

export function listPlans() {
    // الباقات المخفية (free) لا تظهر في بطاقات التسعير ولا قوائم الترقية.
    return BILLING_PLANS.filter((p) => !p.flags?.hidden);
}

/** Per-operation credit costs for public pricing display (highest credits first). */
const USAGE_COST_DISPLAY_ORDER = Object.freeze({
    voice: 0,
    search: 1,
    screening: 2,
    cv_analysis: 3,
    compare_candidate: 4,
    job_ad: 5,
    contact_reveal: 6,
});

export function listUsageCreditCosts() {
    return [...USAGE_CREDIT_COSTS].sort((a, b) => {
        if (b.credits !== a.credits) return b.credits - a.credits;
        return (USAGE_COST_DISPLAY_ORDER[a.id] ?? 99) - (USAGE_COST_DISPLAY_ORDER[b.id] ?? 99);
    });
}

export function planHasFeature(planId, feature) {
    const plan = getPlanById(planId);
    if (!plan) return false;
    return plan.features.includes(feature);
}

export function listFeaturesForPlan(planId) {
    const plan = getPlanById(planId);
    return plan ? plan.features.slice() : [];
}

/** Catalog tier order — used for incremental (delta-only) pricing display. */
const PLAN_TIER_ORDER = ['starter', 'team', 'professional', 'business'];

/** Previous catalog plan in the upgrade ladder, or null for Starter. */
export function getPreviousPlanId(planId) {
    const idx = PLAN_TIER_ORDER.indexOf(planId);
    if (idx <= 0) return null;
    return PLAN_TIER_ORDER[idx - 1];
}

/**
 * Features to show on the public pricing card: Starter lists everything; higher
 * tiers list only what they add over the previous plan (no repetition).
 */
export function listIncrementalFeaturesForPlan(planId) {
    const all = listFeaturesForPlan(planId);
    const previousPlanId = getPreviousPlanId(planId);
    if (!previousPlanId) return all;
    const previous = new Set(listFeaturesForPlan(previousPlanId));
    return all.filter((feature) => !previous.has(feature));
}

/** i18n key for the "everything in X, plus:" line above incremental features. */
export function getPricingIncludesKey(planId) {
    const previousPlanId = getPreviousPlanId(planId);
    if (!previousPlanId) return null;
    return `pricing_includes_previous_${previousPlanId}`;
}

/**
 * Build feature rows for plan cards (merges included video into one line).
 * Shared by Pricing page and AdjustPlanModal.
 */
export function buildPricingFeatureRows(planId, features, includedVideoMinutes, t) {
    const displayFeatures =
        includedVideoMinutes > 0
            ? features.filter((feature) => feature !== PRICING_VIDEO_FEATURE)
            : features;

    const rows = [];

    if (includedVideoMinutes > 0) {
        rows.push({
            key: `${planId}-free-video-minutes`,
            label: t('pricing_free_video_minutes').replace('{minutes}', includedVideoMinutes),
        });
    }

    for (const feature of displayFeatures) {
        if (PRICING_HIDDEN_FEATURES.has(feature)) continue;
        rows.push({
            key: feature,
            label: t(`billing_feature_${feature.replace(/\./g, '_')}`),
        });
    }

    return rows;
}

/** Incremental feature rows for a plan — ready for rendering. */
export function listPricingFeatureRows(planId, t) {
    const features = listIncrementalFeaturesForPlan(planId);
    const includedVideoMinutes = getIncludedVideoMinutes(planId);
    return buildPricingFeatureRows(planId, features, includedVideoMinutes, t);
}

/** Monthly unified intelligence-credit allowance (whole credits) for a plan. */
export function getMonthlyCredits(planId) {
    const plan = getPlanById(planId);
    return plan ? plan.monthlyCredits || 0 : 0;
}

/** Monthly included video minutes for a plan (0 when none, e.g. Starter). */
export function getIncludedVideoMinutes(planId) {
    const plan = getPlanById(planId);
    return plan ? plan.includedVideoMinutes || 0 : 0;
}

/** True when the plan includes the video interview feature (Team and above). */
export function planAllowsVideo(planId) {
    return planHasFeature(planId, VIDEO_FEATURE);
}

/** Minutes granted by a single extra video pack (plan-independent). */
export function getVideoPackMinutes() {
    return VIDEO_PACK_MINUTES;
}

/** Display price (USD) of one extra video pack for a plan; null when not offered. */
export function getVideoPackPriceUsd(planId) {
    const value = VIDEO_PACK_PRICE_USD[planId];
    return typeof value === 'number' ? value : null;
}

export function getSeatLimit(planId) {
    const plan = getPlanById(planId);
    return plan ? plan.seatLimit : undefined;
}

export function isPopularPlan(planId) {
    const plan = getPlanById(planId);
    return !!(plan && plan.flags && plan.flags.popular);
}

export function hasCustomCredits(planId) {
    const plan = getPlanById(planId);
    return !!(plan && plan.flags && plan.flags.customCredits);
}

/** Locale-grouped monthly credit count for display (e.g. "2,500"). */
export function formatMonthlyCredits(planId) {
    const value = getMonthlyCredits(planId);
    try {
        return value.toLocaleString('en-US');
    } catch {
        return String(value);
    }
}

/**
 * Compute the displayed monthly price for a plan, accounting for billing cycle.
 * Returns one of:
 *   - { kind: 'custom' }                 → render localized "Contact sales"
 *   - { kind: 'monthly', amount, currency }  → render `$N/mo`
 *   - { kind: 'annual', amount, currency, monthlyEquivalent }
 *         → render `$M/mo billed annually` (annual = monthly*12*0.8 → equivalent /mo = monthly*0.8)
 *
 * Phase 1 invariant: annual discount = 20% (matches existing PLAN_SPECS logic).
 */
export function getPriceDisplay(planId, billingCycle = 'monthly') {
    const plan = getPlanById(planId);
    if (!plan) {
        return { kind: 'custom' };
    }
    if (plan.price === 'custom') {
        return { kind: 'custom' };
    }
    const { monthly, currency } = plan.price;
    if (billingCycle === 'annual') {
        const monthlyEquivalent = Math.round(monthly * ANNUAL_DISCOUNT * 100) / 100;
        return {
            kind: 'annual',
            amount: monthlyEquivalent,
            currency,
            monthlyEquivalent,
        };
    }
    return { kind: 'monthly', amount: monthly, currency };
}

/**
 * Resolve currentPlanId to a known plan, falling back to DEFAULT_PLAN_ID.
 * Useful when reading from Clerk publicMetadata that may be undefined.
 */
export function resolvePlanId(maybePlanId) {
    if (typeof maybePlanId !== 'string') return DEFAULT_PLAN_ID;
    const exists = BILLING_PLANS.some((p) => p.id === maybePlanId);
    return exists ? maybePlanId : DEFAULT_PLAN_ID;
}

/**
 * Next catalog plans above the current plan (full order, including free → starter).
 * Used for spending-page upgrade cards that encourage stepping up one/two tiers.
 */
export function listNextUpgradePlans(currentPlanId, limit = 2) {
    const resolved = BILLING_PLANS.some((p) => p.id === currentPlanId)
        ? currentPlanId
        : resolvePlanId(currentPlanId);
    const idx = BILLING_PLANS.findIndex((p) => p.id === resolved);
    if (idx < 0) return [];
    const max = Math.max(0, Number(limit) || 0);
    return BILLING_PLANS.slice(idx + 1, idx + 1 + max);
}

/**
 * Catalog subscription price for display (fallback when Stripe invoice amount unavailable).
 * @param {string} planId
 * @param {'monthly'|'annual'|string|null|undefined} billingCycle
 * @param {(key: string) => string} t
 */
export function formatPlanSubscriptionAmount(planId, billingCycle, t) {
    const cycle = billingCycle === 'annual' ? 'annual' : 'monthly';
    const info = getPriceDisplay(planId, cycle);
    if (info.kind === 'custom') return t('billing_price_custom');
    return `$${Number(info.amount).toFixed(2)}`;
}
