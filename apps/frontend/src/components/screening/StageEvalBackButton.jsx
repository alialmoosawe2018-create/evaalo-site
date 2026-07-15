import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

export default function StageEvalBackButton({ onClick }) {
    const { t } = useLanguage();

    return (
        <button
            type="button"
            className="btn btn-secondary candidates-toolbar-filter-btn stage-eval-back-btn"
            onClick={onClick}
        >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path
                    d="M12.5 15L7.5 10L12.5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
            <span className="btn-text">{t('candidates_back')}</span>
        </button>
    );
}
