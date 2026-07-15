import React from 'react';
import {
    formatMonthlyCredits,
    getIncludedVideoMinutes,
    getPricingIncludesKey,
    listIncrementalFeaturesForPlan,
    buildPricingFeatureRows,
} from '../utils/billingDisplay';

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
 * Shared plan body: monthly credits, "everything in X plus" note, incremental features.
 * Used on the public Pricing page and AdjustPlanModal.
 *
 * @param {object} props
 * @param {string} props.planId
 * @param {(key: string) => string} props.t
 */
export function PlanCardContents({ planId, t }) {
    if (!planId) return null;

    const features = listIncrementalFeaturesForPlan(planId);
    const includesKey = getPricingIncludesKey(planId);
    const includedVideoMinutes = getIncludedVideoMinutes(planId);
    const featureRows = buildPricingFeatureRows(planId, features, includedVideoMinutes, t);

    return (
        <>
            <div className="pricing-card__credits" dir="ltr">
                <div className="pricing-card__credits-row">
                    <span className="pricing-card__credits-value">{formatMonthlyCredits(planId)}</span>
                    <span className="pricing-card__credits-word">{t('pricing_credits_word')}</span>
                </div>
            </div>
            {includesKey ? <p className="pricing-card__includes-note">{t(includesKey)}</p> : null}
            <ul className="pricing-card__features">
                {featureRows.map((row) => (
                    <li key={row.key} className="pricing-card__feature">
                        <CheckIcon />
                        <span>{row.label}</span>
                    </li>
                ))}
            </ul>
        </>
    );
}

export default PlanCardContents;
