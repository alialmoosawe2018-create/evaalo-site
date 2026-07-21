// ============================================
// File: components/FreePlanBanner.jsx
// Purpose: Dashboard banner for accounts on the auto-granted free plan
// (150 one-time credits). Shows the remaining balance with an upgrade CTA.
// Dismissible per session; hides itself on paid plans.
// ============================================

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBilling } from '../contexts/BillingContext';
import { useLanguage } from '../contexts/LanguageContext';

const DISMISS_KEY = 'evaalo:freePlanBannerDismissed';

const FreePlanBanner = () => {
    const { currentPlanId, creditsRemaining, loading } = useBilling();
    const { t } = useLanguage();
    const [dismissed, setDismissed] = useState(() => {
        try {
            return window.sessionStorage.getItem(DISMISS_KEY) === '1';
        } catch {
            return false;
        }
    });

    if (loading || dismissed || currentPlanId !== 'free') return null;

    const remaining = Number.isFinite(creditsRemaining) ? Math.max(0, Math.floor(creditsRemaining)) : 0;
    const exhausted = remaining <= 0;

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
                border: `1px solid ${exhausted ? 'rgba(248,113,113,0.45)' : 'rgba(139,92,246,0.4)'}`,
                background: exhausted ? 'rgba(248,113,113,0.10)' : 'rgba(139,92,246,0.10)',
                fontSize: 14,
                lineHeight: 1.5,
            }}
        >
            <span aria-hidden="true" style={{ fontSize: 18 }}>
                {exhausted ? '⚠️' : '✨'}
            </span>
            <span style={{ flex: '1 1 240px' }}>
                {exhausted
                    ? t('freePlan_banner_exhausted')
                    : t('freePlan_banner_text').replace('{credits}', String(remaining))}
            </span>
            <Link
                to="/pricing"
                className="workflow-btn-primary account-btn-compact"
                style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
                {t('freePlan_banner_cta')}
            </Link>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('freePlan_banner_dismiss')}
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

export default FreePlanBanner;
