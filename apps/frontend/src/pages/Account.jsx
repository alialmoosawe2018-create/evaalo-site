import React, { useMemo, useState, useCallback, useEffect } from 'react';
import '../design-styles.css';
import AccountSidebar from '../components/AccountSidebar';
import AccountMobileNav from '../components/AccountMobileNav';
import AdjustPlanModal from '../components/AdjustPlanModal';
import AccountIntegrationsSection from '../components/AccountIntegrationsSection';
import { ACCOUNT_GRADIENT_TEXT_CLASS, ACCOUNT_TEXT_MUTED_CLASS } from '../utils/accountTypography';
import { useLanguage } from '../contexts/LanguageContext';
import { useBilling } from '../contexts/BillingContext';
import { apiClient } from '../services/apiClient';
import {
    getPlanById,
    getPriceDisplay,
    listPlans,
} from '../utils/billingDisplay';
import { formatDateSafe, localeForBillingLang } from '../utils/billingPortalDisplay';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const SESSIONS_API_KEY = import.meta.env.VITE_VIDEO_INTERVIEW_SESSIONS_API_KEY || '';
const DAY_MS = 86400000;
/**
 * @param {{ startedAt: string, interviewMode: string }[]} sessions
 * @param {'all'|'video'|'voice'|'screen'} modeFilter
 * @param {number} weeks
 * @param {number} daysPerWeek
 */
function buildInterviewHeatData(sessions, modeFilter, weeks, daysPerWeek) {
    const total = weeks * daysPerWeek;
    const counts = Array.from({ length: total }, () => 0);

    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    anchor.setDate(anchor.getDate() - weeks * 7);

    const anchorMs = anchor.getTime();
    const dayMs = 86400000;
    const maxDays = weeks * 7;

    const filtered =
        modeFilter === 'all'
            ? sessions
            : sessions.filter((s) => (s.interviewMode || 'video') === modeFilter);

    for (const s of filtered) {
        const d = new Date(s.startedAt);
        if (Number.isNaN(d.getTime())) continue;
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayOffset = Math.floor((dayStart.getTime() - anchorMs) / dayMs);
        if (dayOffset < 0 || dayOffset >= maxDays) continue;
        const w = Math.floor(dayOffset / 7);
        const r = dayOffset % 7;
        const idx = w * daysPerWeek + r;
        if (idx >= 0 && idx < total) counts[idx] += 1;
    }

    return { counts };
}

/**
 * مجموع المقابلات لكل أسبوع (7 أيام) من مصفوفة `counts` بنفس ترتيب buildInterviewHeatData (أسبوع × يوم).
 * @param {number[]} counts
 * @param {number} weeks
 * @param {number} daysPerWeek
 */
function aggregateWeeklyTotals(counts, weeks, daysPerWeek) {
    const totals = [];
    for (let w = 0; w < weeks; w += 1) {
        let sum = 0;
        for (let r = 0; r < daysPerWeek; r += 1) {
            sum += counts[w * daysPerWeek + r] ?? 0;
        }
        totals.push(sum);
    }
    return totals;
}

/** أول يوم (منتصف الليل) من الأسبوع `weekIndex` ضمن نفس نافذة الـ heatmap */
function activityChartWeekRange(weekIndex, weeks) {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    anchor.setDate(anchor.getDate() - weeks * 7);
    const start = new Date(anchor);
    start.setDate(start.getDate() + weekIndex * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end };
}

/** @param {number} weeks @param {string} locale BCP-47 */
function monthLabelsForWeeks(weeks, locale) {
    const labels = [];
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - weeks * 7);
    const fmt = new Intl.DateTimeFormat(locale, { month: 'narrow' });
    for (let w = 0; w < weeks; w += 1) {
        const d = new Date(start);
        d.setDate(d.getDate() + w * 7);
        const show = d.getDate() <= 7;
        labels.push(show ? fmt.format(d) : '');
    }
    return labels;
}

/** @param {unknown} raw */
function normalizeOverviewSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const o = /** @type {Record<string, unknown>} */ (raw);
    const startedAt = o.startedAt;
    if (!startedAt) return null;
    const iso =
        typeof startedAt === 'string' ? startedAt : new Date(/** @type {Date} */ (startedAt)).toISOString();
    const m = o.interviewMode;
    const interviewMode =
        m === 'voice' || m === 'screen' || m === 'video' ? m : 'video';
    return { startedAt: iso, interviewMode };
}

