import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AccountPageLayout from '../components/AccountPageLayout';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { accountPageH1Style, ACCOUNT_PAGE_H1_CLASS, ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';
import { apiClient } from '../services/apiClient';
import { getCached, setCached, hasCached } from '../utils/swrCache';

/** @typedef {'VOICE_SECONDS'|'VIDEO_SECONDS'|'SEARCH_CANDIDATE'|'SCREENING'|'TOP_CANDIDATES'|'CV_ANALYSIS'|'JOB_AD'|'CONTACT_REVEAL'|'COMPARE_EMAIL'} UsageType */

/** @typedef {{
 *   id: string;
 *   createdAt: string;
 *   usageType: UsageType;
 *   source: string;
 *   units?: number;
 *   credits: number;
 *   amountMicro: number;
 * }} ActivityRow */

const GRID_COLS = 'minmax(168px,1.5fr) minmax(140px,1.25fr) minmax(96px,0.85fr) minmax(72px,0.7fr)';

const usageCacheKey = (days) => `usage:activity:${days}`;

/** Shimmer placeholder rows shown while the activity ledger loads for the first time. */
function UsageTableSkeleton({ rows = 6 }) {
    return (
        <div aria-hidden="true">
            {Array.from({ length: rows }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: GRID_COLS,
                        gap: 12,
                        alignItems: 'center',
                        padding: '14px 0',
                    }}
                >
                    <span className="ev-skeleton" style={{ height: 12, width: '82%' }} />
                    <span className="ev-skeleton" style={{ height: 12, width: '66%' }} />
                    <span className="ev-skeleton" style={{ height: 12, width: '44%' }} />
                    <span className="ev-skeleton" style={{ height: 12, width: '36%', justifySelf: 'end' }} />
                </div>
            ))}
        </div>
    );
}

/** @type {Record<string, string>} */
const USAGE_TYPE_LABEL_KEYS = {
    VOICE_SECONDS: 'pricing_usage_voice',
    VIDEO_SECONDS: 'pricing_usage_video',
    SEARCH_CANDIDATE: 'pricing_usage_search',
    SCREENING: 'pricing_usage_screening',
    TOP_CANDIDATES: 'pricing_usage_top_candidates',
    CV_ANALYSIS: 'pricing_usage_cv_analysis',
    JOB_AD: 'pricing_usage_job_ad',
    CONTACT_REVEAL: 'pricing_usage_contact_reveal',
    COMPARE_EMAIL: 'pricing_usage_compare_email',
};

const SECONDS_USAGE_TYPES = new Set(['VOICE_SECONDS', 'VIDEO_SECONDS']);

function IconDownload(props) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconChevronDown(props) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * @param {string} preset
 */
function presetToDays(preset) {
    if (preset === '1d') return 1;
    if (preset === '7d') return 7;
    return 30;
}

/**
 * @param {number} credits
 */
function formatCredits(credits) {
    if (!Number.isFinite(credits) || credits <= 0) return '0';
    if (Math.abs(credits - Math.round(credits)) < 0.005) return String(Math.round(credits));
    return credits.toFixed(2);
}

/**
 * @param {ActivityRow} row
 * @param {(k: string) => string} t
 */
function formatDetails(row, t) {
    const units = row.units;
    if (units == null || !Number.isFinite(units)) return '—';
    if (SECONDS_USAGE_TYPES.has(row.usageType)) {
        const totalSec = Math.max(0, Math.floor(units));
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return fillI18nTemplate(t('account_usage_durationFmt'), {
            mins: String(mins),
            secs: String(secs),
        });
    }
    return fillI18nTemplate(t('account_usage_quantityFmt'), { count: String(units) });
}

/**
 * @param {ActivityRow} row
 * @param {(k: string) => string} t
 */
function operationLabel(row, t) {
    // A compare report bills its candidates as SCREENING, since comparing a
    // candidate costs what screening one costs. Naming the row by usage type alone
    // made that charge read as an ordinary screening, so the report looked like it
    // had cost only the single credit on its email row. `source` is what tells them
    // apart.
    if (row.usageType === 'SCREENING' && row.source === 'ai_compare_email') {
        return t('pricing_usage_compare_candidate');
    }
    const key = USAGE_TYPE_LABEL_KEYS[row.usageType];
    return key ? t(key) : row.usageType;
}

/**
 * @param {ActivityRow[]} rows
 * @param {string} dateLocale
 * @param {(k: string) => string} t
 */
function rowsToCsv(rows, dateLocale, t) {
    const header = [
        t('account_usage_headerTime'),
        t('account_usage_headerType'),
        t('account_usage_headerDetails'),
        t('account_usage_headerCost'),
    ].join(',');
    const lines = rows.map((r) => {
        const d = new Date(r.createdAt);
        const dateStr = Number.isNaN(d.getTime())
            ? '—'
            : new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
        return [dateStr, operationLabel(r, t), formatDetails(r, t), formatCredits(r.credits)]
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
            .join(',');
    });
    return [header, ...lines].join('\n');
}

