import { apiClient } from '../services/apiClient';

/**
 * Open the Stripe-hosted Customer Portal. `intent` deep-links into a flow:
 * 'manage' (home) | 'add_payment_method' | 'cancel'.
 */
export async function openStripeBillingPortal(intent = 'manage', returnUrl) {
    const body = { intent };
    if (typeof returnUrl === 'string' && returnUrl.trim()) {
        body.returnUrl = returnUrl.trim();
    }
    const res = await apiClient.post('/api/billing/portal/session', body);
    if (res?.ok && res?.url) {
        window.location.href = res.url;
        return;
    }
    throw new Error(res?.message || 'billing_portal_unavailable');
}
