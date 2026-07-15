/**
 * AccountBillingCancel — Stripe cancel_url landing page (Phase 2b).
 * Stripe redirects here when the user closes Checkout before paying.
 * No subscription was created — we just give the user a clear back-link.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import '../design-styles.css';
import './billing-result-pages.css';

function CancelIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
            <path
                d="M9 9l6 6M15 9l-6 6"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
            />
        </svg>
    );
}

export default function AccountBillingCancel() {
    const { t, currentLang } = useLanguage();
    const pageDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    return (
        <div className="billing-cancel-page" dir={pageDir}>
            <div className="billing-cancel-card">
                <div className="billing-cancel-card__icon">
                    <CancelIcon />
                </div>

                <h1 className="billing-cancel-card__title">{t('billing_cancel_title')}</h1>
                <p className="billing-cancel-card__subtitle">{t('billing_cancel_subtitle')}</p>

                <div className="billing-cancel-note">{t('billing_cancel_no_charge_note')}</div>

                <div className="billing-cancel-actions">
                    <Link
                        to="/account/billing"
                        className="billing-cancel-btn workflow-btn-primary ni-continue-btn"
                    >
                        {t('billing_cancel_cta_back')}
                    </Link>
                    <Link to="/dashboard" className="billing-cancel-btn btn btn-secondary">
                        {t('billing_success_cta_dashboard')}
                    </Link>
                </div>
            </div>
        </div>
    );
}
