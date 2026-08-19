import React, { useState } from 'react';
import apiClient from '../services/apiClient';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * "Suggest criteria with AI" button for the search pages (Head Hunter + CV
 * Comparison). Activates only once both position and location are filled; calls
 * the page's suggest-criteria endpoint (1 credit) and hands the returned filter
 * values to onApply, which maps them onto the page's optional filters.
 *
 * Props:
 *   endpoint  — '/api/head-hunter/suggest-criteria' | '/api/cv-comparison/suggest-criteria'
 *   position  — current position value (string)
 *   location  — current location value (string)
 *   onApply   — (criteria: Record<string,string>) => void
 */
export default function SuggestSearchCriteriaButton({ endpoint, position, location, onApply }) {
    const { t, currentLang } = useLanguage();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const ready = Boolean((position || '').trim() && (location || '').trim());

    const handleClick = async () => {
        if (!ready) {
            setError(t('newCampaign_suggestNeedPositionLocation'));
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await apiClient.post(endpoint, {
                position: position.trim(),
                location: location.trim(),
                language: currentLang,
            });
            if (result?.success && result.criteria && Object.keys(result.criteria).length) {
                onApply(result.criteria);
            } else {
                setError(result?.message || t('newCampaign_suggestFailed'));
            }
        } catch (err) {
            setError(
                err?.status === 402
                    ? t('newCampaign_suggestInsufficientCredits')
                    : t('newCampaign_suggestFailed')
            );
        } finally {
            setLoading(false);
        }
    };

    const disabled = loading || !ready;

    return (
        <div style={{ margin: '10px 0' }}>
            <button
                type="button"
                onClick={handleClick}
                disabled={disabled}
                title={ready ? t('newCampaign_suggestHint') : t('newCampaign_suggestNeedPositionLocation')}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '9px 16px',
                    borderRadius: '10px',
                    border: '1px solid rgba(99, 102, 241, 0.35)',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(139,92,246,0.10))',
                    color: '#6366f1',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.6 : 1,
                    transition: 'opacity 0.15s ease',
                }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path
                        fill="currentColor"
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                    />
                </svg>
                <span>{loading ? t('newCampaign_suggesting') : t('newCampaign_suggestButton')}</span>
            </button>
            {error && (
                <div role="alert" style={{ marginTop: '8px', color: '#dc2626', fontSize: '12.5px', fontWeight: 500 }}>
                    {error}
                </div>
            )}
        </div>
    );
}