const AccountUsage = () => {
    const { currentLang, t } = useLanguage();
    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';
    const dateLocale = currentLang === 'ar' ? 'ar' : currentLang === 'ku' ? 'ku' : 'en-US';

    const [rangePreset, setRangePreset] = useState('30d');
    const [rows, setRows] = useState(/** @type {ActivityRow[]} */ (() => getCached(usageCacheKey(presetToDays('30d'))) ?? []));
    const [loading, setLoading] = useState(() => !hasCached(usageCacheKey(presetToDays('30d'))));
    const [loadError, setLoadError] = useState(null);

    const days = presetToDays(rangePreset);

    const fetchActivity = useCallback(async () => {
        const key = usageCacheKey(days);
        const cached = getCached(key);
        // Show cached rows instantly (also on range switch); only skeleton if nothing cached.
        if (cached) {
            setRows(cached);
            setLoading(false);
        } else {
            setLoading(true);
        }
        setLoadError(null);
        try {
            const res = await apiClient.get(`/api/billing/activity?days=${days}&limit=200`);
            if (res?.ok && Array.isArray(res.entries)) {
                setRows(res.entries);
                setCached(key, res.entries);
            } else if (!cached) {
                setRows([]);
                setLoadError(res?.message || t('account_usage_loadError'));
            }
        } catch (err) {
            if (!cached) {
                setRows([]);
                setLoadError(err instanceof Error ? err.message : t('account_usage_loadError'));
            }
        } finally {
            setLoading(false);
        }
    }, [days, t]);

    useEffect(() => {
        fetchActivity();
    }, [fetchActivity]);

    const displayedRows = useMemo(
        () =>
            [...rows].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            ),
        [rows],
    );

    /** @param {string} iso */
    const formatDateTime = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    };

    const dateRangeLabel =
        rangePreset === '1d'
            ? t('account_usage_range1d')
            : rangePreset === '7d'
              ? t('account_usage_range7d')
              : t('account_usage_range30d');

    const exportCsv = () => {
        const csv = rowsToCsv(displayedRows, dateLocale, t);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `operations-activity-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const segmentBtn = (id, label) => {
        const active = rangePreset === id;
        return (
            <button
                key={id}
                type="button"
                onClick={() => setRangePreset(id)}
                className={`workflow-btn-primary account-usage-pill${active ? ' account-usage-pill--on' : ''}`}
            >
                {label}
            </button>
        );
    };

    const usageInjectStyle = `
                @media (max-width: 960px) {
                    .account-dashboard-inner { flex-direction: column !important; }
                    .account-usage-page aside {
                        position: relative !important;
                        top: 0 !important;
                        width: 100% !important;
                    }
                }
            `;

    const textAlignNum = mainDir === 'rtl' ? 'left' : 'right';

    return (
        <AccountPageLayout pageClass="account-usage-page" injectStyle={usageInjectStyle}>
            <AccountSidebar activeId="usage" />

            <main dir={mainDir} style={{ flex: 1, minWidth: 0 }}>
                <AccountMobileNav activeId="usage" />
                <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 24px')}>
                    {t('account_usage_pageTitle')}
                </h1>

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 16,
                        marginBottom: 20,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <button type="button" className="workflow-btn-primary account-usage-date">
                            {dateRangeLabel}
                            <IconChevronDown style={{ opacity: 0.7 }} />
                        </button>
                        <div
                            className="account-usage-segment"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: 3,
                                borderRadius: 8,
                                gap: 2,
                            }}
                        >
                            {segmentBtn('1d', t('account_usage_segment1d'))}
                            {segmentBtn('7d', t('account_usage_segment7d'))}
                            {segmentBtn('30d', t('account_usage_segment30d'))}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={exportCsv}
                        className="workflow-btn-primary account-btn-connect"
                        disabled={displayedRows.length === 0}
                    >
                        <IconDownload />
                        {t('account_usage_exportCsv')}
                    </button>
                </div>

                <div className="dashboard-card" style={{ padding: 0, overflowX: 'auto' }}>
                    <div style={{ minWidth: 640 }}>
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: GRID_COLS,
                                gap: 12,
                                padding: '16px 22px 12px',
                            }}
                            className="account-usage-table-header"
                        >
                            <span>{t('account_usage_headerTime')}</span>
                            <span>{t('account_usage_headerType')}</span>
                            <span>{t('account_usage_headerDetails')}</span>
                            <span style={{ textAlign: textAlignNum }}>{t('account_usage_headerCost')}</span>
                        </div>
                        <div style={{ padding: '0 22px 8px' }}>
                            {loading ? (
                                <UsageTableSkeleton />
                            ) : loadError ? (
                                <div
                                    className={ACCOUNT_TEXT_MUTED_CLASS}
                                    style={{ padding: '28px 22px', fontSize: 14, textAlign: 'center', color: '#dc2626' }}
                                >
                                    {loadError}
                                </div>
                            ) : displayedRows.length === 0 ? (
                                <div
                                    className={ACCOUNT_TEXT_MUTED_CLASS}
                                    style={{ padding: '28px 22px', fontSize: 14, textAlign: 'center' }}
                                >
                                    {t('account_usage_empty')}
                                </div>
                            ) : (
                                displayedRows.map((row) => (
                                    <div
                                        key={row.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: GRID_COLS,
                                            gap: 12,
                                            alignItems: 'center',
                                            padding: '14px 0',
                                        }}
                                        className="account-usage-table-row"
                                    >
                                        <span className="account-table-cell-strong">
                                            {formatDateTime(row.createdAt)}
                                        </span>
                                        <span className="account-table-cell-muted">{operationLabel(row, t)}</span>
                                        <span className="account-table-cell-muted">{formatDetails(row, t)}</span>
                                        <span
                                            className="account-table-cell-strong"
                                            style={{ textAlign: textAlignNum }}
                                            dir="ltr"
                                        >
                                            {formatCredits(row.credits)}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </AccountPageLayout>
    );
};

export default AccountUsage;
