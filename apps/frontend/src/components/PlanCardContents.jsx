import React from 'react';
import {
    formatMonthlyCredits,
    getIncludedVideoMinutes,
    listIncrementalFeaturesForPlan,
    buildPricingFeatureRows,
} from '../utils/billingDisplay';
import { launchPromoBonus } from '../config/launchPromo';

const REFRAME_PLANS = new Set(['team', 'professional', 'business']);

function CheckIcon() {
    return (
        <svg
            className="pricing-card__feature-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
        >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * Shared plan body: monthly credits, typical-month usage lines, incremental features.
 * Used on the public Pricing page and AdjustPlanModal.
 *
 * @param {object} props
 * @param {string} props.planId
 * @param {(key: string) => string} props.t
 */
export function PlanCardContents({ planId, t }) {
    if (!planId) return null;

    const features = listIncrementalFeaturesForPlan(planId);
    const includedVideoMinutes = getIncludedVideoMinutes(planId);
    const featureRows = buildPricingFeatureRows(planId, features, includedVideoMinutes, t);
    const promoBonus = launchPromoBonus(planId);
    const showReframe = REFRAME_PLANS.has(planId);
    const typicalLines = showReframe
        ? (t(`pricing_typical_${planId}`) || '').split('|').map((s) => s.trim()).filter(Boolean)
        : [];
    const allFeatureRows = [
        ...typicalLines.map((line, i) => ({ key: `tm-${i}`, label: line })),
        ...featureRows,
    ];

    return (
        <>
            <div className="pricing-card__credits" dir="ltr">
                <div className="pricing-card__credits-row">
                    <span className="pricing-card__credits-value">{formatMonthlyCredits(planId)}</span>
                    <span className="pricing-card__credits-word">{t('pricing_credits_word')}</span>
                </div>
            </div>
            <div className="pricing-card__promo" dir="auto">
                {promoBonus > 0 ? (
                    <span className="pricing-card__promo-pill">
                        ✦ {t('billing_launch_promo')} +{promoBonus.toLocaleString()}
                    </span>
                ) : null}
            </div>
            <div className="pricing-card__body">
                <ul className="pricing-card__features">
                    {allFeatureRows.map((row) => (
                        <li key={row.key} className="pricing-card__feature">
                            <CheckIcon />
                            <span>{row.label}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </>
    );
}

export default PlanCardContents;
