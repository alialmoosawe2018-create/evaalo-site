/**
 * BillingContext — single source for the currently-active billing plan and live balances.
 *
 * Phase 2a:
 *   - Fetches GET /api/billing/status (org_plan_state + credit_balance via backend).
 *   - Billing authority is Mongo org_plan_state — NOT Clerk publicMetadata.
 *
 * Phase 2b:
 *   - Exposes refetch() for explicit refresh after a known billing action.
 *   - Exposes startFastRefresh({ durationMs, intervalMs, stopWhen }) — short-lived
 *     rapid polling owned by the context (NOT the page). After a checkout-success
 *     return the page asks the context to fast-poll until subscriptionStatus
 *     flips active OR the budget expires; the regular 30 s polling continues
 *     after that. This keeps polling lifecycle in one place and avoids dueling
 *     timers across pages.
 *
 * Architecture rule: this context owns runtime billing identity (planId + balances).
 * Catalog caps for display still come from billingPlans.js via billingDisplay.js.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PLAN_ID } from '../config/billingPlans';
import { resolvePlanId } from '../utils/billingDisplay';
import { apiClient } from '../services/apiClient';
import { useAuth } from './AuthContext';

const BillingContext = createContext(null);

const REGULAR_POLL_MS = 30_000;
const DEFAULT_FAST_DURATION_MS = 30_000;
const DEFAULT_FAST_INTERVAL_MS = 2_000;
// How many consecutive race-suppressed 403s to tolerate before surfacing the
// error anyway. Bounds the "no active org yet" grace period so a genuinely
// stuck state (org never activates) doesn't loop on a silent "Loading…".
const MAX_RACE_RETRIES = 5;

const INITIAL_STATE = {
    currentPlanId: DEFAULT_PLAN_ID,
    creditsRemaining: 0,
    monthlyCredits: 0,
    balanceMicro: 0,
    subscriptionStatus: null,
    billingCycle: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    remainingIncludedVideoSeconds: 0,
    remainingPurchasedVideoSeconds: 0,
    includedVideoSeconds: 0,
    purchasedVideoSeconds: 0,
    canBuyVideoPack: false,
    videoPackMinutes: 0,
    videoPackPriceUsd: null,
    configured: false,
    lifecycleState: null,
    pendingCheckoutPlanId: null,
    isLoaded: false,
    error: null,
};

export const BillingProvider = ({ children }) => {
    const [state, setState] = useState(INITIAL_STATE);
    const aliveRef = useRef(true);
    const fastTimerRef = useRef(null);
    const fastDeadlineRef = useRef(0);
    const raceRetriesRef = useRef(0);
    // Billing is org-scoped and requires an authenticated session. On public
    // candidate-facing pages (form, interview, screening…) there is no session,
    // so polling would only produce 403 noise — gate the polling on auth.
    const { isAuthenticated } = useAuth();

    // Track Clerk's ACTIVE organization id. On first load there is a race: the
    // app activates the org (setActive) a beat after the session loads, so an
    // early billing call can 403 before the token carries the org. We refetch
    // the moment an active org appears, and use its presence to tell a transient
    // race-403 apart from a real permission denial.
    const [activeOrgId, setActiveOrgId] = useState(
        () => (typeof window !== 'undefined' && window.Clerk?.organization?.id) || null,
    );
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const read = () => {
            const id = window.Clerk?.organization?.id || null;
            setActiveOrgId((prev) => (prev === id ? prev : id));
        };
        read();
        const interval = setInterval(read, 3000);
        const detach = window.Clerk?.addListener?.(read);
        return () => {
            clearInterval(interval);
            if (typeof detach === 'function') detach();
        };
    }, []);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await apiClient.get('/api/billing/status');
            if (!aliveRef.current) return data;
            const nextLifecycle = data.subscription?.lifecycleState ?? data.lifecycleState ?? null;
            const nextPendingPlanId =
                data.subscription?.pendingCheckoutPlanId ?? data.pendingCheckoutPlanId ?? null;
            setState((prev) => ({
                currentPlanId:
                    data.configured && data.planId
                        ? resolvePlanId(data.planId)
                        : prev.configured
                          ? prev.currentPlanId
                          : DEFAULT_PLAN_ID,
                creditsRemaining: Number.isFinite(data.creditsRemaining) ? data.creditsRemaining : 0,
                monthlyCredits: Number.isFinite(data.monthlyCredits) ? data.monthlyCredits : 0,
                balanceMicro: Number.isFinite(data.balanceMicro) ? data.balanceMicro : 0,
                subscriptionStatus: data.subscriptionStatus ?? null,
                billingCycle: data.billingCycle ?? null,
                periodEnd: data.periodEnd ?? null,
                cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
                remainingIncludedVideoSeconds: Number.isFinite(data.remainingIncludedVideoSeconds)
                    ? data.remainingIncludedVideoSeconds
                    : 0,
                remainingPurchasedVideoSeconds: Number.isFinite(data.remainingPurchasedVideoSeconds)
                    ? data.remainingPurchasedVideoSeconds
                    : 0,
                includedVideoSeconds: Number.isFinite(data.includedVideoSeconds)
                    ? data.includedVideoSeconds
                    : 0,
                purchasedVideoSeconds: Number.isFinite(data.purchasedVideoSeconds)
                    ? data.purchasedVideoSeconds
                    : 0,
                canBuyVideoPack: Boolean(data.canBuyVideoPack),
                videoPackMinutes: Number.isFinite(data.videoPackMinutes) ? data.videoPackMinutes : 0,
                videoPackPriceUsd: Number.isFinite(data.videoPackPriceUsd) ? data.videoPackPriceUsd : null,
                configured: Boolean(data.configured),
                lifecycleState: nextLifecycle,
                pendingCheckoutPlanId: nextPendingPlanId,
                isLoaded: true,
                error: null,
            }));
            raceRetriesRef.current = 0;
            return data;
        } catch (err) {
            if (!aliveRef.current) throw err;
            const status = err?.status;
            const code = err?.data?.error;
            const hasActiveOrg =
                typeof window !== 'undefined' && Boolean(window.Clerk?.organization?.id);
            // Transient org-activation race: no active org in the token yet, so an
            // owner-only/org-scoped route returns 403/401. Do NOT surface it — a
            // refetch fires as soon as the org activates. Real permission denials
            // (org IS active) and any non-auth error DO surface normally. Bounded
            // by MAX_RACE_RETRIES so a genuinely stuck state still shows an error.
            const transientAuthRace =
                (status === 401 || status === 403) &&
                (code === 'forbidden_permission' || code === 'ORG_REQUIRED' || code == null) &&
                !hasActiveOrg &&
                raceRetriesRef.current < MAX_RACE_RETRIES;
            if (transientAuthRace) {
                raceRetriesRef.current += 1;
            } else {
                raceRetriesRef.current = 0;
            }
            setState((prev) => ({
                ...prev,
                isLoaded: transientAuthRace ? prev.isLoaded : true,
                error: transientAuthRace ? null : err?.message || 'billing_status_failed',
            }));
            throw err;
        }
    }, []);

    const stopFastRefresh = useCallback(() => {
        if (fastTimerRef.current) {
            clearTimeout(fastTimerRef.current);
            fastTimerRef.current = null;
        }
        fastDeadlineRef.current = 0;
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        // Skip all polling for anonymous visitors (no org → billing.read 403).
        if (!isAuthenticated) {
            setState((prev) => (prev.isLoaded ? prev : { ...prev, isLoaded: true }));
            return () => {
                aliveRef.current = false;
            };
        }
        fetchStatus().catch(() => undefined);
        const interval = setInterval(() => {
            fetchStatus().catch(() => undefined);
        }, REGULAR_POLL_MS);
        return () => {
            aliveRef.current = false;
            clearInterval(interval);
            stopFastRefresh();
        };
    }, [fetchStatus, stopFastRefresh, isAuthenticated, activeOrgId]);

    const refetch = useCallback(async () => {
        try {
            return await fetchStatus();
        } catch {
            return null;
        }
    }, [fetchStatus]);

    /** Optimistic/local balance after a confirmed billing mutation (e.g. contact reveal). */
    const applyLocalBalance = useCallback(({ balanceMicro, creditsRemaining }) => {
        setState((prev) => ({
            ...prev,
            ...(Number.isFinite(balanceMicro) ? { balanceMicro } : {}),
            ...(Number.isFinite(creditsRemaining) ? { creditsRemaining } : {}),
        }));
    }, []);

    /**
     * Begin a short window of rapid polling. Designed for post-checkout / post-portal-action
     * pages where the user expects near-immediate UI confirmation while the Stripe webhook
     * is still in flight. Idempotent: a second call extends/replaces the prior schedule.
     *
     * @param {object} [opts]
     * @param {number} [opts.durationMs=30000] Total time budget.
     * @param {number} [opts.intervalMs=2000]  Tick interval.
     * @param {(snapshot: object) => boolean} [opts.stopWhen] Optional predicate; if it returns
     *        true for a freshly fetched snapshot, fast-refresh stops immediately (regular
     *        30 s polling continues). Typical use: `(s) => s.subscriptionStatus === 'active'`.
     * @returns {Promise<object|null>} Resolves with the snapshot that satisfied stopWhen, or
     *        null if the time budget expired.
     */
    const startFastRefresh = useCallback(
        (opts = {}) => {
            const durationMs = Math.max(500, Number(opts.durationMs) || DEFAULT_FAST_DURATION_MS);
            const intervalMs = Math.max(250, Number(opts.intervalMs) || DEFAULT_FAST_INTERVAL_MS);
            const stopWhen = typeof opts.stopWhen === 'function' ? opts.stopWhen : null;

            stopFastRefresh();
            const deadline = Date.now() + durationMs;
            fastDeadlineRef.current = deadline;

            return new Promise((resolve) => {
                const tick = async () => {
                    if (!aliveRef.current || fastDeadlineRef.current !== deadline) {
                        resolve(null);
                        return;
                    }
                    let snapshot = null;
                    try {
                        snapshot = await fetchStatus();
                    } catch {
                        snapshot = null;
                    }
                    if (!aliveRef.current || fastDeadlineRef.current !== deadline) {
                        resolve(null);
                        return;
                    }
                    if (snapshot && stopWhen && stopWhen(snapshot)) {
                        stopFastRefresh();
                        resolve(snapshot);
                        return;
                    }
                    if (Date.now() >= deadline) {
                        stopFastRefresh();
                        resolve(null);
                        return;
                    }
                    fastTimerRef.current = setTimeout(tick, intervalMs);
                };
                tick();
            });
        },
        [fetchStatus, stopFastRefresh],
    );

    const value = useMemo(
        () => ({
            currentPlanId: state.currentPlanId,
            creditsRemaining: state.creditsRemaining,
            monthlyCredits: state.monthlyCredits,
            balanceMicro: state.balanceMicro,
            subscriptionStatus: state.subscriptionStatus,
            billingCycle: state.billingCycle,
            periodEnd: state.periodEnd,
            cancelAtPeriodEnd: state.cancelAtPeriodEnd,
            remainingIncludedVideoSeconds: state.remainingIncludedVideoSeconds,
            remainingPurchasedVideoSeconds: state.remainingPurchasedVideoSeconds,
            includedVideoSeconds: state.includedVideoSeconds,
            purchasedVideoSeconds: state.purchasedVideoSeconds,
            canBuyVideoPack: state.canBuyVideoPack,
            videoPackMinutes: state.videoPackMinutes,
            videoPackPriceUsd: state.videoPackPriceUsd,
            configured: state.configured,
            lifecycleState: state.lifecycleState,
            pendingCheckoutPlanId: state.pendingCheckoutPlanId,
            isLoaded: state.isLoaded,
            error: state.error,
            refetch,
            applyLocalBalance,
            startFastRefresh,
            stopFastRefresh,
        }),
        [state, refetch, applyLocalBalance, startFastRefresh, stopFastRefresh],
    );

    return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
};

const noopRefetch = async () => null;
const noopFastRefresh = async () => null;
const noopStopFastRefresh = () => undefined;

export const useBilling = () => {
    const ctx = useContext(BillingContext);
    if (!ctx) {
        return {
            currentPlanId: DEFAULT_PLAN_ID,
            creditsRemaining: 0,
            monthlyCredits: 0,
            balanceMicro: 0,
            subscriptionStatus: null,
            billingCycle: null,
            periodEnd: null,
            cancelAtPeriodEnd: false,
            remainingIncludedVideoSeconds: 0,
            remainingPurchasedVideoSeconds: 0,
            includedVideoSeconds: 0,
            purchasedVideoSeconds: 0,
            canBuyVideoPack: false,
            videoPackMinutes: 0,
            videoPackPriceUsd: null,
            configured: false,
            lifecycleState: null,
            pendingCheckoutPlanId: null,
            isLoaded: false,
            error: null,
            refetch: noopRefetch,
            applyLocalBalance: () => undefined,
            startFastRefresh: noopFastRefresh,
            stopFastRefresh: noopStopFastRefresh,
        };
    }
    return ctx;
};

export default BillingContext;
