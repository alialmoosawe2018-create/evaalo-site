/**
 * Shared POST /api/billing/checkout response handling.
 * Returns true when navigation started (caller should stop loading state).
 */
export function navigateFromCheckoutResponse(res, planId) {
    if (res?.kind === 'already_active') {
        const params = new URLSearchParams({
            source: 'sync',
            planId: String(planId || res.planId || ''),
        });
        window.location.href = `/account/billing/success?${params.toString()}`;
        return true;
    }
    if (res?.url) {
        window.location.href = res.url;
        return true;
    }
    return false;
}
