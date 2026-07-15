import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const ProcessCvComparisonIcon = () => (
    <div className="step-icon process-ops-card__icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="7" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="2" />
            <rect x="28" y="7" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M9 12h5M9 15h7M9 18h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="M31 12h5M31 15h7M31 18h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="M13 24L24 30M35 24L24 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 30v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="24" cy="37" r="3" stroke="currentColor" strokeWidth="2" />
        </svg>
    </div>
);

export default function ProcessCvComparisonPanel() {
    const { t } = useLanguage();

    return (
        <div className="process-empty-card-shell">
            <div
                className="process-step process-step--ops-card process-step--reveal process-step--reveal-flow process-cv-comparison-card--reveal"
                style={{ '--process-reveal-delay': '0s' }}
            >
                <ProcessCvComparisonIcon />
                <div className="process-ops-card__body">
                    <h3 className="step-title">{t('processCvComparisonCardTitle')}</h3>
                    <p className="step-description">{t('processCvComparisonDescription')}</p>
                </div>
            </div>
        </div>
    );
}
