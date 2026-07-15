import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { apiClient } from '../services/apiClient';
import { getPlanById } from '../utils/billingDisplay';
import {
    buildInvoiceDescription,
    formatCurrencyCents,
    formatDateSafe,
    formatMonthYear,
    INVOICE_STATUS_KEY,
    localeForBillingLang,
    monthKeyFromIso,
} from '../utils/billingPortalDisplay';
import { ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';

const GRID_COLS = 'minmax(96px, 0.85fr) minmax(140px, 2.2fr) minmax(56px, 0.6fr) minmax(72px, 0.75fr) minmax(48px, 0.55fr)';

function IconExternalLink(props) {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconChevronDown(props) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default function BillingInvoicesSection() {
    const { currentLang, t } = useLanguage();
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const locale = localeForBillingLang(currentLang);

    const [invoices, setInvoices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [monthFilter, setMonthFilter] = useState('all');

    const resolveInvoicePlanName = useCallback(
        (inv) => {
            const plan = inv?.planId ? getPlanById(inv.planId) : null;
            if (plan) return t(plan.displayNameKey);
            return '';
        },
        [t],
    );

    useEffect(() => {
        let cancelled = false;

        const loadInvoices = () => {
            setIsLoading(true);
            setLoadError(null);
            return apiClient
                .get('/api/billing/portal/invoices?limit=24')
                .then((res) => {
                    if (cancelled) return;
                    setInvoices(res?.ok && Array.isArray(res.invoices) ? res.invoices : []);
                })
                .catch((err) => {
                    if (cancelled) return;
                    setLoadError(err?.message || t('billing_portal_action_failed'));
                    setInvoices([]);
                })
                .finally(() => {
                    if (!cancelled) setIsLoading(false);
                });
        };

        loadInvoices();

        const onFocus = () => {
            loadInvoices();
        };
        window.addEventListener('focus', onFocus);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, [t]);

    const monthOptions = useMemo(() => {
        const seen = new Map();
        for (const inv of invoices) {
            const key = monthKeyFromIso(inv.createdAt);
            if (!key || seen.has(key)) continue;
            seen.set(key, formatMonthYear(inv.createdAt, locale));
        }
        return [...seen.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([value, label]) => ({ value, label }));
    }, [invoices, locale]);

    const displayedInvoices = useMemo(() => {
        if (monthFilter === 'all') return invoices;
        return invoices.filter((inv) => monthKeyFromIso(inv.createdAt) === monthFilter);
    }, [invoices, monthFilter]);

    return (
        <div className="dashboard-card" style={{ padding: '22px 24px', marginBottom: 16 }} dir={mainDir}>
            <div
                className="account-billing-invoices-header"
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginBottom: 20,
                }}
            >
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t('account_billing_invoices_title')}</h2>
                <div className="account-billing-month-select-wrap">
                    <select
                        className="account-billing-month-select"
                        value={monthFilter}
                        onChange={(e) => setMonthFilter(e.target.value)}
                        disabled={isLoading || monthOptions.length === 0}
                        aria-label={t('account_billing_invoices_title')}
                    >
                        <option value="all">{t('account_billing_invoices_filter_all')}</option>
                        {monthOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <IconChevronDown className="account-billing-month-select-chevron" aria-hidden />
                </div>
            </div>

            <div className="account-billing-invoices-table-wrap" style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 640 }}>
                    <div
                        className="account-billing-invoices-table account-billing-invoices-table-header"
                        style={{
                            gridTemplateColumns: GRID_COLS,
                        }}
                    >
                        <span>{t('account_billing_invoices_col_date')}</span>
                        <span>{t('account_billing_invoices_col_description')}</span>
                        <span>{t('account_billing_invoices_col_status')}</span>
                        <span>{t('account_billing_invoices_col_amount')}</span>
                        <span>{t('account_billing_invoices_col_invoice')}</span>
                    </div>

                    {isLoading ? (
                        <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ padding: '24px 0', fontSize: 14 }}>
                            {t('billing_portal_summary_loading')}
                        </div>
                    ) : loadError ? (
                        <div role="alert" style={{ padding: '24px 0', fontSize: 14, color: '#f87171' }}>
                            {loadError}
                        </div>
                    ) : displayedInvoices.length === 0 ? (
                        <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ padding: '24px 0', fontSize: 14 }}>
                            {t('billing_portal_invoices_empty')}
                        </div>
                    ) : (
                        displayedInvoices.map((inv, i) => {
                            const dateLabel = formatDateSafe(inv.createdAt, locale);
                            const amountLabel = formatCurrencyCents(
                                inv.amountPaidCents || inv.amountDueCents,
                                inv.currency,
                                locale,
                            );
                            const statusKey = INVOICE_STATUS_KEY[inv.status];
                            const description = buildInvoiceDescription(
                                inv,
                                resolveInvoicePlanName(inv),
                                t,
                                locale,
                            );
                            return (
                                <div
                                    key={inv.id ?? i}
                                    className="account-billing-invoices-table account-billing-invoices-table-row"
                                    style={{
                                        gridTemplateColumns: GRID_COLS,
                                    }}
                                >
                                    <span className="account-billing-invoices-cell-strong">{dateLabel || '—'}</span>
                                    <span className="account-billing-invoices-cell-muted">{description}</span>
                                    <span>{statusKey ? t(statusKey) : inv.status || '—'}</span>
                                    <span className="account-billing-invoices-cell-strong">{amountLabel || '—'}</span>
                                    <span>
                                        {inv.hostedInvoiceUrl ? (
                                            <a
                                                href={inv.hostedInvoiceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="account-billing-invoices-link"
                                            >
                                                {t('account_billing_invoices_view')}
                                                <IconExternalLink />
                                            </a>
                                        ) : (
                                            <span className={ACCOUNT_TEXT_MUTED_CLASS}>—</span>
                                        )}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
