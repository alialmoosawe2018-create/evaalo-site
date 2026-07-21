import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountPageLayout from '../components/AccountPageLayout';
import '../design-styles.css';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { apiClient } from '../services/apiClient';
import { openStripeBillingPortal } from '../utils/billingPortal';
import { useBillingStripeReturnRefresh } from '../hooks/useBillingStripeReturnRefresh';
import { CONTACT_EMAIL } from '../constants/contact';
import { getPlanById } from '../utils/billingDisplay';
import { ACCOUNT_GRADIENT_TEXT, accountSectionLabelStyleCompact } from '../utils/accountTypography';
import {
    FAIL_BG,
    FAIL_TEXT,
    formatCurrencyCents,
    formatDateSafe,
    INVOICE_STATUS_KEY,
    invoiceStatusStyle,
    localeForBillingLang,
    NEUTRAL_BG,
    NEUTRAL_TEXT,
    PAID_BG,
    PAID_TEXT,
    STATUS_KEY_MAP,
} from '../utils/billingPortalDisplay';

/** الشريط الجانبي يبقى داكناً؛ المحتوى الرئيسي بلون كريمي مطابق لقسم Process */
const SIDEBAR_BG = 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)';
const MAIN_BG = '#FDF8F0';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.1)';
const MUTED = '#94a3b8';
const MUTED_LIGHT = '#cbd5e1';
/** ألوان المحتوى الرئيسي على الخلفية الكريمية */
const MAIN_TEXT = '#1f2937';
const MAIN_MUTED = '#6b7280';
const MAIN_BORDER = 'rgba(15, 23, 42, 0.12)';
const MAIN_BORDER_ROW = 'rgba(15, 23, 42, 0.08)';
const PORTAL_LOGO_SRC = '/images/last logo.png';

function IconCubeLogo(props) {
    const { style, ...rest } = props;
    return (
        <img
            src={PORTAL_LOGO_SRC}
            alt=""
            width={32}
            height={32}
            decoding="async"
            draggable={false}
            style={{
                display: 'block',
                objectFit: 'contain',
                width: 32,
                height: 32,
                ...style,
            }}
            {...rest}
        />
    );
}

const sectionLabel = {
    ...accountSectionLabelStyleCompact,
    color: '#3B82F6',
    marginBottom: 16,
};

const NAV_HEIGHT_PX = 0;

