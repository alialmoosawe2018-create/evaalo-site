// Warm the SWR cache for the heavy dashboard tables so that, by the time the user
// navigates into them, the data is already there — no first-load wait. Each call is
// guarded by hasCached() so we fetch at most once per session and never duplicate
// what a page has already loaded. Every failure is swallowed: a prefetch is
// best-effort and must never surface an error or block anything.

import { apiClient } from './apiClient';
import { setCached, hasCached } from '../utils/swrCache';

export async function prefetchCandidates(userKey) {
    const key = `candidates:list:${userKey}`;
    if (hasCached(key)) return;
    try {
        const res = await apiClient.get('/api/candidates?forView=candidates');
        if (res?.success) setCached(key, res.data || []);
    } catch {
        /* best-effort */
    }
}

export async function prefetchUsageActivity(days = 7) {
    const key = `usage:activity:${days}`;
    if (hasCached(key)) return;
    try {
        const res = await apiClient.get(`/api/billing/activity?days=${days}&limit=200`);
        if (res?.ok && Array.isArray(res.entries)) setCached(key, res.entries);
    } catch {
        /* best-effort */
    }
}

export async function prefetchInvoices() {
    const key = 'billing:invoices:24';
    if (hasCached(key)) return;
    try {
        const res = await apiClient.get('/api/billing/portal/invoices?limit=24');
        if (res?.ok && Array.isArray(res.invoices)) setCached(key, res.invoices);
    } catch {
        /* best-effort */
    }
}
