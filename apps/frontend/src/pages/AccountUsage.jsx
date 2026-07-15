import React, { useEffect, useMemo, useState } from 'react';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AccountPageLayout from '../components/AccountPageLayout';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { accountPageH1Style, ACCOUNT_PAGE_H1_CLASS, ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const SESSIONS_API_KEY = import.meta.env.VITE_VIDEO_INTERVIEW_SESSIONS_API_KEY || '';

/** @typedef {'video' | 'voice' | 'screen'} InterviewMode */
/** @typedef {{ sessionId?: string, startedAt: string, endedAt?: string, mode: InterviewMode, status?: string }} UsageRow */

const GRID_COLS = 'minmax(168px,1.5fr) minmax(112px,1.05fr) minmax(88px,0.75fr) minmax(96px,0.85fr)';

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

function buildMockInterviewRows() {
    const now = Date.now();
    const h = 3600000;
    const m = 60000;
    return [
        {
            sessionId: 'mock-video-1',
            startedAt: new Date(now - 2 * h).toISOString(),
            endedAt: new Date(now - 2 * h + 18 * m).toISOString(),
            mode: 'video',
            status: 'completed',
        },
        {
            sessionId: 'mock-voice-1',
            startedAt: new Date(now - 5 * h).toISOString(),
            endedAt: new Date(now - 5 * h + 33 * m).toISOString(),
            mode: 'voice',
            status: 'completed',
        },
        {
            sessionId: 'mock-screen-1',
            startedAt: new Date(now - 26 * h).toISOString(),
            endedAt: new Date(now - 26 * h + 42 * m).toISOString(),
            mode: 'screen',
            status: 'completed',
        },
        {
            sessionId: 'mock-video-2',
            startedAt: new Date(now - 9 * h).toISOString(),
            endedAt: new Date(now - 9 * h + 12 * m).toISOString(),
            mode: 'video',
            status: 'completed',
        },
        {
            sessionId: 'mock-active-1',
            startedAt: new Date(now - 30 * m).toISOString(),
            endedAt: undefined,
            mode: 'screen',
            status: 'active',
        },
    ];
}

/** @param {unknown} s */
function normalizeApiSession(s) {
    if (!s || typeof s !== 'object') return null;
    const o = /** @type {Record<string, unknown>} */ (s);
    const startedAt = o.startedAt;
    if (!startedAt) return null;
    const startIso =
        typeof startedAt === 'string' ? startedAt : new Date(/** @type {Date} */ (startedAt)).toISOString();
    let endedIso;
    if (o.endedAt != null) {
        endedIso =
            typeof o.endedAt === 'string' ? o.endedAt : new Date(/** @type {Date} */ (o.endedAt)).toISOString();
    }
    const modeRaw = o.interviewMode ?? o.mode;
    const mode =
        modeRaw === 'voice' || modeRaw === 'screen' || modeRaw === 'video' ? modeRaw : 'video';
    const statusRaw = typeof o.status === 'string' ? o.status : 'completed';
    const status =
        statusRaw === 'active' || statusRaw === 'completed' || statusRaw === 'cancelled'
            ? statusRaw
            : 'completed';
    const sessionId = typeof o.sessionId === 'string' ? o.sessionId : undefined;
    return { sessionId, startedAt: startIso, endedAt: endedIso, mode, status };
}

/**
 * @param {string} isoStart
 * @param {string} preset
 */
function inPresetRange(isoStart, preset) {
    const t0 = new Date(isoStart).getTime();
    if (Number.isNaN(t0)) return false;
    const now = Date.now();
    const age = now - t0;
    const day = 86400000;
    if (preset === '1d') return age >= 0 && age <= day;
    if (preset === '7d') return age >= 0 && age <= 7 * day;
    return age >= 0 && age <= 30 * day;
}

/**
 * @param {UsageRow[]} rows
 * @param {string} dateLocale
 * @param {(k: string) => string} t
 */
function rowsToCsv(rows, dateLocale, t) {
    const header = [
        t('account_usage_csv_sess'),
        t('account_usage_headerTime'),
        t('account_usage_headerType'),
        t('account_usage_headerDuration'),
        t('account_usage_headerStatus'),
    ].join(',');
    const lines = rows.map((r) => {
        const startMs = new Date(r.startedAt).getTime();
        let dur = '—';
        if (r.endedAt) {
            const ms = new Date(r.endedAt).getTime() - startMs;
            if (Number.isFinite(ms) && ms > 0) {
                const totalSec = Math.floor(ms / 1000);
                const mins = Math.floor(totalSec / 60);
                const secs = totalSec % 60;
                dur = fillI18nTemplate(t('account_usage_durationFmt'), {
                    mins: String(mins),
                    secs: String(secs),
                });
            }
        }
        const d = new Date(r.startedAt);
        const dateStr = Number.isNaN(d.getTime())
            ? '—'
            : new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
        const typeStr = t(`account_usage_mode_${r.mode}`);
        let statusKey =
            r.status === 'active'
                ? 'account_usage_status_active'
                : r.status === 'cancelled'
                  ? 'account_usage_status_cancelled'
                  : 'account_usage_status_completed';
        const statusStr = t(statusKey);
        return [r.sessionId ?? '—', dateStr, typeStr, dur, statusStr]
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
    const [rows, setRows] = useState(() => buildMockInterviewRows());

    const displayedRows = useMemo(
        () =>
            [...rows]
                .filter((r) => inPresetRange(r.startedAt, rangePreset))
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
        [rows, rangePreset]
    );

    const formatDurationRow = useMemo(() => {
        /** @param {UsageRow} row */
        return (row) => {
            if (!row.endedAt) return '—';
            const ms = new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime();
            if (!Number.isFinite(ms) || ms <= 0) return '—';
            const totalSec = Math.floor(ms / 1000);
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            return fillI18nTemplate(t('account_usage_durationFmt'), { mins: String(mins), secs: String(secs) });
        };
    }, [t]);

    /** @param {string} iso */
    const formatDateTime = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    };

    const interviewStatus = (/** @type {string|undefined} */ status) =>
        status === 'active'
            ? t('account_usage_status_active')
            : status === 'cancelled'
              ? t('account_usage_status_cancelled')
              : t('account_usage_status_completed');

    useEffect(() => {
        let cancelled = false;
        const url = `${API_BASE.replace(/\/$/, '')}/api/video-interview/sessions/recent?limit=100`;
        const headers = { Accept: 'application/json' };
        if (SESSIONS_API_KEY.trim()) {
            headers['X-API-Key'] = SESSIONS_API_KEY.trim();
        }
        fetch(url, { headers })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data) => {
                if (cancelled || !data?.success || !Array.isArray(data.sessions)) return;
                const mapped = data.sessions.map(normalizeApiSession).filter(Boolean);
                if (mapped.length > 0) {
                    setRows(/** @type {UsageRow[]} */ (mapped));
                }
            })
            .catch(() => {
                /* keep mock rows */
            });
        return () => {
            cancelled = true;
        };
    }, []);

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
        a.download = `interview-activity-${new Date().toISOString().slice(0, 10)}.csv`;
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

    const textAlignDur = mainDir === 'rtl' ? 'left' : 'right';
    const textAlignStat = textAlignDur;

    return (
        <AccountPageLayout pageClass="account-usage-page" injectStyle={usageInjectStyle}>
                <AccountSidebar activeId="usage" />

            <main dir={mainDir} style={{ flex: 1, minWidth: 0 }}>
                <AccountMobileNav activeId="usage" />
                <h1 className={ACCOUNT_PAGE_H1_CLASS} style={accountPageH1Style('0 0 24px')}>{t('account_usage_pageTitle')}</h1>

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
                    <button type="button" onClick={exportCsv} className="workflow-btn-primary account-btn-connect">
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
                            <span style={{ textAlign: textAlignDur }}>{t('account_usage_headerDuration')}</span>
                            <span style={{ textAlign: textAlignStat }}>{t('account_usage_headerStatus')}</span>
                        </div>
                        <div style={{ padding: '0 22px 8px' }}>
                            {displayedRows.length === 0 ? (
                                <div
                                    className={ACCOUNT_TEXT_MUTED_CLASS}
                                    style={{
                                        padding: '28px 22px',
                                        fontSize: 14,
                                        textAlign: 'center',
                                    }}
                                >
                                    {t('account_usage_empty')}
                                </div>
                            ) : (
                                displayedRows.map((row, i) => (
                                    <div
                                        key={row.sessionId || `${row.startedAt}-${row.mode}-${i}`}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: GRID_COLS,
                                        gap: 12,
                                        alignItems: 'center',
                                        padding: '14px 0',
                                    }}
                                    className="account-usage-table-row"
                                >
                                        <span className="account-table-cell-strong">{formatDateTime(row.startedAt)}</span>
                                        <span className="account-table-cell-muted">{t(`account_usage_mode_${row.mode}`)}</span>
                                        <span className="account-table-cell-strong" style={{ textAlign: textAlignDur }}>
                                            {formatDurationRow(row)}
                                    </span>
                                        <span className="account-table-cell-muted" style={{ textAlign: textAlignStat }}>
                                            {interviewStatus(row.status || 'completed')}
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
