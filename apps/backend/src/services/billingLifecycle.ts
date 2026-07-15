/**
 * Subscription lifecycle — derived state for UI (Phase 3.4).
 *
 * Plan UI must not reflect a new plan until lifecycle reaches subscription_active.
 * Stored pending checkout fields bridge the gap between checkout redirect and webhook.
 */

import type { IOrgPlanState } from '../models/OrgPlanState.js';
import type { SubscriptionLifecycleState } from '../types/billing.js';

/** Open checkout sessions older than this are ignored for lifecycle display. */
export const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

type LifecycleInput = Pick<
    IOrgPlanState,
    | 'subscriptionStatus'
    | 'stripeSubscriptionId'
    | 'pendingCheckoutSessionId'
    | 'pendingCheckoutAt'
> | null;

function isPendingCheckoutFresh(state: LifecycleInput): boolean {
    if (!state?.pendingCheckoutSessionId || !state.pendingCheckoutAt) return false;
    return Date.now() - state.pendingCheckoutAt.getTime() < PENDING_CHECKOUT_TTL_MS;
}

export function resolveSubscriptionLifecycleState(state: LifecycleInput): SubscriptionLifecycleState | null {
    if (!state) return null;

    if (isPendingCheckoutFresh(state)) {
        return 'checkout_created';
    }

    switch (state.subscriptionStatus) {
        case 'active':
        case 'trialing':
            return 'subscription_active';
        case 'past_due':
            return 'payment_pending';
        case 'incomplete':
            if (state.stripeSubscriptionId) return 'payment_confirmed';
            return null;
        case 'canceled':
            return null;
        default:
            return null;
    }
}

/** True when UI should treat subscription as fully active for plan display. */
export function isSubscriptionLifecycleActive(
    lifecycleState: SubscriptionLifecycleState | null,
): boolean {
    return lifecycleState === 'subscription_active';
}
