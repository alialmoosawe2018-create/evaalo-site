/**
 * AccountBillingSuccess — Stripe success_url landing page (Phase 2b).
 *
 * Supports:
 *   - Subscription checkout / plan change (default)
 *   - One-time video pack purchase (?purchase=video_pack&minutes=50)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { getPlanById, resolvePlanId } from '../utils/billingDisplay';
import '../design-styles.css';
import './billing-result-pages.css';

const FAST_POLL_DURATION_MS = 30_000;
const FAST_POLL_INTERVAL_MS = 2_000;

const isActivatedStatus = (status) => status === 'active' || status === 'trialing';

function isSubscriptionCheckoutReady(snapshot, expectedPlanId) {
    if (!isActivatedStatus(snapshot?.subscriptionStatus)) return false;
    if (expectedPlanId) {
        return resolvePlanId(snapshot?.planId) === expectedPlanId;
    }
    return true;
}

function isVideoPackReady(snapshot, baselinePurchasedSeconds, expectedMinutes) {
    const purchased = Number(snapshot?.remainingPurchasedVideoSeconds ?? 0);
    const expectedAdd = Math.max(0, expectedMinutes) * 60;
    if (expectedAdd > 0) {
        return purchased >= baselinePurchasedSeconds + expectedAdd - 1;
    }
    return purchased > baselinePurchasedSeconds;
}

function SuccessIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
            <path
                d="M8 12.5l2.5 2.5L16 9"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export default function AccountBillingSuccess() {
    const { t, currentLang } = useLanguage();
    const [searchParams] = useSearchParams();
    const isVideoPackPurchase = searchParams.get('purchase') === 'video_pack';
    const expectedVideoMinutes = useMemo(() => {
        const raw = Number(searchParams.get('minutes'));
        return Number.isFinite(raw) && raw > 0 ? raw : 50;
    }, [searchParams]);
    const expectedPlanId = useMemo(() => {
        if (isVideoPackPurchase) return null;
        const raw = searchParams.get('planId');
        return raw ? resolvePlanId(raw) : null;
    }, [searchParams, isVideoPackPurchase]);

    const {
        startFastRefresh,
        stopFastRefresh,
        refetch,
        subscriptionStatus,
        currentPlanId,
        creditsRemaining,
        monthlyCredits,
        remainingIncludedVideoSeconds,
        remainingPurchasedVideoSeconds,
    } = useBilling();

    const purchasedBaselineRef = useRef(0);
    // خط الأساس المخزَّن قبل التوجيه إلى Stripe (يُستهلك مرة واحدة).
    // يغلق سباق «webhook وصل قبل عودة المستخدم»: أول جلب بعد العودة قد يشمل
    // الدقائق المشتراة أصلاً، فلا يصلح خط أساس.
    const stashedBaselineRef = useRef(null);
    if (stashedBaselineRef.current === null && isVideoPackPurchase) {
        try {
            const raw = sessionStorage.getItem('evaalo_videopack_baseline_seconds');
            sessionStorage.removeItem('evaalo_videopack_baseline_seconds');
            const parsed = Number(raw);
            stashedBaselineRef.current = raw !== null && Number.isFinite(parsed) ? parsed : NaN;
        } catch {
            stashedBaselineRef.current = NaN;
        }
    }

    const totalVideoMinutes = useMemo(() => {
        const included = Math.floor(Number(remainingIncludedVideoSeconds || 0) / 60);
        const purchased = Math.floor(Number(remainingPurchasedVideoSeconds || 0) / 60);
        return included + purchased;
    }, [remainingIncludedVideoSeconds, remainingPurchasedVideoSeconds]);

    const purchasedVideoMinutes = Math.floor(Number(remainingPurchasedVideoSeconds || 0) / 60);

    const [isReady, setIsReady] = useState(false);
    const pageDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const stopWhen = useCallback(
        (snapshot) => {
            if (isVideoPackPurchase) {
                return isVideoPackReady(
                    snapshot,
                    purchasedBaselineRef.current,
                    expectedVideoMinutes,
                );
            }
            return isSubscriptionCheckoutReady(snapshot, expectedPlanId);
        },
        [isVideoPackPurchase, expectedPlanId, expectedVideoMinutes],
    );

    useEffect(() => {
        refetch()
            .then((data) => {
                // خط الأساس: القيمة المخزَّنة قبل الشراء إن وُجدت، وإلا أول جلب.
                const stashed = stashedBaselineRef.current;
                purchasedBaselineRef.current =
                    typeof stashed === 'number' && Number.isFinite(stashed)
                        ? stashed
                        : Number(data?.remainingPurchasedVideoSeconds ?? 0);
                if (isVideoPackPurchase) {
                    setIsReady(
                        isVideoPackReady(
                            data,
                            purchasedBaselineRef.current,
                            expectedVideoMinutes,
                        ),
                    );
                } else {
                    setIsReady(isSubscriptionCheckoutReady(data, expectedPlanId));
                }
            })
            .catch(() => undefined);

        startFastRefresh({
            durationMs: FAST_POLL_DURATION_MS,
            intervalMs: FAST_POLL_INTERVAL_MS,
            stopWhen,
        });
        return () => {
            stopFastRefresh();
        };
    }, [
        startFastRefresh,
        stopFastRefresh,
        stopWhen,
        refetch,
        isVideoPackPurchase,
        expectedPlanId,
        expectedVideoMinutes,
    ]);

    useEffect(() => {
        if (isVideoPackPurchase) {
            setIsReady(
                isVideoPackReady(
                    { remainingPurchasedVideoSeconds },
                    purchasedBaselineRef.current,
                    expectedVideoMinutes,
                ),
            );
            return;
        }
        if (isSubscriptionCheckoutReady({ subscriptionStatus, planId: currentPlanId }, expectedPlanId)) {
            setIsReady(true);
        }
    }, [
        isVideoPackPurchase,
        remainingPurchasedVideoSeconds,
        expectedVideoMinutes,
        subscriptionStatus,
        currentPlanId,
        expectedPlanId,
    ]);

    const plan = currentPlanId ? getPlanById(currentPlanId) : null;
    const planLabel = plan ? t(plan.displayNameKey) : null;

    const titleKey = isVideoPackPurchase
        ? isReady
            ? 'billing_success_video_pack_title'
            : 'billing_success_video_pack_pending_title'
        : isReady
          ? 'billing_success_title'
          : 'billing_success_pending_title';

    const subtitleKey = isVideoPackPurchase
        ? isReady
            ? 'billing_success_video_pack_subtitle'
            : 'billing_success_video_pack_pending_subtitle'
        : isReady
          ? 'billing_success_subtitle'
          : 'billing_success_pending_subtitle';

    const titleClassName = isReady
        ? 'billing-success-card__title billing-success-card__title--active'
        : 'billing-success-card__title';

    return (
        <div className="billing-success-page" dir={pageDir}>
            <div className="billing-success-card">
                <div className="billing-success-card__icon">
                    <SuccessIcon />
                </div>

                <h1 className={titleClassName}>{t(titleKey)}</h1>
                <p className="billing-success-card__subtitle">{t(subtitleKey)}</p>

                {isReady && isVideoPackPurchase ? (
                    <div className="billing-success-plan">
                        <div className="billing-success-plan__label">
                            {t('billing_success_video_minutes_label')}
                        </div>
                        <div className="billing-success-plan__name" dir="ltr">
                            {purchasedVideoMinutes.toLocaleString('en-US')}{' '}
                            {t('account_billing_video_pack_title').toLowerCase()}
                        </div>
                        <div className="billing-success-plan__grid">
                            <div>
                                <div className="billing-success-plan__metric-label">
                                    {t('account_billing_video_pack_title')}
                                </div>
                                <div className="billing-success-plan__metric-value" dir="ltr">
                                    {totalVideoMinutes.toLocaleString('en-US')}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {isReady && !isVideoPackPurchase && planLabel ? (
                    <div className="billing-success-plan">
                        <div className="billing-success-plan__label">
                            {t('account_spending_currentPlan')}
                        </div>
                        <div className="billing-success-plan__name" dir="ltr">
                            {planLabel}
                        </div>
                        {monthlyCredits ? (
                            <div className="billing-success-plan__grid">
                                <div>
                                    <div className="billing-success-plan__metric-label">
                                        {t('billing_credits_label')}
                                    </div>
                                    <div className="billing-success-plan__metric-value" dir="ltr">
                                        {Number(creditsRemaining ?? 0).toLocaleString('en-US')}
                                        {' / '}
                                        {Number(monthlyCredits ?? 0).toLocaleString('en-US')}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="billing-success-actions">
                    <Link to="/dashboard" className="billing-success-btn workflow-btn-primary ni-continue-btn">
                        {t('billing_success_cta_dashboard')}
                    </Link>
                    {isVideoPackPurchase ? (
                        <Link to="/account/billing" className="billing-success-btn btn btn-secondary">
                            {t('billing_success_cta_billing')}
                        </Link>
                    ) : (
                        <Link to="/account/billing/portal" className="billing-success-btn btn btn-secondary">
                            {t('billing_success_cta_portal')}
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
