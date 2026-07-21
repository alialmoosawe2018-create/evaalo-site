import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { normalizeHeadHunterPayload } from '../utils/headHunterNormalize.js';
import { useHeadHunterSearchHistory } from '../hooks/useHeadHunterSearchHistory.js';
import '../design-styles.css';

/**
 * قائمة بحثيات Head Hunter المحفوظة محلياً.
 */
export default function HeadHunterSearchHistory() {
    const { t, currentLang } = useLanguage();
    const { list, remove } = useHeadHunterSearchHistory();
    const [historyViewMode, setHistoryViewMode] = useState(/** @type {'list' | 'cards'} */ ('cards'));
    /** @type {[object | null, Function]} */
    const [confirmRow, setConfirmRow] = useState(null);
    const [hiding, setHiding] = useState(false);

    const handleConfirmHide = async () => {
        if (!confirmRow) {
            setConfirmRow(null);
            return;
        }
        setHiding(true);
        try {
            remove(confirmRow.id);
            setConfirmRow(null);
        } finally {
            setHiding(false);
        }
    };

    const formatMetaDate = (iso) => {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const minutes = pad(date.getMinutes());
        let hours = date.getHours();
        if (currentLang === 'ar' || currentLang === 'ku') {
            const period = hours >= 12 ? 'م' : 'ص';
            const h12 = hours % 12 || 12;
            return `${day}/${month}/${year}، ${h12}:${minutes} ${period}`;
        }
        const period = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours % 12 || 12;
        return `${month}/${day}/${year}, ${h12}:${minutes} ${period}`;
    };

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const rows = useMemo(
        () =>
            list.map((row) => ({
                ...row,
                nCandidates: normalizeHeadHunterPayload(row.payload).candidates.length,
            })),
        [list],
    );

    return (
        <div
            className="dashboard-page dashboard-page--evaalo-visual ai-head-hunter-page headhunter-campaign-history-page dashboard-page--full-viewport-shell"
            style={{ color: '#ffffff', position: 'relative' }}
        >
            <div className="design-background design-background--evaalo-visual">
                <div className="design-orb-1" />
                <div className="design-orb-2" />
                <div className="design-orb-3" />
            </div>
            <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
            <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

            <div className="container dashboard-visual-container">
                <div className="dashboard-grid">
                    <div className="dashboard-card dashboard-card--page-active platform-features-card">
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">{t('aiHeadHunterSearchHistoryTitle')}</h2>
                            {rows.length > 0 ? (
                                <div className="header-actions">
                                    <button
                                        type="button"
                                        className={`btn btn-secondary candidates-toolbar-filter-btn${historyViewMode === 'cards' ? ' candidates-toolbar-filter-btn--open' : ''}`}
                                        aria-pressed={historyViewMode === 'cards'}
                                        onClick={() =>
                                            setHistoryViewMode((v) => (v === 'list' ? 'cards' : 'list'))
                                        }
                                    >
                                        {historyViewMode === 'cards' ? (
                                            <svg
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                                aria-hidden
                                            >
                                                <path
                                                    d="M8 6H21M8 12H21M8 18H21M3 6h.01M3 12h.01M3 18h.01"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        ) : (
                                            <svg
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                                aria-hidden
                                            >
                                                <path
                                                    d="M14 14H20V20H14V14ZM3 14H10V20H3V14ZM14 3H20V10H14V3ZM3 3H10V10H3V3Z"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        )}
                                        <span className="btn-text">
                                            {historyViewMode === 'cards'
                                                ? t('aiHeadHunterSearchHistoryShowListView')
                                                : t('aiHeadHunterSearchHistoryShowCardGrid')}
                                        </span>
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        <div className="dashboard-card-body">
                            {rows.length === 0 ? (
                                <p className="headhunter-campaign-history-empty" role="status">
                                    {t('aiHeadHunterSearchHistoryEmpty')}
                                </p>
                            ) : (
                                <ul
                                    className={
                                        'headhunter-campaign-history-list' +
                                        (historyViewMode === 'cards' ? ' headhunter-campaign-history-list--cards' : '')
                                    }
                                    role="list"
                                >
                                    {rows.map((row) => (
                                        <li key={row.id} className="screening-campaign-row-wrap">
                                            <Link
                                                to={`/ai-head-hunter/campaign/${row.id}`}
                                                className="headhunter-campaign-history-row"
                                            >
                                                <span className="headhunter-campaign-history-row__title">
                                                    {row.position}
                                                </span>
                                                <span className="headhunter-campaign-history-row__meta">
                                                    <span className="headhunter-campaign-history-row__meta-date" dir="ltr">
                                                        {formatMetaDate(row.receivedAt)}
                                                    </span>
                                                    <span aria-hidden="true"> · </span>
                                                    {row.location}
                                                    <span aria-hidden="true"> · </span>
                                                    {t('aiHeadHunterCampaignCandidatesCountShort').replace(
                                                        '{n}',
                                                        String(row.nCandidates),
                                                    )}
                                                </span>
                                            </Link>
                                            <button
                                                type="button"
                                                className="btn btn-secondary screening-campaign-delete-btn"
                                                title={t('screeningCampaignHideCard')}
                                                aria-label={t('screeningCampaignHideCard')}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setConfirmRow(row);
                                                }}
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                                    <path
                                                        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {confirmRow ? (
                <div
                    className="ai-compare-modal-overlay screening-campaign-delete-overlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => (hiding ? null : setConfirmRow(null))}
                >
                    <div className="ai-compare-modal screening-campaign-delete-modal" onClick={(e) => e.stopPropagation()}>
                        <h3 className="screening-campaign-delete-modal__title">
                            {t('screeningCampaignHideTitle')}
                        </h3>
                        <p className="screening-campaign-delete-modal__text">
                            {fillI18nTemplate(t('screeningCampaignHideConfirm'), {
                                title: confirmRow.position,
                                n: confirmRow.nCandidates,
                            })}
                        </p>
                        <div className="screening-campaign-delete-modal__actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setConfirmRow(null)}
                                disabled={hiding}
                            >
                                {t('screeningCampaignHideCancel')}
                            </button>
                            <button
                                type="button"
                                className="btn screening-campaign-delete-modal__confirm"
                                onClick={handleConfirmHide}
                                disabled={hiding}
                            >
                                {hiding
                                    ? t('screeningCampaignHiding')
                                    : t('screeningCampaignHideConfirmBtn')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