const stripePortalShellCss = `
                html:has(.account-stripe-portal-page),
                body:has(.account-stripe-portal-page) {
                    overflow: hidden !important;
                    height: 100% !important;
                }
                .account-stripe-portal-page.dashboard-page {
                    padding: 0 !important;
                    height: 100vh !important;
                    min-height: 100vh;
                    overflow: hidden !important;
                }
                .account-stripe-portal-page .account-dashboard-inner {
                    position: fixed !important;
                    top: ${NAV_HEIGHT_PX}px !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    align-items: stretch !important;
                    width: 100% !important;
                    max-width: none !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    gap: 0 !important;
                    z-index: 1 !important;
                }
                .account-stripe-portal-page .stripe-portal-root {
                    flex: 1 1 auto !important;
                    display: flex !important;
                    flex-direction: column !important;
                    min-height: 0 !important;
                }
                .account-stripe-portal-page .dashboard-card {
                    border-radius: 0 !important;
                }
                @media (max-width: 900px) {
                    .stripe-portal-split {
                        flex-direction: column !important;
                        flex: 1 1 auto !important;
                        min-height: 0 !important;
                    }
                    .stripe-portal-page aside {
                        width: 100% !important;
                        max-width: none !important;
                        flex: 0 0 auto !important;
                    }
                    .stripe-portal-page main {
                        flex: 1 1 auto !important;
                        min-height: 0 !important;
                    }
                }
                .account-stripe-portal-page .stripe-invoice-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 16px 4px;
                    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
                    box-sizing: border-box;
                    transition: background 0.15s ease;
                }
                .account-stripe-portal-page .stripe-invoice-row:last-child {
                    border-bottom: none;
                }
                .account-stripe-portal-page .stripe-invoice-row--interactive {
                    cursor: pointer;
                    border-radius: 8px;
                    margin-inline: -4px;
                    padding-inline: 8px;
                }
                .account-stripe-portal-page .stripe-invoice-row--interactive:hover,
                .account-stripe-portal-page .stripe-invoice-row--interactive:focus-visible {
                    background: rgba(37, 99, 235, 0.06);
                    outline: none;
                }
                .account-stripe-portal-page .stripe-invoice-row__main {
                    flex: 1;
                    min-width: 0;
                }
                .account-stripe-portal-page .stripe-invoice-row__meta {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: baseline;
                    gap: 12px;
                    margin-bottom: 4px;
                }
                .account-stripe-portal-page .stripe-invoice-row__number {
                    font-size: 13px;
                    color: #6b7280;
                    line-height: 1.5;
                }
                .account-stripe-portal-page .stripe-invoice-row__action {
                    flex-shrink: 0;
                    font-size: 13px;
                    font-weight: 500;
                    color: #2563eb;
                    white-space: nowrap;
                    opacity: 0;
                    transition: opacity 0.15s ease;
                }
                .account-stripe-portal-page .stripe-invoice-row--interactive:hover .stripe-invoice-row__action,
                .account-stripe-portal-page .stripe-invoice-row--interactive:focus-visible .stripe-invoice-row__action {
                    opacity: 1;
                }
                /* Return to evaalo — نفس نمط Hero Learn More (.btn-secondary) بحجم account-btn-compact */
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    flex-shrink: 0;
                    white-space: nowrap;
                    padding: 11px 18px !important;
                    font-size: 0.875rem !important;
                    font-weight: 600 !important;
                    border-radius: 9px !important;
                    min-height: 0 !important;
                    color: #ffffff !important;
                    background: rgba(255, 255, 255, 0.1) !important;
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    border: 2px solid rgba(56, 189, 248, 0.4) !important;
                    box-shadow:
                        inset 0 1px 0 rgba(255, 255, 255, 0.12),
                        0 2px 12px rgba(0, 0, 0, 0.12);
                    transition: var(--transition-base, 0.2s ease);
                    cursor: pointer;
                    font-family: inherit;
                }
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:hover,
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:focus-visible {
                    background: rgba(56, 189, 248, 0.2) !important;
                    border-color: rgba(56, 189, 248, 0.6) !important;
                    color: #ffffff !important;
                    transform: translateY(-3px);
                    box-shadow:
                        inset 0 1px 0 rgba(255, 255, 255, 0.16),
                        0 8px 24px rgba(56, 189, 248, 0.2);
                    outline: none;
                }
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:active {
                    transform: translateY(-1px);
                }
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return__arrow {
                    display: inline-block;
                    line-height: 1;
                    transition: transform var(--transition-base, 0.2s ease);
                }
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:hover .stripe-portal-return__arrow,
                .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:focus-visible .stripe-portal-return__arrow {
                    transform: translateX(-4px);
                }
                body.rtl-text .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:hover .stripe-portal-return__arrow,
                body.rtl-text .account-stripe-portal-page .stripe-portal-page aside .stripe-portal-return.btn.btn-secondary.btn-large:focus-visible .stripe-portal-return__arrow {
                    transform: translateX(4px);
                }
                .account-stripe-portal-page .stripe-portal-subscription-btn.btn.btn-secondary.btn-large {
                    padding: 13px 24px !important;
                    font-size: 15px !important;
                    font-weight: 600 !important;
                    border-radius: 10px !important;
                    min-height: 0 !important;
                    margin-top: 8px;
                    flex-shrink: 0;
                    white-space: nowrap;
                }
            `;

function openHostedInvoice(url) {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function handleInvoiceRowKeyDown(event, url) {
    if (!url) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openHostedInvoice(url);
    }
}

