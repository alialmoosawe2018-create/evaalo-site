import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AccountPageLayout from '../components/AccountPageLayout';
import AdjustPlanModal from '../components/AdjustPlanModal';
import BillingInvoicesSection from '../components/BillingInvoicesSection';
import BillingCancelSection from '../components/BillingCancelSection';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { useBillingStripeReturnRefresh } from '../hooks/useBillingStripeReturnRefresh';
import { apiClient } from '../services/apiClient';
import { getPlanById, getPriceDisplay } from '../utils/billingDisplay';
import { formatDateSafe, localeForBillingLang } from '../utils/billingPortalDisplay';
import {
    accountPageH1Style,
    ACCOUNT_PAGE_H1_CLASS,
    ACCOUNT_TEXT_MUTED_CLASS,
} from '../utils/accountTypography';

const ACCENT_TEXT = '#67e8f9';
const BANNER_BG = 'linear-gradient(135deg, #0c4a6e 0%, #164e63 100%)';
const PENDING_BANNER_BG = 'linear-gradient(135deg, #422006 0%, #331909 100%)';
const PENDING_BANNER_TEXT = '#fdba74';
const PENDING_BANNER_BORDER = 'rgba(251, 146, 60, 0.4)';
const LIFECYCLE_BANNER_BG = 'linear-gradient(135deg, #1e3a5f 0%, #172554 100%)';
const LIFECYCLE_BANNER_TEXT = '#93c5fd';
const LIFECYCLE_BANNER_BORDER = 'rgba(96, 165, 250, 0.45)';

function IconGift(props) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path
                d="M20 12v10H4V12M2 7h20v5H2V7zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

