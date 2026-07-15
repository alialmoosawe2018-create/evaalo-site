import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const ProcessOpsIcon = () => (
    <div className="step-icon process-ops-card__icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="34" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="34" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 15.5L21.5 30.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M31.5 15.5L26.5 30.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M18 12H30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <rect x="8" y="38" width="32" height="6" rx="1.5" stroke="currentColor" strokeWidth="2" />
        </svg>
    </div>
);

export default function ProcessEmptyCardPanel() {
    const { t } = useLanguage();

    return (
        <div className="process-empty-card-shell">
            <div
                className="process-step process-step--ops-card process-step--reveal process-step--reveal-flow process-ops-card--reveal"
                style={{ '--process-reveal-delay': '0s' }}
            >
                <ProcessOpsIcon />
                <div className="process-ops-card__body">
                    <h3 className="step-title">{t('processOpsCardTitle')}</h3>
                    <p className="step-description">{t('processOpsDescription')}</p>
                </div>
            </div>
        </div>
    );
}
