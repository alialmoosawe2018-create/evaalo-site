/**
 * Launch promo (frontend mirror of apps/backend/src/config/launchPromo.ts).
 *
 * Display-only: adds bonus credits to the number shown on pricing cards so it
 * matches what the backend actually grants. Keep values in sync with the backend.
 * End the promo by flipping `enabled` to false in BOTH files.
 */

export const LAUNCH_PROMO = Object.freeze({
    enabled: true,
    /** Optional ISO date; once passed the promo auto-expires even if enabled. null = no auto-expiry. */
    endsAt: null,
    labelKey: 'billing_launch_promo',
    bonusByPlan: Object.freeze({
        free: 0,
        starter: 200,
        team: 500,
        professional: 1000,
        business: 2000,
    }),
});

/** Bonus credits for a plan right now (0 when the promo is off/expired/unknown plan). */
export function launchPromoBonus(planId) {
    if (!LAUNCH_PROMO.enabled) return 0;
    if (LAUNCH_PROMO.endsAt && Date.now() >= Date.parse(LAUNCH_PROMO.endsAt)) return 0;
    return LAUNCH_PROMO.bonusByPlan[planId] ?? 0;
}
