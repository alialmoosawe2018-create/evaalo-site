/**
 * Launch promo — TEMPORARY bonus credits stacked on top of each plan's base
 * `monthlyCredits`. DATA + tiny pure helper only (no DB, no logic elsewhere).
 *
 * Why a bonus layer (not editing billingPlans.ts): the documented base pools
 * stay intact, so ending the promo is a one-line flip — `enabled: false` — after
 * which the next monthly refresh grants the base amount again. No data migration,
 * no "takeaway" surprise mid-cycle.
 *
 * Safety (see the cost model): the extra credits carry near-zero marginal cost
 * *inside* the provider quotas, and voice stays 15/credit-min so the $0.01/credit
 * internal ceiling holds. The one thing to watch is the shared ElevenLabs TTS
 * quota — run `scripts/elevenlabs-quota-monitor.mjs` weekly.
 *
 * Frontend mirror: apps/frontend/src/config/launchPromo.js (keep both in sync).
 */

import type { BillingPlanId } from '../types/billing.js';

export const LAUNCH_PROMO: {
    enabled: boolean;
    endsAt: string | null;
    labelKey: string;
    bonusByPlan: Record<BillingPlanId, number>;
} = {
    /** Master switch. Set to false to end the promo (grants revert to base on next refresh). */
    enabled: true,
    /** Optional ISO date; once passed the promo auto-expires even if `enabled`. null = no auto-expiry. */
    endsAt: null,
    /** i18n key for the "launch offer" badge on pricing cards. */
    labelKey: 'billing_launch_promo',
    /** Bonus credits added to each plan's base monthlyCredits. */
    bonusByPlan: {
        free: 0,
        starter: 200,       // 500  -> 700
        team: 500,          // 1500 -> 2000
        professional: 1000, // 3500 -> 4500
        business: 2000,     // 7000 -> 9000
    },
};

/** Bonus credits for a plan right now (0 when the promo is off/expired/unknown plan). */
export function launchPromoBonus(planId: BillingPlanId): number {
    if (!LAUNCH_PROMO.enabled) return 0;
    if (LAUNCH_PROMO.endsAt && Date.now() >= Date.parse(LAUNCH_PROMO.endsAt)) return 0;
    return LAUNCH_PROMO.bonusByPlan[planId] ?? 0;
}
