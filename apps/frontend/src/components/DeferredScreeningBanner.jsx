// ============================================
// File: components/DeferredScreeningBanner.jsx
// Purpose: Warn an organization that new applications were received but their
// AI screening is queued until credits are topped up. The applications are
// saved — nothing is lost — so the wording reassures rather than alarms.
// Count comes from GET /api/billing/status via BillingContext, so the banner
// clears itself on the next poll once the queue drains after a top-up.
// ============================================

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBilling } from '../contexts/BillingContext';
import { useLanguage } from '../contexts/LanguageContext';

const DISMISS_KEY = 'evaalo:deferredScreeningBannerDismissed';

const DeferredScreeningBanner = () => {
    const { deferredScreeningCount, isLoaded } = useBilling();
    const { t } = useLanguage();
    const [dismissed, setDismissed] = useState(() => {
        try {
            return window.sessionStorage.getItem(DISMISS_KEY) === '1';
        } catch {
            return false;
        }
    });

    const count = Number.isFinite(deferredScreeningCount) ? deferredScreeningCount : 0;
    if (!isLoaded || dismissed || count <= 0) return null;

    const handleDismiss = () => {
        setDismissed(true);
        try {
            window.sessionStorage.setItem(DISMISS_KEY, '1');
        } catch {
            /* ignore */
        }
    };

    return (
        <div
            role="status"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '12px 16px',
                marginBottom: 20,
                borderRadius: 12,
                border: '1px solid rgba(251,191,36,0.45)',
                background: 'rgba(251,191,36,0.10)',
                fontSize: 14,
                lineHeight: 1.5,
            }}
        >
            <span aria-hidden="true" style={{ fontSize: 18 }}>
                ⏳
            </span>
            <span style={{ flex: '1 1 240px' }}>
                {t('deferredScreening_banner_text').replace('{count}', String(count))}
            </span>
            <Link
                to="/pricing"
                className="workflow-btn-primary account-btn-compact"
                style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
                {t('deferredScreening_banner_cta')}
            </Link>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('deferredScreening_banner_dismiss')}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                    opacity: 0.6,
                    fontSize: 18,
                    lineHeight: 1,
                    padding: 4,
                }}
            >
                ×
            </button>
        </div>
    );
};

export default DeferredScreeningBanner;