const AccountStripePortal = () => {
    const navigate = useNavigate();
    const { currentLang, t } = useLanguage();
    const { refetch: refetchBillingContext } = useBilling();
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const localeForDates = localeForBillingLang(currentLang);

    const [summary, setSummary] = useState(null);
    const [invoices, setInvoices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [actionError, setActionError] = useState(null);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        setActionError(null);
        try {
            const [summaryRes, invoicesRes] = await Promise.all([
                apiClient.get('/api/billing/portal/summary'),
                apiClient.get('/api/billing/portal/invoices?limit=10'),
            ]);
            setSummary(summaryRes?.ok ? summaryRes : null);
            setInvoices(invoicesRes?.ok && Array.isArray(invoicesRes.invoices) ? invoicesRes.invoices : []);
        } catch (err) {
            setActionError(err?.message || t('billing_portal_action_failed'));
        } finally {
            setIsLoading(false);
        }
    }, [t]);

    useBillingStripeReturnRefresh(useCallback(() => {
        loadAll();
    }, [loadAll]));

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    /**
     * Redirect to the Stripe-hosted Customer Portal. `intent` deep-links into a
     * specific flow: 'add_payment_method' | 'cancel' | 'manage' (default).
     */
    const goToStripePortal = async (intent = 'manage') => {
        if (actionLoading) return;
        setActionLoading(intent === 'manage' ? 'manage' : intent === 'cancel' ? 'cancel' : 'paymentMethod');
        setActionError(null);
        try {
            const portalReturn = `${window.location.origin}/account/billing/portal?stripe_return=1`;
            await openStripeBillingPortal(intent, portalReturn);
        } catch (err) {
            setActionError(err?.message || t('billing_portal_action_failed'));
            setActionLoading(null);
        }
    };

    const handleResume = async () => {
        if (actionLoading) return;
        setActionLoading('resume');
        setActionError(null);
        try {
            await apiClient.post('/api/billing/portal/resume', {});
            await Promise.all([loadAll(), refetchBillingContext().catch(() => null)]);
        } catch (err) {
            setActionError(err?.message || t('billing_portal_action_failed'));
        } finally {
            setActionLoading(null);
        }
    };

    const planNameKey = useMemo(() => {
        const planId = summary?.planId;
        if (!planId) return null;
        const plan = getPlanById(planId);
        return plan?.displayNameKey ?? null;
    }, [summary?.planId]);

    const statusKey = summary?.subscriptionStatus
        ? STATUS_KEY_MAP[summary.subscriptionStatus]
        : null;

    const nextBillLabel = formatDateSafe(summary?.currentPeriodEnd, localeForDates);

    return (
        <AccountPageLayout pageClass="account-stripe-portal-page" injectStyle={stripePortalShellCss}>
            <div
                className="stripe-portal-root"
                style={{
                    flex: 1,
                    minWidth: 0,
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }}
            >
                    <div
                        className="dashboard-card"
                        style={{
                            padding: 0,
                            overflow: 'hidden',
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                        }}
                    >
                    <div
                        className="stripe-portal-page"
                        style={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: MAIN_BG,
                            color: MAIN_TEXT,
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                flex: 1,
                                minHeight: 0,
                                flexDirection: 'row',
                                alignItems: 'stretch',
                            }}
                            className="stripe-portal-split"
                        >
                            {/* Sidebar */}
                <aside
                                dir={mainDir}
                    style={{
                        width: '48%',
                        minWidth: 380,
                        maxWidth: 560,
                        background: SIDEBAR_BG,
                        color: '#fff',
                        padding: '32px 28px 24px',
                        display: 'flex',
                        flexDirection: 'column',
                        flexShrink: 0,
                        alignSelf: 'stretch',
                        minHeight: 0,
                                    borderInlineEnd: `1px solid ${BORDER_SUBTLE}`,
                    }}
                >
                    <IconCubeLogo />
                                <div
                                    style={{
                                        flex: 1,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        paddingInlineEnd: 8,
                                        gap: 24,
                                    }}
                                >
                        <button
                            type="button"
                                        className="btn btn-secondary btn-large account-btn-compact stripe-portal-return"
                                        style={{ marginTop: 28, alignSelf: 'flex-start' }}
                            onClick={() => navigate('/account/billing')}
                        >
                                        <span className="stripe-portal-return__arrow" aria-hidden>
                                            {mainDir === 'rtl' ? '→' : '←'}
                            </span>
                                        {t('account_portal_return')}
                        </button>
                                    <p style={{ margin: 0, fontSize: 22, fontWeight: 500, lineHeight: 1.35 }}>
                                        <a
                                            href={`mailto:${CONTACT_EMAIL}`}
                                            style={{ color: MUTED_LIGHT, fontWeight: 600, textDecoration: 'none' }}
                                        >
                                            {CONTACT_EMAIL}
                                        </a>
                                    </p>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
                        <div style={{ marginBottom: 8 }}>
                                        {t('account_portal_poweredBy')}{' '}
                            <span style={{ color: '#fff', fontWeight: 600 }}>stripe</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <a href="https://stripe.com/docs/billing" style={{ color: MUTED_LIGHT }}>
                                            {t('account_portal_linkBillingDocs')}
                            </a>
                            <span style={{ color: BORDER_SUBTLE }}>|</span>
                            <a href="https://stripe.com/legal/consumer" style={{ color: MUTED_LIGHT }}>
                                            {t('account_portal_linkTerms')}
                            </a>
                            <span style={{ color: BORDER_SUBTLE }}>|</span>
                            <a href="https://stripe.com/privacy" style={{ color: MUTED_LIGHT }}>
                                            {t('account_portal_linkPrivacy')}
                            </a>
                        </div>
                    </div>
                </aside>

                            {/* Main */}
                <main
                                dir={mainDir}
                    style={{
                        flex: 1,
                        background: 'transparent',
                        padding: '40px 48px 64px',
                        overflow: 'auto',
                        minWidth: 0,
                        minHeight: 0,
                        alignSelf: 'stretch',
                    }}
                >
                    <div style={{ maxWidth: 640 }}>
                                    {isLoading ? (
                                        <p style={{ color: MAIN_MUTED, fontSize: 14 }}>
                                            {t('billing_portal_summary_loading')}
                                        </p>
                                    ) : null}

                                    {!isLoading && (!summary || !summary.configured) ? (
                                        <div style={{ marginBottom: 40 }}>
                                            <div style={sectionLabel}>
                                                {t('account_portal_currentSubscription')}
                                            </div>
                                            <p style={{ fontSize: 16, color: MAIN_TEXT, marginBottom: 16 }}>
                                                {t('billing_portal_no_subscription')}
                                            </p>
                                            <a
                                                href="/account/billing"
                                                className="btn btn-secondary btn-large account-btn-compact"
                                            >
                                                <span style={{ ...ACCOUNT_GRADIENT_TEXT, fontWeight: 600 }}>
                                                    {t('billing_portal_choose_plan')}
                                                </span>
                                            </a>
                                        </div>
                                    ) : null}

                                    {!isLoading && summary?.configured ? (
                                        <>
                                            {/* Current subscription */}
                                            <div style={{ marginBottom: 40, position: 'relative' }}>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                                        gap: 12,
                                                    }}
                                                >
                                                    <div style={sectionLabel}>
                                                        {t('account_portal_currentSubscription')}
                            </div>
                                                    {summary.cancelAtPeriodEnd ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleResume}
                                                            disabled={Boolean(actionLoading)}
                                                            className="btn btn-secondary btn-large account-btn-compact stripe-portal-subscription-btn"
                                                        >
                                                            <span style={{ ...ACCOUNT_GRADIENT_TEXT, fontWeight: 600 }}>
                                                                {actionLoading === 'resume'
                                                                    ? '…'
                                                                    : t('billing_resume_action')}
                                                            </span>
                                                        </button>
                                                    ) : summary.subscriptionStatus !== 'canceled' ? (
                            <button
                                type="button"
                                                            onClick={() => goToStripePortal('cancel')}
                                                            disabled={Boolean(actionLoading)}
                                                            className="btn btn-secondary btn-large account-btn-compact stripe-portal-subscription-btn"
                                                        >
                                                            <span style={{ ...ACCOUNT_GRADIENT_TEXT, fontWeight: 600 }}>
                                                                {actionLoading === 'cancel'
                                                                    ? '…'
                                                                    : t('billing_cancel_action')}
                                                            </span>
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <h2
                                                    style={{
                                                        margin: '0 0 8px',
                                                        fontSize: 32,
                                                        fontWeight: 700,
                                                        letterSpacing: '-0.02em',
                                                        lineHeight: 1.2,
                                                        color: '#000000',
                                                    }}
                                                >
                                                    {planNameKey ? t(planNameKey) : summary.planId}
                                                </h2>
                                                {statusKey ? (
                                                    <p style={{ margin: '0 0 8px', fontSize: 14, color: MAIN_TEXT }}>
                                                        <span
                                style={{
                                                                display: 'inline-block',
                                                                padding: '4px 10px',
                                                                borderRadius: 999,
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                background:
                                                                    summary.subscriptionStatus === 'active' ||
                                                                    summary.subscriptionStatus === 'trialing'
                                                                        ? PAID_BG
                                                                        : summary.subscriptionStatus === 'past_due'
                                                                          ? FAIL_BG
                                                                          : NEUTRAL_BG,
                                                                color:
                                                                    summary.subscriptionStatus === 'active' ||
                                                                    summary.subscriptionStatus === 'trialing'
                                                                        ? PAID_TEXT
                                                                        : summary.subscriptionStatus === 'past_due'
                                                                          ? FAIL_TEXT
                                                                          : NEUTRAL_TEXT,
                                                            }}
                                                        >
                                                            {t(statusKey)}
                                                        </span>
                                                    </p>
                                                ) : null}
                                                {nextBillLabel ? (
                                                    <p style={{ margin: '0 0 6px', fontSize: 14, color: MAIN_MUTED }}>
                                                        {summary.cancelAtPeriodEnd
                                                            ? t('billing_status_active_until').replace(
                                                                  '{date}',
                                                                  nextBillLabel,
                                                              )
                                                            : t('billing_portal_next_bill').replace(
                                                                  '{date}',
                                                                  nextBillLabel,
                                                              )}
                                                    </p>
                                                ) : null}
                        </div>

                                            {/* Payment method */}
                                            <div
                                style={{
                                                    marginBottom: 40,
                                                    paddingTop: 32,
                                                    borderTop: `1px solid ${MAIN_BORDER}`,
                                                }}
                                            >
                                                <div style={sectionLabel}>
                                                    {t('account_portal_paymentMethods')}
                            </div>
                                                {summary.paymentMethod?.brand && summary.paymentMethod?.last4 ? (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    flexWrap: 'wrap',
                                    padding: '14px 0',
                                    borderBottom: `1px solid ${MAIN_BORDER_ROW}`,
                                }}
                            >
                                <span
                                    style={{
                                                                fontSize: 14,
                                                                color: MAIN_TEXT,
                                                                textTransform: 'capitalize',
                                        fontWeight: 600,
                                                            }}
                                                        >
                                                            {summary.paymentMethod.brand} •••• {summary.paymentMethod.last4}
                                                        </span>
                                                        {summary.paymentMethod.expMonth && summary.paymentMethod.expYear ? (
                                                            <span style={{ fontSize: 13, color: MAIN_MUTED }}>
                                                                {String(summary.paymentMethod.expMonth).padStart(2, '0')}/
                                                                {summary.paymentMethod.expYear}
                                </span>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <p style={{ fontSize: 14, color: MAIN_MUTED, marginBottom: 16 }}>
                                                        {t('billing_portal_payment_method_none')}
                                                    </p>
                                                )}
                                <button
                                    type="button"
                                                    onClick={() => goToStripePortal('add_payment_method')}
                                                    disabled={Boolean(actionLoading)}
                                                    className="btn btn-secondary btn-large account-btn-compact"
                                                    style={{ marginTop: 16 }}
                                                >
                                                    <span style={{ ...ACCOUNT_GRADIENT_TEXT, fontWeight: 600 }}>
                                                        {actionLoading === 'paymentMethod'
                                                            ? '…'
                                                            : summary.paymentMethod?.brand && summary.paymentMethod?.last4
                                                              ? t('account_portal_addPaymentAnother')
                                                              : t('account_portal_addPayment')}
                                                    </span>
                                </button>
                            </div>

                                            {/* Invoices */}
                                            <div style={{ paddingTop: 32, borderTop: `1px solid ${MAIN_BORDER}` }}>
                            <div
                                style={{
                                    display: 'flex',
                                                        justifyContent: 'space-between',
                                    alignItems: 'center',
                                                        marginBottom: 20,
                                                    }}
                                                >
                                                    <div style={{ ...sectionLabel, marginBottom: 0 }}>
                                                        {t('account_portal_invoiceHistory')}
                            </div>
                        </div>
                                                {invoices.length === 0 ? (
                                                    <p style={{ fontSize: 14, color: MAIN_MUTED }}>
                                                        {t('billing_portal_invoices_empty')}
                                                    </p>
                                                ) : (
                                                    invoices.map((inv, i) => {
                                                        const amountLabel = formatCurrencyCents(
                                                            inv.amountPaidCents || inv.amountDueCents,
                                                            inv.currency,
                                                            localeForDates,
                                                        );
                                                        const dateLabel = formatDateSafe(inv.createdAt, localeForDates);
                                                        const stl = invoiceStatusStyle(inv.status);
                                                        const statusLabelKey = INVOICE_STATUS_KEY[inv.status];
                                                        const hasInvoiceLink = Boolean(inv.hostedInvoiceUrl);
                                                        const ariaParts = [
                                                            dateLabel || inv.createdAt,
                                                            amountLabel,
                                                            inv.number,
                                                            statusLabelKey ? t(statusLabelKey) : null,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(', ');
                                                        const rowAriaLabel = hasInvoiceLink
                                                            ? `${ariaParts}. ${t('billing_portal_view_invoice')}`
                                                            : undefined;
                                                        return (
                                                            <div
                                                                key={inv.id ?? i}
                                                                className={`stripe-invoice-row${
                                                                    hasInvoiceLink
                                                                        ? ' stripe-invoice-row--interactive'
                                                                        : ''
                                                                }`}
                                                                role={hasInvoiceLink ? 'link' : undefined}
                                                                tabIndex={hasInvoiceLink ? 0 : undefined}
                                                                aria-label={rowAriaLabel}
                                                                onClick={() =>
                                                                    hasInvoiceLink &&
                                                                    openHostedInvoice(inv.hostedInvoiceUrl)
                                                                }
                                                                onKeyDown={(e) =>
                                                                    handleInvoiceRowKeyDown(
                                                                        e,
                                                                        inv.hostedInvoiceUrl,
                                                                    )
                                                                }
                                                            >
                                                                <div className="stripe-invoice-row__main">
                                                                    <div className="stripe-invoice-row__meta">
                                                                        <span
                                                                            style={{
                                                                                fontSize: 15,
                                                                                fontWeight: 600,
                                                                                color: MAIN_TEXT,
                                                                            }}
                                                                        >
                                                                            {dateLabel || inv.createdAt || ''}
                                                                        </span>
                                                                        {amountLabel ? (
                                                                            <span
                                    style={{
                                                                                    fontSize: 15,
                                                                                    fontWeight: 600,
                                                                                    color: MAIN_TEXT,
                                                                                }}
                                                                            >
                                                                                {amountLabel}
                                                                            </span>
                                                                        ) : null}
                                                                        {statusLabelKey ? (
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                padding: '4px 8px',
                                                borderRadius: 4,
                                                                                    background: stl.bg,
                                                                                    color: stl.color,
                                                                                }}
                                                                            >
                                                                                {t(statusLabelKey)}
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                    {inv.number ? (
                                                                        <div className="stripe-invoice-row__number">
                                                                            {inv.number}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                                {hasInvoiceLink ? (
                                                                    <span className="stripe-invoice-row__action">
                                                                        {t('billing_portal_view_invoice')}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </>
                                    ) : null}

                                    {actionError ? (
                                        <p
                                            role="alert"
                                            style={{
                                                marginTop: 24,
                                                fontSize: 13,
                                                color: '#b91c1c',
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {actionError}
                                        </p>
                                    ) : null}
                    </div>
                </main>
                        </div>
                    </div>
                </div>
            </div>
        </AccountPageLayout>
    );
};

export default AccountStripePortal;