const AccountBilling = () => {
    const navigate = useNavigate();
    const { currentLang, t } = useLanguage();
    const {
        currentPlanId,
        periodEnd,
        cancelAtPeriodEnd,
        configured,
        canBuyVideoPack,
        videoPackMinutes,
        videoPackPriceUsd,
        remainingIncludedVideoSeconds,
        remainingPurchasedVideoSeconds,
        refetch: refetchBillingContext,
        error: billingError,
        isLoaded: billingLoaded,
        lifecycleState,
        pendingCheckoutPlanId,
        billingCycle,
    } = useBilling();
    // Only show the plan name/price once billing is actually known. Before that,
    // currentPlanId is a placeholder default (starter) — showing it would display
    // a plan the user may not be on. Show a loading state instead.
    const planReady = billingLoaded && !billingError;
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const locale = localeForBillingLang(currentLang);
    const [adjustPlanOpen, setAdjustPlanOpen] = useState(false);
    const [portalSummary, setPortalSummary] = useState(null);
    const [summaryLoading, setSummaryLoading] = useState(true);
    const [pendingActionLoading, setPendingActionLoading] = useState(false);
    const [videoPackLoading, setVideoPackLoading] = useState(false);

    const remainingVideoMinutes = Math.floor(
        (Number(remainingIncludedVideoSeconds || 0) + Number(remainingPurchasedVideoSeconds || 0)) / 60,
    );

    const handleBuyVideoPack = async () => {
        if (videoPackLoading) return;
        setVideoPackLoading(true);
        try {
            const res = await apiClient.post('/api/billing/video-pack/checkout', { quantity: 1 });
            if (res?.url) {
                // خط أساس ما قبل الشراء لصفحة النجاح: بدونه، لو وصل webhook ستريب
                // قبل عودة المستخدم لكان خط الأساس شاملاً الدقائق المشتراة أصلاً
                // وبقيت الصفحة على «جارٍ التأكيد» رغم نجاح الشراء.
                try {
                    sessionStorage.setItem(
                        'evaalo_videopack_baseline_seconds',
                        String(Number(remainingPurchasedVideoSeconds || 0)),
                    );
                } catch {
                    /* sessionStorage غير متاح — نسقط للسلوك القديم */
                }
                window.location.href = res.url;
                return;
            }
        } catch (err) {
            console.error('[video-pack checkout]', err);
        } finally {
            setVideoPackLoading(false);
        }
    };

    const loadPortalSummary = useCallback(async () => {
        setSummaryLoading(true);
        try {
            const res = await apiClient.get('/api/billing/portal/summary');
            setPortalSummary(res?.ok ? res : null);
        } catch {
            setPortalSummary(null);
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    useBillingStripeReturnRefresh(useCallback(() => {
        loadPortalSummary();
    }, [loadPortalSummary]));
    useEffect(() => {
        loadPortalSummary();
    }, [loadPortalSummary]);

    const currentPlan = getPlanById(currentPlanId);
    const priceInfo = getPriceDisplay(currentPlanId, 'monthly');
    const priceLabel =
        priceInfo.kind === 'custom'
            ? t('billing_price_custom')
            : `$${priceInfo.amount}${t('billing_price_per_month')}`;

    const renewLine = useMemo(() => {
        const endIso = portalSummary?.currentPeriodEnd || periodEnd;
        const endLabel = formatDateSafe(endIso, locale);
        if (endLabel) {
            if (portalSummary?.cancelAtPeriodEnd || cancelAtPeriodEnd) {
                return t('billing_status_active_until').replace('{date}', endLabel);
            }
            if (portalSummary?.configured || configured) {
                return t('account_billing_renew_line_template').replace('{date}', endLabel);
            }
        }
        return t('account_billing_renewLine');
    }, [portalSummary, periodEnd, cancelAtPeriodEnd, configured, locale, t]);

    const isPendingCancellation = Boolean(
        !summaryLoading && (portalSummary?.cancelAtPeriodEnd || cancelAtPeriodEnd),
    );

    const pendingCancellationLabel = useMemo(() => {
        if (!isPendingCancellation) return null;
        const endIso = portalSummary?.currentPeriodEnd || periodEnd;
        const endLabel = formatDateSafe(endIso, locale);
        const planName = currentPlan ? t(currentPlan.displayNameKey) : '';
        if (!endLabel) return null;
        return t('account_billing_pending_banner')
            .replace('{plan}', planName)
            .replace('{date}', endLabel);
    }, [isPendingCancellation, portalSummary, periodEnd, locale, currentPlan, t]);

    const activeBillingCycle =
        portalSummary?.billingCycle === 'annual' || billingCycle === 'annual' ? 'annual' : 'monthly';

    const showAnnualBanner = activeBillingCycle === 'monthly';

    const lifecycleBannerLabel = useMemo(() => {
        if (!lifecycleState || lifecycleState === 'subscription_active') return null;
        const targetPlanId = pendingCheckoutPlanId || currentPlanId;
        const targetPlan = getPlanById(targetPlanId);
        const planName = targetPlan ? t(targetPlan.displayNameKey) : '';
        if (lifecycleState === 'checkout_created') {
            return t('account_billing_lifecycle_checkout_created').replace('{plan}', planName);
        }
        if (lifecycleState === 'payment_pending') {
            return t('account_billing_lifecycle_payment_pending');
        }
        if (lifecycleState === 'payment_confirmed') {
            return t('account_billing_lifecycle_payment_confirmed').replace('{plan}', planName);
        }
        return null;
    }, [lifecycleState, pendingCheckoutPlanId, currentPlanId, t]);

    const handleResumeSubscription = async () => {
        if (pendingActionLoading) return;
        setPendingActionLoading(true);
        try {
            await apiClient.post('/api/billing/portal/resume', {});
            await Promise.all([
                loadPortalSummary(),
                refetchBillingContext().catch(() => null),
            ]);
        } catch {
            /* BillingCancelSection handles errors for bottom card; banner is best-effort */
        } finally {
            setPendingActionLoading(false);
        }
    };

    const billingInjectStyle = `
                @media (max-width: 960px) {
                    .account-dashboard-inner { flex-direction: column !important; }
                    .account-billing-page aside {
                        position: relative !important;
                        top: 0 !important;
                        width: 100% !important;
                    }
                    .account-billing-page main {
                        padding: 4px 0 24px !important;
                    }
                }
            `;

    return (
        <AccountPageLayout pageClass="account-billing-page" injectStyle={billingInjectStyle}>
            <AccountSidebar activeId="billing" />

            <main
                dir={mainDir}
                style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '4px 0 32px 4px',
                }}
            >
                <AccountMobileNav activeId="billing" />
                <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 22px')}>{t('account_billing_pageTitle')}</h1>

                {billingError ? (
                    <div className="account-system-alert" role="alert">
                        {t('account_billing_load_error')}
                    </div>
                ) : null}

                {lifecycleBannerLabel ? (
                    <div
                        className="account-billing-lifecycle-banner"
                        role="status"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                            padding: '10px 16px',
                            borderRadius: 10,
                            background: LIFECYCLE_BANNER_BG,
                            border: `1px solid ${LIFECYCLE_BANNER_BORDER}`,
                            marginBottom: 10,
                        }}
                    >
                        <span
                            style={{ fontSize: 13, fontWeight: 500, color: LIFECYCLE_BANNER_TEXT, lineHeight: 1.45 }}
                        >
                            {lifecycleBannerLabel}
                        </span>
                    </div>
                ) : null}

                {isPendingCancellation && pendingCancellationLabel ? (
                    <div
                        className="account-billing-pending-banner"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                            padding: '10px 16px',
                            borderRadius: 10,
                            background: PENDING_BANNER_BG,
                            border: `1px solid ${PENDING_BANNER_BORDER}`,
                            marginBottom: 10,
                        }}
                    >
                        <span style={{ fontSize: 13, fontWeight: 500, color: PENDING_BANNER_TEXT, lineHeight: 1.45 }}>
                            {pendingCancellationLabel}
                        </span>
                        <button
                            type="button"
                            className="account-billing-pending-banner-btn"
                            onClick={handleResumeSubscription}
                            disabled={pendingActionLoading}
                        >
                            {pendingActionLoading ? '…' : t('billing_resume_action')}
                        </button>
                    </div>
                ) : null}

                {showAnnualBanner ? (
                    <div
                        className="account-billing-annual-banner"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                            padding: '10px 16px',
                            borderRadius: 10,
                            background: BANNER_BG,
                            border: '1px solid rgba(34, 211, 238, 0.22)',
                            marginBottom: 10,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: ACCENT_TEXT }}>
                            <IconGift style={{ flexShrink: 0, opacity: 0.95, width: 16, height: 16 }} />
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{t('account_billing_annualBanner')}</span>
                        </div>
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-accent account-btn-compact"
                            onClick={() => setAdjustPlanOpen(true)}
                        >
                            {t('account_billing_upgradeNow')}
                        </button>
                    </div>
                ) : null}

                <div
                    className="account-billing-credits-blurb"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        borderRadius: 8,
                        marginBottom: 20,
                    }}
                >
                    <IconGift style={{ flexShrink: 0, opacity: 0.6, width: 16, height: 16 }} />
                    <span>{t('account_creditsBlurb')}</span>
                </div>

                <div className="dashboard-card" style={{ padding: '22px 24px', marginBottom: 16 }}>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 16,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div style={{ flex: 1, minWidth: 260 }}>
                            <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>
                                {planReady ? (
                                    <>
                                        <span dir="ltr">{currentPlan ? t(currentPlan.displayNameKey) : ''}</span>{' '}
                                        <span dir="ltr" className="account-billing-plan-price">
                                            {priceLabel}
                                        </span>
                                    </>
                                ) : (
                                    <span className={ACCOUNT_TEXT_MUTED_CLASS} style={{ fontWeight: 500 }}>
                                        {t('account_billing_planLoading')}
                                    </span>
                                )}
                            </h2>
                            <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55 }}>
                                {t('account_billing_planBlurb')}
                            </p>
                            <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                                {renewLine}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact"
                            onClick={() => setAdjustPlanOpen(true)}
                        >
                            {t('account_billing_adjustPlan')}
                        </button>
                    </div>
                </div>

                <div className="dashboard-card" style={{ padding: '22px 24px', marginBottom: 16 }}>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 16,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div>
                            <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>
                                {t('account_billing_paymentTitle')}
                            </h2>
                            <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: 0, fontSize: 14 }}>
                                {t('account_billing_paymentSub')}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact"
                            onClick={() => navigate('/account/billing/portal')}
                        >
                            {t('account_billing_manageStripe')}
                        </button>
                    </div>
                </div>

                {canBuyVideoPack ? (
                    <div className="dashboard-card" style={{ padding: '22px 24px', marginBottom: 16 }}>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 16,
                                flexWrap: 'wrap',
                            }}
                        >
                            <div>
                                <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>
                                    {t('account_billing_video_pack_title')}
                                </h2>
                                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 4px', fontSize: 14 }}>
                                    {t('account_billing_video_pack_remaining').replace(
                                        '{minutes}',
                                        remainingVideoMinutes,
                                    )}
                                </p>
                                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: 0, fontSize: 14 }}>
                                    {t('account_billing_video_pack_sub')
                                        .replace('{minutes}', videoPackMinutes)
                                        .replace('{price}', videoPackPriceUsd ?? '')}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact"
                                onClick={handleBuyVideoPack}
                                disabled={videoPackLoading || videoPackPriceUsd == null}
                            >
                                {videoPackLoading ? '…' : t('account_billing_video_pack_buy')}
                            </button>
                        </div>
                    </div>
                ) : null}

                <BillingInvoicesSection />

                <BillingCancelSection
                    summary={portalSummary}
                    onSummaryChange={loadPortalSummary}
                    isSummaryLoading={summaryLoading}
                />
            </main>

            <AdjustPlanModal
                isOpen={adjustPlanOpen}
                onClose={() => setAdjustPlanOpen(false)}
            />
        </AccountPageLayout>
    );
};

export default AccountBilling;
