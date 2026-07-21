import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import {
    listPlans,
    getPriceDisplay,
    isPopularPlan,
} from '../utils/billingDisplay';
import { apiClient } from '../services/apiClient';
import { openStripeBillingPortal } from '../utils/billingPortal';
import { navigateFromCheckoutResponse } from '../utils/billingCheckout';
import PlanCardContents from './PlanCardContents';
import './adjust-plan-modal.css';

function PriceLabel({ planId, billing, t }) {
    const info = getPriceDisplay(planId, billing);
    if (info.kind === 'custom') {
        return (
            <span dir="ltr" className="adjust-plan-modal__price-value">
                {t('billing_price_custom')}
            </span>
        );
    }
    const suffix = t('billing_price_per_month');
    return (
        <span dir="ltr" className="adjust-plan-modal__price">
            <span className="adjust-plan-modal__price-value">${info.amount}</span>
            <span className="adjust-plan-modal__price-suffix">
                {suffix}
            </span>
        </span>
    );
}

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} [props.currentPlanId] — overrides BillingContext; rarely needed.
 * @param {string} [props.scrollToPlanId] — plan id to scroll into view ('starter' | 'team' | 'professional' | 'business')
 */
export function AdjustPlanModal({
    isOpen,
    onClose,
    currentPlanId: currentPlanIdProp,
    scrollToPlanId,
}) {
    const { t, currentLang } = useLanguage();
    const billingCtx = useBilling();
    const currentPlanId = currentPlanIdProp || billingCtx.currentPlanId;
    // An explicit prop is authoritative; otherwise only trust currentPlanId once
    // billing has loaded (before that it is a placeholder default) so we never
    // mark the wrong plan as "current".
    const planLoaded = Boolean(currentPlanIdProp) || billingCtx.isLoaded;
    const modalDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const allPlans = useMemo(() => listPlans(), []);

    const [pendingPlanId, setPendingPlanId] = useState(null);
    const [checkoutError, setCheckoutError] = useState(null);
    const [paymentFailedReason, setPaymentFailedReason] = useState(null);
    const [portalLoading, setPortalLoading] = useState(false);

    /** Always redirect to Stripe — Checkout (new sub) or Portal confirm (plan change). */
    const startPlanCheckout = async (planId) => {
        const requestId =
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const res = await apiClient.post('/api/billing/checkout', {
            planId,
            cycle: 'monthly',
            requestId,
        });
        if (navigateFromCheckoutResponse(res, planId)) {
            return true;
        }
        throw new Error('billing_checkout_failed');
    };

    const handleChoosePlan = async (planId) => {
        if (pendingPlanId) return;
        setCheckoutError(null);
        setPaymentFailedReason(null);
        setPendingPlanId(planId);
        try {
            await startPlanCheckout(planId);
        } catch (err) {
            let message;
            if (err?.data?.code === 'CONTACT_SALES') {
                message = t('billing_checkout_contact_sales');
            } else if (err?.data?.code === 'PRICE_NOT_CONFIGURED') {
                message = t('billing_checkout_failed');
            } else if (err?.data?.code === 'PAYMENT_FAILED') {
                if (err?.data?.reason === 'authentication_required') {
                    message = t('billing_change_auth_required');
                    setPaymentFailedReason('authentication_required');
                } else {
                    message = t('billing_change_payment_failed');
                    setPaymentFailedReason('card_declined');
                }
            } else {
                message = err?.message
                    ? t('billing_checkout_failed') + (err.message ? ` — ${err.message}` : '')
                    : t('billing_checkout_failed');
            }
            setCheckoutError(message);
            setPendingPlanId(null);
        }
    };

    const handleOpenBillingPortal = async () => {
        if (portalLoading) return;
        setPortalLoading(true);
        try {
            await openStripeBillingPortal('manage');
        } catch (err) {
            setCheckoutError(err?.message || t('billing_portal_action_failed'));
            setPortalLoading(false);
        }
    };

    const handleContactSales = () => {
        const email = 'sales@evaalo.ai';
        const subject = encodeURIComponent('Enterprise plan inquiry');
        window.location.href = `mailto:${email}?subject=${subject}`;
    };

    useEffect(() => {
        if (!isOpen) return;
        setCheckoutError(null);
        setPaymentFailedReason(null);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !scrollToPlanId) return undefined;
        const ok = allPlans.some((p) => p.id === scrollToPlanId);
        if (!ok) return undefined;
        const run = () => {
            const el = document.querySelector(`.adjust-plan-modal [data-plan-id="${scrollToPlanId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(run);
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen, scrollToPlanId, allPlans]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const currentPlan = allPlans.find((p) => p.id === currentPlanId);

    return createPortal(
        <div
            dir={modalDir}
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjust-plan-title"
            className="new-interview-modal adjust-plan-modal"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="adjust-plan-modal__header">
                <div className="adjust-plan-modal__header-spacer" />
                <div className="adjust-plan-modal__header-center">
                    <h2 id="adjust-plan-title" className="adjust-plan-modal__title">
                        {t('adjust_plan_title')}
                    </h2>
                    <p className="adjust-plan-modal__subtitle">
                        {t('adjust_plan_currentLabel')}{' '}
                        <span dir="ltr" className="adjust-plan-modal__subtitle-plan">
                            {planLoaded && currentPlan ? t(currentPlan.displayNameKey) : t('account_billing_planLoading')}
                        </span>
                    </p>
                </div>
                <div className="adjust-plan-modal__header-actions">
                    <button
                        type="button"
                        className="ni-header-btn-close"
                        onClick={onClose}
                        aria-label={t('adjust_plan_closeAria')}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>
            </div>

            <div
                className="adjust-plan-modal__grid"
                style={{ gridTemplateColumns: `repeat(${allPlans.length}, minmax(0, 1fr))` }}
            >
                {allPlans.map((plan) => {
                    const isCurrent = planLoaded && plan.id === currentPlanId;
                    const popular = isPopularPlan(plan.id);
                    const isCustomPrice = plan.price === 'custom';

                    return (
                        <div
                            key={plan.id}
                            data-plan-id={plan.id}
                            className={`adjust-plan-modal__card${popular ? ' adjust-plan-modal__card--popular' : ''}`}
                        >
                            {popular ? (
                                <span className="adjust-plan-modal__badge-popular">{t('billing_badge_popular')}</span>
                            ) : null}

                            <div className="adjust-plan-modal__plan-head">
                                <span dir="ltr" className="adjust-plan-modal__plan-name">
                                    {t(plan.displayNameKey)}
                                </span>
                                {isCurrent ? (
                                    <span className="adjust-plan-modal__badge-current">{t('adjust_plan_badgeCurrent')}</span>
                                ) : null}
                            </div>

                            <div
                                className="adjust-plan-modal__price-wrap"
                                style={{ textAlign: modalDir === 'rtl' ? 'end' : 'start' }}
                            >
                                <PriceLabel planId={plan.id} billing="monthly" t={t} />
                            </div>

                            <p className="adjust-plan-modal__desc">{t(plan.displayDescKey)}</p>

                            <div className="adjust-plan-modal__card-body">
                                <PlanCardContents planId={plan.id} t={t} />
                            </div>

                            <div className="adjust-plan-modal__actions">
                                {isCurrent ? (
                                    <button type="button" disabled className="adjust-plan-modal__btn adjust-plan-modal__btn--current">
                                        {t('adjust_plan_btnCurrent')}
                                    </button>
                                ) : isCustomPrice ? (
                                    <button
                                        type="button"
                                        onClick={handleContactSales}
                                        className="adjust-plan-modal__btn adjust-plan-modal__btn--secondary"
                                    >
                                        {t('adjust_plan_btnTeams')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleChoosePlan(plan.id)}
                                        disabled={Boolean(pendingPlanId)}
                                        aria-busy={pendingPlanId === plan.id}
                                        className="adjust-plan-modal__btn adjust-plan-modal__btn--primary"
                                        style={{
                                            opacity: pendingPlanId && pendingPlanId !== plan.id ? 0.6 : 1,
                                        }}
                                    >
                                        <span className="adjust-plan-modal__btn-inner">
                                            {pendingPlanId === plan.id ? (
                                                <span className="adjust-plan-modal__btn-spinner" aria-hidden />
                                            ) : null}
                                            {t('adjust_plan_btnChoose')}
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {checkoutError ? (
                <div className="adjust-plan-modal__error-wrap">
                    <p role="alert" className="adjust-plan-modal__error">
                        {checkoutError}
                    </p>
                    {paymentFailedReason === 'authentication_required' ||
                    paymentFailedReason === 'card_declined' ? (
                        <button
                            type="button"
                            onClick={handleOpenBillingPortal}
                            disabled={portalLoading}
                            className="btn btn-secondary adjust-plan-modal__error-action"
                            style={{ cursor: portalLoading ? 'wait' : 'pointer' }}
                        >
                            {portalLoading
                                ? '…'
                                : paymentFailedReason === 'authentication_required'
                                  ? t('billing_change_complete_verification')
                                  : t('billing_change_update_payment_method')}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>,
        document.body,
    );
}

export default AdjustPlanModal;
