import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { apiClient } from '../services/apiClient';
import { formatDateSafe, localeForBillingLang } from '../utils/billingPortalDisplay';
import { ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';

export default function BillingCancelSection({ summary, onSummaryChange, isSummaryLoading }) {
    const { currentLang, t } = useLanguage();
    const { refetch: refetchBillingContext } = useBilling();
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const locale = localeForBillingLang(currentLang);

    const [actionLoading, setActionLoading] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    if (isSummaryLoading || !summary?.configured) return null;
    if (summary.subscriptionStatus === 'canceled') return null;

    const periodEndLabel = formatDateSafe(summary.currentPeriodEnd, locale);
    const isPendingCancel = Boolean(summary.cancelAtPeriodEnd);

    const runCancel = async () => {
        if (actionLoading) return;
        setActionLoading('cancel');
        setActionError(null);
        try {
            await apiClient.post('/api/billing/portal/cancel', {});
            setConfirmOpen(false);
            await Promise.all([
                onSummaryChange?.(),
                refetchBillingContext().catch(() => null),
            ]);
        } catch (err) {
            setActionError(err?.message || t('billing_portal_action_failed'));
        } finally {
            setActionLoading(null);
        }
    };

    const runResume = async () => {
        if (actionLoading) return;
        setActionLoading('resume');
        setActionError(null);
        try {
            await apiClient.post('/api/billing/portal/resume', {});
            await Promise.all([
                onSummaryChange?.(),
                refetchBillingContext().catch(() => null),
            ]);
        } catch (err) {
            setActionError(err?.message || t('billing_portal_action_failed'));
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <>
            <div className="dashboard-card" style={{ padding: '22px 24px', marginBottom: 16 }} dir={mainDir}>
                <div className="account-billing-cancel-row">
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>
                            {isPendingCancel
                                ? t('account_billing_resume_title')
                                : t('account_billing_cancel_title')}
                        </h2>
                        <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                            {isPendingCancel
                                ? t('account_billing_resume_subtitle').replace('{date}', periodEndLabel || '—')
                                : t('account_billing_cancel_subtitle')}
                        </p>
                    </div>
                    {isPendingCancel ? (
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact"
                            onClick={runResume}
                            disabled={Boolean(actionLoading)}
                        >
                            {actionLoading === 'resume' ? '…' : t('billing_resume_action')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="workflow-btn-primary account-btn-compact account-btn-danger"
                            onClick={() => setConfirmOpen(true)}
                            disabled={Boolean(actionLoading)}
                        >
                            {t('account_billing_cancel_title')}
                        </button>
                    )}
                </div>
                {actionError ? (
                    <p role="alert" style={{ margin: '12px 0 0', fontSize: 13, color: '#f87171' }}>
                        {actionError}
                    </p>
                ) : null}
            </div>

            {confirmOpen ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="billing-cancel-confirm-title"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 10000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 20,
                        background: 'rgba(0,0,0,0.55)',
                    }}
                    onClick={() => !actionLoading && setConfirmOpen(false)}
                >
                    <div
                        className="dashboard-card"
                        dir={mainDir}
                        style={{
                            width: '100%',
                            maxWidth: 420,
                            padding: '24px',
                            background: 'rgba(15, 23, 42, 0.98)',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="billing-cancel-confirm-title" style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>
                            {t('account_billing_cancel_title')}
                        </h3>
                        <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55 }}>
                            {t('billing_cancel_confirm')}
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact"
                                onClick={() => setConfirmOpen(false)}
                                disabled={Boolean(actionLoading)}
                            >
                                {t('account_billing_cancel_dismiss')}
                            </button>
                            <button
                                type="button"
                                className="workflow-btn-primary account-btn-compact account-btn-danger"
                                onClick={runCancel}
                                disabled={Boolean(actionLoading)}
                            >
                                {actionLoading === 'cancel' ? '…' : t('billing_cancel_action')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}
