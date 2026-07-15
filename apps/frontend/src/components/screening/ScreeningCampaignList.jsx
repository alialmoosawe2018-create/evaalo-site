import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import { localizeCatalogLabel } from '../../utils/localizeCatalogLabel.js';
import ScreeningConfirmModal from './ScreeningConfirmModal.jsx';

/**
 * Campaign list for Stage 1 Screening — Head Hunter search-history layout.
 *
 * @param {object} props
 * @param {import('../utils/screeningCampaigns.js').buildScreeningCampaignGroups extends Function ? object : any[]} props.activeCampaigns
 * @param {object | null} props.uncategorized
 * @param {(selectionKey: string) => void} props.onSelect
 * @param {() => void} [props.onRefresh]
 * @param {string} [props.titleKey]
 * @param {string} [props.emptyKey]
 * @param {string} [props.activeSectionKey]
 * @param {string} [props.uncategorizedSectionKey]
 */
export default function ScreeningCampaignList({
    activeCampaigns = [],
    uncategorized = null,
    onSelect,
    onRefresh,
    onHideCampaign,
    onToggleCampaignStatus,
    titleKey = 'screeningCampaignsTitle',
    emptyKey = 'screeningCampaignsEmpty',
    activeSectionKey = 'screeningCampaignsActiveSection',
    uncategorizedSectionKey = 'screeningCampaignUncategorizedSection',
}) {
    const { t, currentLang } = useLanguage();
    const [viewMode, setViewMode] = useState(/** @type {'list' | 'cards'} */ ('cards'));
    /** @type {[object | null, Function]} */
    const [confirmRow, setConfirmRow] = useState(null);
    const [hiding, setHiding] = useState(false);
    /** @type {[object | null, Function]} */
    const [statusRow, setStatusRow] = useState(null);
    const [togglingStatus, setTogglingStatus] = useState(false);

    const handleConfirmHide = async () => {
        if (!confirmRow || !onHideCampaign) {
            setConfirmRow(null);
            return;
        }
        setHiding(true);
        try {
            await onHideCampaign(confirmRow);
            setConfirmRow(null);
        } finally {
            setHiding(false);
        }
    };

    const handleConfirmStatus = async () => {
        if (!statusRow || !onToggleCampaignStatus) {
            setStatusRow(null);
            return;
        }
        const nextStatus = statusRow.isClosed ? 'active' : 'closed';
        setTogglingStatus(true);
        try {
            await onToggleCampaignStatus(statusRow, nextStatus);
            setStatusRow(null);
        } finally {
            setTogglingStatus(false);
        }
    };

    const locale =
        currentLang === 'ar' ? 'ar' : currentLang === 'ku' ? 'ckb-IQ' : 'en-US';

    const formatDate = (d) => {
        if (!d) return '';
        try {
            return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                d instanceof Date ? d : new Date(d)
            );
        } catch {
            return new Date(d).toLocaleString();
        }
    };

    const hasAny = activeCampaigns.length > 0 || Boolean(uncategorized?.totalCount);

    const renderStats = (row) => (
        <span className="screening-campaign-row__stats">
            {row.pendingCount > 0 && (
                <span className="screening-campaign-row__stat screening-campaign-row__stat--pending">
                    {fillI18nTemplate(t('screeningCampaignStatPending'), { n: row.pendingCount })}
                </span>
            )}
            {row.considerCount > 0 && (
                <span className="screening-campaign-row__stat screening-campaign-row__stat--consider">
                    {fillI18nTemplate(t('screeningCampaignStatConsider'), { n: row.considerCount })}
                </span>
            )}
            {row.hireCount > 0 && (
                <span className="screening-campaign-row__stat screening-campaign-row__stat--hire">
                    {fillI18nTemplate(t('screeningCampaignStatHire'), { n: row.hireCount })}
                </span>
            )}
            {row.rejectCount > 0 && (
                <span className="screening-campaign-row__stat screening-campaign-row__stat--reject">
                    {fillI18nTemplate(t('screeningCampaignStatReject'), { n: row.rejectCount })}
                </span>
            )}
        </span>
    );

    const renderRow = (row) => {
        const dateLabel = formatDate(row.lastActivityAt || row.campaignCreatedAt);
        const canToggleStatus =
            Boolean(onToggleCampaignStatus) && Boolean(row.campaignId) && !row.isDeleted && !row.isUncategorized;
        return (
            <li
                key={row.selectionKey}
                className={
                    'screening-campaign-row-wrap' +
                    (row.isClosed ? ' screening-campaign-row-wrap--closed' : '')
                }
            >
                <button
                    type="button"
                    className="headhunter-campaign-history-row screening-campaign-history-row"
                    onClick={() => onSelect(row.selectionKey)}
                >
                    <span className="headhunter-campaign-history-row__title">
                        {localizeCatalogLabel(row.title, currentLang)}
                        {row.isClosed ? (
                            <span className="screening-campaign-row__closed-badge">
                                {t('screeningCampaignClosedBadge')}
                            </span>
                        ) : null}
                    </span>
                    <span className="headhunter-campaign-history-row__meta">
                        {dateLabel ? (
                            <>
                                {dateLabel}
                                <span aria-hidden="true"> · </span>
                            </>
                        ) : null}
                        {row.location ? (
                            <>
                                {localizeCatalogLabel(row.location, currentLang)}
                                <span aria-hidden="true"> · </span>
                            </>
                        ) : null}
                        {fillI18nTemplate(t('screeningCampaignStatTotal'), { n: row.totalCount })}
                    </span>
                    {(row.pendingCount > 0 ||
                        row.considerCount > 0 ||
                        row.hireCount > 0 ||
                        row.rejectCount > 0) &&
                        renderStats(row)}
                </button>
                {canToggleStatus ? (
                    <button
                        type="button"
                        className={
                            'btn btn-secondary screening-campaign-status-btn' +
                            (row.isClosed ? ' screening-campaign-status-btn--reopen' : '')
                        }
                        title={row.isClosed ? t('screeningCampaignReopenCard') : t('screeningCampaignCloseCard')}
                        aria-label={row.isClosed ? t('screeningCampaignReopenCard') : t('screeningCampaignCloseCard')}
                        onClick={(e) => {
                            e.stopPropagation();
                            setStatusRow(row);
                        }}
                    >
                        {row.isClosed ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path
                                    d="M7 11V7a5 5 0 019.9-1M5 11h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path
                                    d="M7 11V7a5 5 0 0110 0v4M5 11h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        )}
                    </button>
                ) : null}
                {onHideCampaign ? (
                    <button
                        type="button"
                        className="btn btn-secondary screening-campaign-delete-btn"
                        title={t('screeningCampaignHideCard')}
                        aria-label={t('screeningCampaignHideCard')}
                        onClick={(e) => {
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
                ) : null}
            </li>
        );
    };

    const listClass =
        'headhunter-campaign-history-list' +
        (viewMode === 'cards' ? ' headhunter-campaign-history-list--cards' : '');

    return (
        <>
            <div className="dashboard-card-header">
                <h2 className="dashboard-card-title">{t(titleKey)}</h2>
                <div className="header-actions">
                    {onRefresh ? (
                        <button
                            type="button"
                            className="btn btn-secondary candidates-toolbar-filter-btn"
                            onClick={onRefresh}
                        >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M16 10C16 13.3137 13.3137 16 10 16C6.68629 16 4 13.3137 4 10C4 6.68629 6.68629 4 10 4C11.82 4 13.45 4.81 14.55 6.08" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M16 4V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="btn-text">{t('stageEval_refresh')}</span>
                        </button>
                    ) : null}
                    {hasAny ? (
                        <button
                            type="button"
                            className={`btn btn-secondary candidates-toolbar-filter-btn${viewMode === 'cards' ? ' candidates-toolbar-filter-btn--open' : ''}`}
                            aria-pressed={viewMode === 'cards'}
                            onClick={() => setViewMode((v) => (v === 'list' ? 'cards' : 'list'))}
                        >
                            {viewMode === 'cards' ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                        d="M8 6H21M8 12H21M8 18H21M3 6h.01M3 12h.01M3 18h.01"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                        d="M14 14H20V20H14V14ZM3 14H10V20H3V14ZM14 3H20V10H14V3ZM3 3H10V10H3V3Z"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                            <span className="btn-text">
                                {viewMode === 'cards'
                                    ? t('aiHeadHunterSearchHistoryShowListView')
                                    : t('aiHeadHunterSearchHistoryShowCardGrid')}
                            </span>
                        </button>
                    ) : null}
                </div>
            </div>
            <div className="dashboard-card-body">
                {!hasAny ? (
                    <p className="headhunter-campaign-history-empty" role="status">
                        {t(emptyKey)}
                    </p>
                ) : (
                    <>
                        {activeCampaigns.length > 0 ? (
                            <>
                                <h3 className="screening-campaign-section-title">
                                    {t(activeSectionKey)}
                                </h3>
                                <ul className={listClass} role="list">
                                    {activeCampaigns.map(renderRow)}
                                </ul>
                            </>
                        ) : null}

                        {uncategorized && uncategorized.totalCount > 0 ? (
                            <>
                                <hr className="screening-campaign-section-divider" aria-hidden="true" />
                                <h3 className="screening-campaign-section-title">
                                    {t(uncategorizedSectionKey)}
                                </h3>
                                <ul className={listClass} role="list">{renderRow(uncategorized)}</ul>
                            </>
                        ) : null}
                    </>
                )}
            </div>

            <ScreeningConfirmModal
                open={Boolean(confirmRow)}
                onDismiss={() => {
                    if (!hiding) setConfirmRow(null);
                }}
                onConfirm={handleConfirmHide}
                title={t('screeningCampaignHideTitle')}
                description={
                    confirmRow
                        ? fillI18nTemplate(t('screeningCampaignHideConfirm'), {
                              title: confirmRow.title,
                              n: confirmRow.totalCount,
                          })
                        : ''
                }
                cancelLabel={t('screeningCampaignHideCancel')}
                confirmLabel={hiding ? t('screeningCampaignHiding') : t('screeningCampaignHideConfirmBtn')}
                confirming={hiding}
                confirmVariant="primary"
                icon="warning"
            />

            <ScreeningConfirmModal
                open={Boolean(statusRow)}
                onDismiss={() => {
                    if (!togglingStatus) setStatusRow(null);
                }}
                onConfirm={handleConfirmStatus}
                title={
                    statusRow?.isClosed
                        ? t('screeningCampaignReopenTitle')
                        : t('screeningCampaignCloseTitle')
                }
                description={
                    statusRow
                        ? fillI18nTemplate(
                              statusRow.isClosed
                                  ? t('screeningCampaignReopenConfirm')
                                  : t('screeningCampaignCloseConfirm'),
                              { title: statusRow.title },
                          )
                        : ''
                }
                cancelLabel={t('screeningCampaignHideCancel')}
                confirmLabel={
                    togglingStatus
                        ? t('screeningCampaignStatusSaving')
                        : statusRow?.isClosed
                          ? t('screeningCampaignReopenConfirmBtn')
                          : t('screeningCampaignCloseConfirmBtn')
                }
                confirming={togglingStatus}
                confirmVariant="primary"
                icon="lock"
            />
        </>
    );
}