/**
 * @param {{ startedAt: string }[]} sessions
 * @param {string} locale
 * @param {(n: number) => string} formatDayStreak
 */
function computeActivityStats(sessions, locale, formatDayStreak) {
    const countByDay = new Map();
    const countByMonth = new Map();

    for (const s of sessions) {
        const d = new Date(s.startedAt);
        if (Number.isNaN(d.getTime())) continue;
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const k = dayStart.getTime();
        countByDay.set(k, (countByDay.get(k) || 0) + 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        countByMonth.set(ym, (countByMonth.get(ym) || 0) + 1);
    }

    let mostActiveDayStr = '—';
    let maxDay = 0;
    for (const [k, c] of countByDay) {
        if (c > maxDay) {
            maxDay = c;
            mostActiveDayStr = new Date(k).toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
        }
    }

    let mostActiveMonthStr = '—';
    let maxMonth = 0;
    for (const [ym, c] of countByMonth) {
        if (c > maxMonth) {
            maxMonth = c;
            const parts = ym.split('-').map(Number);
            const y = parts[0];
            const mo = parts[1];
            const date = new Date(y, mo - 1, 1);
            mostActiveMonthStr = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        }
    }

    const sortedDayKeys = [...countByDay.keys()].sort((a, b) => a - b);
    let longest = 0;
    if (sortedDayKeys.length > 0) {
        let run = 1;
        longest = 1;
        for (let i = 1; i < sortedDayKeys.length; i += 1) {
            if (sortedDayKeys[i] === sortedDayKeys[i - 1] + DAY_MS) {
                run += 1;
                longest = Math.max(longest, run);
            } else {
                run = 1;
            }
        }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let current = 0;
    for (let i = 0; i < 400; i += 1) {
        const t = today.getTime() - i * DAY_MS;
        if ((countByDay.get(t) || 0) > 0) current += 1;
        else break;
    }

    const empty = sessions.length === 0;

    return {
        mostActiveMonth: { value: empty ? '—' : mostActiveMonthStr },
        mostActiveDay: { value: empty ? '—' : mostActiveDayStr },
        longestStreak: { value: empty ? '—' : formatDayStreak(longest) },
        currentStreak: { value: empty ? '—' : formatDayStreak(current) },
    };
}

const cardPadding = { padding: '22px 24px', marginBottom: 16 };

const Account = () => {
    const { t, currentLang } = useLanguage();
    const {
        currentPlanId,
        billingCycle,
        isLoaded: billingLoaded,
        periodEnd,
        cancelAtPeriodEnd,
        configured,
        error: billingError,
    } = useBilling();
    const [portalSummary, setPortalSummary] = useState(null);
    const [portalSummaryLoading, setPortalSummaryLoading] = useState(true);
    const [activityFilter, setActivityFilter] = useState('all');

    const billingLocale = localeForBillingLang(currentLang);

    useEffect(() => {
        let cancelled = false;
        setPortalSummaryLoading(true);
        apiClient
            .get('/api/billing/portal/summary')
            .then((res) => {
                if (!cancelled) setPortalSummary(res?.ok ? res : null);
            })
            .catch(() => {
                if (!cancelled) setPortalSummary(null);
            })
            .finally(() => {
                if (!cancelled) setPortalSummaryLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const activeBillingCycle =
        portalSummary?.billingCycle === 'annual' || billingCycle === 'annual' ? 'annual' : 'monthly';

    const currentPlanPriceLabel = useMemo(() => {
        if (!billingLoaded) return '…';
        const info = getPriceDisplay(currentPlanId, activeBillingCycle);
        if (info.kind === 'custom') return t('billing_price_custom');
        return `$${info.amount}${t('billing_price_per_month')}`;
    }, [billingLoaded, currentPlanId, activeBillingCycle, t]);

    const nextInvoiceDateLine = useMemo(() => {
        const endIso = portalSummary?.currentPeriodEnd || periodEnd;
        const endLabel = formatDateSafe(endIso, billingLocale);
        if (!endLabel) return null;
        if (portalSummary?.cancelAtPeriodEnd || cancelAtPeriodEnd) {
            return fillI18nTemplate(t('billing_status_active_until'), { date: endLabel });
        }
        if (portalSummary?.configured || configured) {
            return fillI18nTemplate(t('account_nextInvoiceOnDate'), { date: endLabel });
        }
        return null;
    }, [portalSummary, periodEnd, cancelAtPeriodEnd, configured, billingLocale, t]);

    const currentPlan = getPlanById(currentPlanId);
    const allPlans = listPlans();
    const planRowTop = allPlans.slice(0, 2);
    const planRowBottom = allPlans.slice(2, 4);
    const [adjustPlanOpen, setAdjustPlanOpen] = useState(false);
    const [planModalScrollTo, setPlanModalScrollTo] = useState(null);

    const closePlanModal = useCallback(() => {
        setAdjustPlanOpen(false);
        setPlanModalScrollTo(null);
    }, []);

    const openPlanModal = useCallback((opts = {}) => {
        const { scrollTo = null } = opts;
        setPlanModalScrollTo(scrollTo);
        setAdjustPlanOpen(true);
    }, []);

    const renderOverviewPlanCard = (plan) => {
        const isCurrent = plan.id === currentPlanId;
        const info = getPriceDisplay(plan.id, 'monthly');
        const priceLabel =
            info.kind === 'custom'
                ? t('billing_price_custom')
                : `$${info.amount}${t('billing_price_per_month')}`;
        return (
            <div
                key={plan.id}
                className={`dashboard-card account-plan-card ${isCurrent ? 'account-plan-card--current' : 'account-upgrade-plan-card'}`}
                style={{ ...cardPadding, display: 'flex', flexDirection: 'column', minHeight: isCurrent ? 200 : 180 }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3
                        dir="ltr"
                        className={ACCOUNT_GRADIENT_TEXT_CLASS}
                        style={{ margin: 0, fontSize: 17, fontWeight: isCurrent ? 700 : 600 }}
                    >
                        {t(plan.displayNameKey)}
                    </h3>
                    {isCurrent ? <span className="account-plan-badge">{t('account_planCurrent')}</span> : null}
                    <span dir="ltr" className={ACCOUNT_TEXT_MUTED_CLASS} style={{ fontWeight: 500, fontSize: 15 }}>
                        {priceLabel}
                    </span>
                </div>
                <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.55, flex: 1 }}>
                    {t(plan.displayDescKey)}
                </p>
                <button
                    type="button"
                    className="workflow-btn-primary account-cta-learnmore"
                    onClick={() => openPlanModal({ billing: 'monthly', scrollTo: isCurrent ? null : plan.id })}
                >
                    {isCurrent
                        ? t('account_planAdjust')
                        : plan.price === 'custom'
                          ? t('adjust_plan_btnTeams')
                          : t('adjust_plan_btnChoose')}
                </button>
            </div>
        );
    };

    const mainDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const weeks = 48;
    const daysPerWeek = 7;
    const dateLocale = currentLang === 'ar' ? 'ar' : currentLang === 'ku' ? 'ku' : 'en-US';
    const topMonths = useMemo(() => monthLabelsForWeeks(weeks, dateLocale), [weeks, dateLocale]);
    const barW = 10;
    const barGap = 5;
    const chartInnerMinWidth = weeks * barW + (weeks - 1) * barGap;

    const activityFilterPills = useMemo(
        () => [
            { id: 'all', label: t('account_filterAll') },
            { id: 'video', label: t('account_filterVideo') },
            { id: 'voice', label: t('account_filterVoice') },
            { id: 'screen', label: t('account_filterScreen') },
        ],
        [t]
    );

    const [activitySessions, setActivitySessions] = useState([]);

    useEffect(() => {
        let cancelled = false;
        const headers = { Accept: 'application/json' };
        if (SESSIONS_API_KEY.trim()) {
            headers['X-API-Key'] = SESSIONS_API_KEY.trim();
        }
        const url = `${API_BASE.replace(/\/$/, '')}/api/video-interview/sessions/recent?limit=500`;
        fetch(url, { headers })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data) => {
                if (cancelled || !data?.success || !Array.isArray(data.sessions)) return;
                const mapped = data.sessions.map(normalizeOverviewSession).filter(Boolean);
                setActivitySessions(mapped);
            })
            .catch(() => {
                /* keep empty — heatmap stays flat until data exists */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const filteredActivitySessions = useMemo(() => {
        if (activityFilter === 'all') return activitySessions;
        return activitySessions.filter((s) => (s.interviewMode || 'video') === activityFilter);
    }, [activitySessions, activityFilter]);

    const heatData = useMemo(
        () => buildInterviewHeatData(activitySessions, activityFilter, weeks, daysPerWeek),
        [activitySessions, activityFilter, weeks, daysPerWeek]
    );
    const heatCounts = heatData.counts;

    const weeklyTotals = useMemo(
        () => aggregateWeeklyTotals(heatCounts, weeks, daysPerWeek),
        [heatCounts, weeks, daysPerWeek]
    );
    const maxWeekly = useMemo(() => Math.max(1, ...weeklyTotals), [weeklyTotals]);

    const totalInterviews = filteredActivitySessions.length;

    const activityStats = useMemo(() => {
        const streakLabel = (n) => fillI18nTemplate(t('account_statStreakDays'), { days: String(n) });
        const s = computeActivityStats(filteredActivitySessions, dateLocale, streakLabel);
        return [
            { label: t('account_statMostActiveMonth'), value: s.mostActiveMonth.value },
            { label: t('account_statMostActiveDay'), value: s.mostActiveDay.value },
            { label: t('account_statLongestStreak'), value: s.longestStreak.value },
            { label: t('account_statCurrentStreak'), value: s.currentStreak.value },
        ];
    }, [filteredActivitySessions, t, dateLocale]);

    return (
        <>
            <div className="dashboard-page dashboard-page--evaalo-visual account-dashboard-page account-overview-page">
                <div className="design-background">
                    <div className="design-orb-1" />
                    <div className="design-orb-2" />
                    <div className="design-orb-3" />
                </div>

                <div
                    className="account-dashboard-inner"
                    style={{
                        maxWidth: 1400,
                    margin: '0 auto', 
                    position: 'relative', 
                    zIndex: 1,
                        display: 'flex',
                        gap: 28,
                        alignItems: 'flex-start',
                    }}
                >
                    <AccountSidebar activeId="overview" />

                    {/* Main */}
                    <main dir={mainDir} style={{ flex: 1, minWidth: 0 }}>
                        <AccountMobileNav activeId="overview" />
                        {/* Current plan summary — name, renewal, price */}
                        <div className="dashboard-card account-credits-card" style={{ ...cardPadding }}>
                            {billingError ? (
                                <p className="account-system-alert" role="alert" style={{ margin: '0 0 12px' }}>
                                    {t('account_billing_load_error')}
                                </p>
                            ) : null}
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    gap: 16,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div>
                                    <h2 className={ACCOUNT_GRADIENT_TEXT_CLASS} style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                                        {currentPlan ? t(currentPlan.displayNameKey) : t('account_creditsTitle')}
                                    </h2>
                                    {nextInvoiceDateLine ? (
                                        <p className={ACCOUNT_TEXT_MUTED_CLASS} style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.45 }}>
                                            {nextInvoiceDateLine}
                                        </p>
                                    ) : null}
                                </div>
                                <div dir="ltr" className="account-credits-amount" style={{ textAlign: 'right' }}>
                                    <span
                                        className="account-credits-amount-value"
                                        style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}
                                    >
                                        {currentPlanPriceLabel}
                                    </span>
                                </div>
                        </div>
                    </div>

                        {/* Plans 2×2 — starter/team then professional/business */}
                        {planRowTop.length > 0 ? (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 16,
                                marginBottom: 16,
                            }}
                            className="account-upgrade-row"
                        >
                                {planRowTop.map(renderOverviewPlanCard)}
                            </div>
                        ) : null}
                        {planRowBottom.length > 0 ? (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 16,
                                marginBottom: 16,
                            }}
                            className="account-plan-row"
                        >
                                {planRowBottom.map(renderOverviewPlanCard)}
                            </div>
                        ) : null}

                        <AccountIntegrationsSection />

                        {/* Activity — interview volume from sessions */}
                        <div className="dashboard-card" style={{ ...cardPadding, marginBottom: 16 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    flexWrap: 'wrap',
                                    gap: 16,
                                    marginBottom: 20,
                                }}
                            >
                                <div>
                                    <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ fontSize: 13, fontWeight: 500 }}>{t('account_activityTitle')}</div>
                                    <div className="account-stat-highlight">
                                        {totalInterviews.toLocaleString()}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {activityFilterPills.map((pill) => {
                                        const active = activityFilter === pill.id;
                                        return (
                                            <button
                                                key={pill.id}
                                                type="button"
                                                onClick={() => setActivityFilter(pill.id)}
                                                className={`workflow-btn-primary account-activity-filter${
                                                    active ? ' account-activity-filter--active' : ''
                                                }`}
                                            >
                                                {pill.label}
                                            </button>
                                        );
                                    })}
                                </div>
                    </div>

                            <div className="account-activity-week-chart-scroll">
                                <div
                                    className="account-activity-week-chart-inner"
                                    style={{ minWidth: chartInnerMinWidth }}
                                >
                                    <div className="account-activity-week-chart-axis">
                                        {topMonths.map((m, i) => (
                                            <div key={i} className="account-activity-week-chart-axis-slot">
                                                {m || '\u00a0'}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="account-activity-week-chart-bars">
                                        {weeklyTotals.map((total, w) => {
                                            const pctFill =
                                                total <= 0
                                                    ? 0
                                                    : Math.max(12, Math.round((total / maxWeekly) * 100));
                                            const { start, end } = activityChartWeekRange(w, weeks);
                                            const startStr = start.toLocaleDateString(dateLocale, {
                                                month: 'short',
                                                day: 'numeric',
                                            });
                                            const endStr = end.toLocaleDateString(dateLocale, {
                                                month: 'short',
                                                day: 'numeric',
                                                year:
                                                    start.getFullYear() !== end.getFullYear()
                                                        ? 'numeric'
                                                        : undefined,
                                            });
                                            const title =
                                                total > 0
                                                    ? fillI18nTemplate(t('account_heatTooltipWeek'), {
                                                          start: startStr,
                                                          end: endStr,
                                                          count: String(total),
                                                      })
                                                    : fillI18nTemplate(t('account_heatTooltipWeekEmpty'), {
                                                          start: startStr,
                                                          end: endStr,
                                                      });
                                            return (
                                                <div key={w} className="account-activity-week-bar-track" title={title}>
                                                    <div
                                                        className="account-activity-week-bar-fill"
                                            style={{
                                                            height: `${pctFill}%`,
                                                            opacity: total > 0 ? 1 : 0,
                                                        }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="account-activity-week-legend">
                                <span>{t('account_heatLegendFewer')}</span>
                                <div className="account-activity-week-legend-gradient" aria-hidden />
                                <span>{t('account_heatLegendMore')}</span>
                                </div>
                            <p className="account-activity-week-hint">{t('account_activityWeeklyChartHint')}</p>
                            <div
                                style={{
                                    display: 'grid', 
                                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                                    gap: 16,
                                    marginTop: 22,
                                    paddingTop: 20,
                                }}
                                className="account-activity-stats account-card-divider"
                            >
                                {activityStats.map((row) => (
                                    <div key={row.label}>
                                        <div className={ACCOUNT_TEXT_MUTED_CLASS} style={{ fontSize: 12, marginBottom: 6 }}>{row.label}</div>
                                        <div className="account-stat-value">{row.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </main>
                </div>

                <style>{`
                    @media (max-width: 960px) {
                        .account-dashboard-inner {
                            flex-direction: column !important;
                        }
                        .account-dashboard-page aside {
                            position: relative !important;
                            top: 0 !important;
                            width: 100% !important;
                        }
                        .account-upgrade-row,
                        .account-plan-row {
                            grid-template-columns: 1fr !important;
                        }
                        .account-activity-stats {
                            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        }
                    }
                    @media (max-width: 520px) {
                        .account-activity-stats {
                            grid-template-columns: 1fr !important;
                        }
                    }
                `}</style>
            </div>

            <AdjustPlanModal
                isOpen={adjustPlanOpen}
                onClose={closePlanModal}
                scrollToPlanId={planModalScrollTo ?? undefined}
            />
        </>
    );
};

export default Account;
