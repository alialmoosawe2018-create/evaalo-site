import React, { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { getScriptFontClass } from '../../utils/textScript.js';
import { candidatePhotoUrl } from '../../utils/candidateAssets.jsx';

/**
 * لوحة عرض نتيجة "مقارنة أفضل المرشحين" داخل صفحة المرحلة 1.
 * مستقلة عن باقي اللوحات؛ تعرض الحالات: pending / completed / failed / timeout.
 *
 * Phase 1 (مساعد القرار): بدل جدول مسطّح، تعرض:
 *  - خاتمة تنفيذية حاسمة (decisionSummary) أعلى اللوحة.
 *  - بطاقة قرار لكل مرشح: توصية + تعليق تنفيذي + ثقة + أسباب + قوة + مخاطر + الفرق عن التالي.
 * كل الحقول الجديدة اختيارية؛ النتائج القديمة (نص/جدول) تُعرض دون كسر.
 *
 * @param {{
 *   status: 'pending' | 'completed' | 'failed' | 'timeout',
 *   result: object | null,
 *   onDismiss?: () => void,
 * }} props
 */

/** يحوّل قيمة (مصفوفة أو نص مفصول بأسطر/فواصل) إلى مصفوفة نصوص نظيفة. */
function toList(value) {
    if (Array.isArray(value)) {
        return value.map((x) => String(x ?? '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/\r?\n|•|;|،|,/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

/** نبرة شارة التوصية مشتقّة من enum ثابت لغوياً (recommendation)، لا من النص الحرّ. */
function recommendationTone(recommendation) {
    if (recommendation === 'Hire') return 'positive';
    if (recommendation === 'Reject') return 'negative';
    if (recommendation === 'Consider') return 'neutral';
    return 'default';
}

/**
 * A pill holds a word, not a sentence.
 *
 * The badge used to render `overallRecommendation`, which the model writes as a
 * full sentence, so it grew to half the card and pushed the metrics out of line.
 * The enum is the one part that belongs in a pill, and the app already localizes
 * it under these keys elsewhere.
 */
function recommendationBadgeLabel(recommendation, t) {
    if (recommendation === 'Hire') return t('stageEval_recAccepted');
    if (recommendation === 'Consider') return t('stageEval_recConsider');
    if (recommendation === 'Reject') return t('stageEval_recReject');
    return (recommendation || '').trim();
}

/**
 * The sentence usually opens with the same enum word the badge now shows. Drop
 * that opening — and only an exact match of it — so the two don't read as a
 * stutter; anything else the model wrote is left verbatim.
 */
function recommendationSentence(overallRecommendation, recommendation) {
    const text = (overallRecommendation || '').trim();
    const token = (recommendation || '').trim();
    if (!text || !token) return text;
    if (!text.toLowerCase().startsWith(token.toLowerCase())) return text;
    return text.slice(token.length).replace(/^[\s:—–-]+/, '').trim();
}

function confidencePct(row) {
    if (row?.confidence == null || !Number.isFinite(Number(row.confidence))) return null;
    return Math.max(0, Math.min(100, Math.round(Number(row.confidence))));
}

function clipText(value, max = 140) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}…`;
}

function decisionActionTone(action) {
    const a = String(action || '');
    if (/Do Not/i.test(a)) return 'negative';
    if (/Proceed|Prioritize/i.test(a) && !/condition/i.test(a)) return 'positive';
    return 'neutral';
}

function panelTitleKey(uiStage) {
    if (uiStage === 'voice') return 'aiCompareTop_panelTitleStage2';
    if (uiStage === 'video') return 'aiCompareTop_panelTitleStage3';
    return 'aiCompareTop_panelTitleStage1';
}

function DecisionOptionsList({ options, t }) {
    const rows = Array.isArray(options) ? options.filter((o) => o && String(o.action || '').trim()) : [];
    if (!rows.length) return null;
    return (
        <section className="compare-section compare-section--options">
            <div className="compare-section__label">{t('aiCompareTop_decisionOptions')}</div>
            <ul className="compare-decision-options">
                {rows.map((opt, i) => (
                    <li key={`${opt.action}-${i}`} className="compare-decision-options__item">
                        <div className="compare-decision-options__action">{opt.action}</div>
                        {opt.when ? (
                            <div className="compare-decision-options__meta">
                                <span>{t('aiCompareTop_decisionWhen')}</span> {opt.when}
                            </div>
                        ) : null}
                        {opt.benefit ? (
                            <div className="compare-decision-options__meta">
                                <span>{t('aiCompareTop_decisionBenefit')}</span> {opt.benefit}
                            </div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function ScreeningAiComparePanel({
    status,
    result,
    onDismiss,
    candidates = [],
    campaignTitle = '',
    uiStage = 'screening',
}) {
    const { t } = useLanguage();

    // Match each ranking row to its campaign candidate to pull the profile photo.
    // Identity first: two people in one campaign can share a name, and matching
    // on the name alone would hang one candidate's face on the other's result.
    // Email and name remain as fallbacks for rows that come back without ids.
    const candidateByKey = useMemo(() => {
        const map = new Map();
        for (const c of Array.isArray(candidates) ? candidates : []) {
            const applicationId = String(c?.applicationId || '').trim();
            if (applicationId) map.set(`app:${applicationId}`, c);
            const personId = String(c?.candidateId || c?._id || '').trim();
            if (personId && !map.has(`id:${personId}`)) map.set(`id:${personId}`, c);
            const email = String(c?.email || '').trim().toLowerCase();
            if (email && !map.has(email)) map.set(email, c);
            const name = String(c?.full_name || c?.fullName || c?.name || '').trim().toLowerCase();
            if (name && !map.has(name)) map.set(name, c);
        }
        return map;
    }, [candidates]);

    const ranking = Array.isArray(result?.ranking) ? result.ranking : [];
    const summary = (result?.summary || '').trim();
    const decisionSummary = (result?.decisionSummary || '').trim();
    const emails = Array.isArray(result?.emails) ? result.emails : [];

    // ── Phase 1.5: حقول السرد التحليلي (كلها اختيارية) ──
    const contextualIntroduction = (result?.contextualIntroduction || '').trim();
    const whyTopCandidateWins = (result?.whyTopCandidateWins || '').trim();
    const finalRecommendation = (result?.finalRecommendation || '').trim();
    // comparativeInsights كائن { بُعد: ترتيب } → مصفوفة أزواج نظيفة
    const comparativeInsights =
        result?.comparativeInsights && typeof result.comparativeInsights === 'object'
            ? Object.entries(result.comparativeInsights)
                  .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])
                  .filter(([k, v]) => k && v)
            : [];

    const isLoading = status === 'pending';
    const isFailed = status === 'failed';
    const isTimeout = status === 'timeout';
    const leadRow = ranking.find((r) => (r.rank ?? 0) === 1) ?? ranking[0];
    const snapshotNext = clipText(
        leadRow?.decisionAction || finalRecommendation || whyTopCandidateWins || decisionSummary
    );
    const reportDecisionOptions = result?.decisionOptions;
    const showSnapshot = ranking.length > 0 && !isLoading && !isFailed && !isTimeout;

    return (
        <div className="screening-ai-compare-panel">
            <div className="screening-ai-compare-panel__header">
                <div className="screening-ai-compare-panel__title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 2l2.09 5.26L20 8.27l-4 3.64L17.18 18 12 15.27 6.82 18 8 11.91 4 8.27l5.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                    <span>{t(panelTitleKey(uiStage))}</span>
                </div>
                {onDismiss ? (
                    <button
                        type="button"
                        className="screening-ai-compare-panel__close"
                        onClick={onDismiss}
                    >
                        {t('aiCompareTop_close')}
                    </button>
                ) : null}
            </div>

            <div className="screening-ai-compare-panel__body">
                {emails.length > 0 ? (
                    <div className="screening-ai-compare-panel__recipients">
                        <span className="screening-ai-compare-panel__recipients-label">
                            {t('aiCompareTop_recipients')}:
                        </span>
                        {emails.map((e) => (
                            <span key={e} className="screening-ai-compare-panel__chip">{e}</span>
                        ))}
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="screening-ai-compare-panel__status-box">
                        <div className="screening-ai-compare-panel__state">
                            <span className="screening-ai-compare-spinner" aria-hidden="true" />
                            <span>{t('aiCompareTop_pending')}</span>
                        </div>
                    </div>
                ) : isFailed ? (
                    <div className="screening-ai-compare-panel__status-box screening-ai-compare-panel__status-box--error">
                        <div className="screening-ai-compare-panel__state screening-ai-compare-panel__state--error">
                            {result?.error?.trim() || t('aiCompareTop_failed')}
                        </div>
                    </div>
                ) : isTimeout ? (
                    <div className="screening-ai-compare-panel__status-box screening-ai-compare-panel__status-box--warn">
                        <div className="screening-ai-compare-panel__state screening-ai-compare-panel__state--warn">
                            {t('aiCompareTop_timeout')}
                        </div>
                    </div>
                ) : (
                <>
                    {showSnapshot ? (
                        <section className="compare-snapshot">
                            <div className="compare-section__label">{t('aiCompareTop_snapshotTitle')}</div>
                            <div className="compare-snapshot__grid">
                                {campaignTitle ? (
                                    <div className="compare-snapshot__stat">
                                        <span className="compare-snapshot__k">{t('aiCompareTop_snapshotRole')}</span>
                                        <span className={`compare-snapshot__v ${getScriptFontClass(campaignTitle)}`}>
                                            {campaignTitle}
                                        </span>
                                    </div>
                                ) : null}
                                <div className="compare-snapshot__stat">
                                    <span className="compare-snapshot__k">{t('aiCompareTop_snapshotCount')}</span>
                                    <span className="compare-snapshot__v">{ranking.length}</span>
                                </div>
                                {leadRow ? (
                                    <div className="compare-snapshot__stat">
                                        <span className="compare-snapshot__k">{t('aiCompareTop_snapshotLead')}</span>
                                        <span className={`compare-snapshot__v ${getScriptFontClass(leadRow.candidateName)}`}>
                                            {leadRow.candidateName || '—'}
                                        </span>
                                    </div>
                                ) : null}
                                {snapshotNext ? (
                                    <div className="compare-snapshot__stat compare-snapshot__stat--wide">
                                        <span className="compare-snapshot__k">{t('aiCompareTop_snapshotNext')}</span>
                                        <span className={`compare-snapshot__v compare-snapshot__v--text ${getScriptFontClass(snapshotNext)}`}>
                                            {snapshotNext}
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                            <div className="compare-snapshot-table-wrap">
                                <table className="screening-ai-compare-table compare-snapshot-table">
                                    <thead>
                                        <tr>
                                            <th>{t('aiCompareTop_colRank')}</th>
                                            <th>{t('aiCompareTop_colCandidate')}</th>
                                            <th>{t('aiCompareTop_colScore')}</th>
                                            <th>{t('aiCompareTop_confidence')}</th>
                                            <th>{t('aiCompareTop_colDecision')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ranking.map((row, i) => {
                                            const rank = row.rank ?? i + 1;
                                            const conf = confidencePct(row);
                                            const actionLabel = (row.decisionAction || '').trim();
                                            const matchedCandidate =
                                                candidateByKey.get(`app:${String(row.applicationId || '').trim()}`) ||
                                                candidateByKey.get(`id:${String(row.candidateId || '').trim()}`) ||
                                                candidateByKey.get(String(row.candidateEmail || '').trim().toLowerCase()) ||
                                                candidateByKey.get(String(row.candidateName || '').trim().toLowerCase()) ||
                                                null;
                                            const photoUrl = matchedCandidate
                                                ? candidatePhotoUrl(matchedCandidate)
                                                : null;
                                            const avatarInitial =
                                                String(row.candidateName || row.candidateEmail || '?')
                                                    .trim()
                                                    .charAt(0)
                                                    .toUpperCase() || '?';
                                            return (
                                                <tr
                                                    key={`snap-${row.candidateEmail || row.candidateName || i}`}
                                                    className={rank === 1 ? 'compare-snapshot-table__row--lead' : undefined}
                                                >
                                                    <td className="screening-ai-compare-table__rank">{rank}</td>
                                                    <td>
                                                        <div className="compare-snapshot-table__person">
                                                            {photoUrl ? (
                                                                <img src={photoUrl} alt="" className="compare-snapshot-table__photo" />
                                                            ) : (
                                                                <span className="compare-snapshot-table__photo compare-snapshot-table__photo--fallback">
                                                                    {avatarInitial}
                                                                </span>
                                                            )}
                                                            <div>
                                                                <div className={`screening-ai-compare-table__name ${getScriptFontClass(row.candidateName)}`}>
                                                                    {row.candidateName || '—'}
                                                                </div>
                                                                {row.candidateEmail ? (
                                                                    <div className="screening-ai-compare-table__email">
                                                                        {row.candidateEmail}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="screening-ai-compare-table__score">
                                                        {row.score != null ? row.score : '—'}
                                                    </td>
                                                    <td>{conf != null ? `${conf}%` : '—'}</td>
                                                    <td>
                                                        {actionLabel ? (
                                                            <span
                                                                className={`screening-ai-compare-badge screening-ai-compare-badge--rec screening-ai-compare-badge--rec-${decisionActionTone(
                                                                    actionLabel
                                                                )}`}
                                                            >
                                                                {actionLabel}
                                                            </span>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ) : null}

                    {/* ① السياق والخلفية — يُمهّد للقرار */}
                    {contextualIntroduction ? (
                        <section className="compare-section compare-section--context">
                            <div className="compare-section__label">
                                {t('aiCompareTop_contextualIntroduction')}
                            </div>
                            <p className="compare-section__text">{contextualIntroduction}</p>
                        </section>
                    ) : null}

                    {/* ② الخلاصة التنفيذية الحاسمة — أبرز جزء بصرياً */}
                    {decisionSummary ? (
                        <section className="compare-section compare-section--decision">
                            <div className="compare-section__label">
                                {t('aiCompareTop_decisionSummary')}
                            </div>
                            <p className="compare-section__text">{decisionSummary}</p>
                        </section>
                    ) : null}

                    <DecisionOptionsList options={reportDecisionOptions} t={t} />

                    {/* ③ ملخص المقارنة النصّي (توافق رجعي مع النتائج القديمة) */}
                    {summary ? (
                        <section className="compare-section compare-section--summary">
                            <div className="compare-section__label">
                                {t('aiCompareTop_summary')}
                            </div>
                            <p className="compare-section__text">{summary}</p>
                        </section>
                    ) : null}

                    {/* ④ التحليل المقارن الهيكلي عبر الأبعاد */}
                    {comparativeInsights.length > 0 ? (
                        <section className="compare-section compare-section--comparative">
                            <div className="compare-section__label">
                                {t('aiCompareTop_comparativeInsights')}
                            </div>
                            <div className="compare-insights">
                                {comparativeInsights.map(([dim, value]) => (
                                    <div className="compare-insights__row" key={dim}>
                                        <span className="compare-insights__dim">{dim}</span>
                                        <span className="compare-insights__val">{value}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}

                    {/* ⑤ بطاقات المرشحين */}
                    {ranking.length > 0 ? (
                        <>
                        <div className="compare-section__label compare-section__label--profiles">
                            {t('aiCompareTop_profilesTitle')}
                        </div>
                        <div className="screening-ai-compare-cards">
                            {ranking.map((row, i) => {
                                const reasons = toList(row.reasons);
                                const strengths = toList(row.strengthsList ?? row.strengths);
                                const risks = toList(row.risks ?? row.weaknesses);
                                const rank = row.rank ?? i + 1;
                                const isLast = i === ranking.length - 1;
                                const badgeLabel = recommendationBadgeLabel(row.recommendation, t);
                                const recLine = recommendationSentence(
                                    row.overallRecommendation,
                                    row.recommendation
                                );
                                const executiveComment = (row.executiveComment || '').trim();
                                const hasConfidence =
                                    row.confidence != null && Number.isFinite(Number(row.confidence));
                                const confidencePct = hasConfidence
                                    ? Math.max(0, Math.min(100, Math.round(Number(row.confidence))))
                                    : null;
                                const confidenceRationale = (row.confidence_rationale || '').trim();
                                // نصّ حرّ قديم كبديل عند غياب الحقول الغنية
                                const fallbackReason = (row.reason || '').trim();
                                const matchedCandidate =
                                    candidateByKey.get(String(row.candidateEmail || '').trim().toLowerCase()) ||
                                    candidateByKey.get(String(row.candidateName || '').trim().toLowerCase()) ||
                                    null;
                                const photoUrl = matchedCandidate ? candidatePhotoUrl(matchedCandidate) : null;
                                const avatarInitial =
                                    String(row.candidateName || row.candidateEmail || '?').trim().charAt(0).toUpperCase() || '?';

                                return (
                                    <article
                                        className={`screening-ai-compare-card${rank === 1 ? ' screening-ai-compare-card--top' : ''}`}
                                        key={`${row.candidateEmail || row.candidateName || 'row'}-${i}`}
                                    >
                                        <header className="screening-ai-compare-card__head">
                                            <div className="screening-ai-compare-card__avatar">
                                                {photoUrl ? (
                                                    <img
                                                        className="screening-ai-compare-card__avatar-img"
                                                        src={photoUrl}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <span
                                                        className="screening-ai-compare-card__avatar-fallback"
                                                        aria-hidden="true"
                                                    >
                                                        {avatarInitial}
                                                    </span>
                                                )}
                                                <span className="screening-ai-compare-card__rank-chip">{rank}</span>
                                            </div>
                                            <div className="screening-ai-compare-card__identity">
                                                <div
                                                    className={`screening-ai-compare-card__name ${getScriptFontClass(row.candidateName)}`}
                                                >
                                                    {row.candidateName || '—'}
                                                </div>
                                                {rank === 1 ? (
                                                    <div className="screening-ai-compare-card__stage-top">
                                                        {t('aiCompareTop_topAtStage')}
                                                    </div>
                                                ) : null}
                                                {row.candidateEmail ? (
                                                    <div className="screening-ai-compare-card__email">
                                                        {row.candidateEmail}
                                                    </div>
                                                ) : null}
                                                {/* Score + confidence sit directly under the name, so they read
                                                    beside the candidate — not detached to the far side in RTL. */}
                                                {row.score != null || confidencePct != null ? (
                                                    <div className="screening-ai-compare-card__metrics-inline">
                                                        {row.score != null ? (
                                                            <span className="screening-ai-compare-card__metric-chip">
                                                                <span className="screening-ai-compare-card__metric-chip-value">
                                                                    {row.score}
                                                                </span>
                                                                <span className="screening-ai-compare-card__metric-chip-label">
                                                                    {t('aiCompareTop_colScore')}
                                                                </span>
                                                            </span>
                                                        ) : null}
                                                        {confidencePct != null ? (
                                                            <span className="screening-ai-compare-card__metric-chip screening-ai-compare-card__metric-chip--conf">
                                                                <span className="screening-ai-compare-card__metric-chip-value">
                                                                    {confidencePct}%
                                                                </span>
                                                                <span className="screening-ai-compare-card__metric-chip-label">
                                                                    {t('aiCompareTop_confidence')}
                                                                </span>
                                                                <span
                                                                    className="screening-ai-compare-card__conf-bar"
                                                                    aria-hidden="true"
                                                                >
                                                                    <span style={{ width: `${confidencePct}%` }} />
                                                                </span>
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {(row.decisionAction || '').trim() ? (
                                                    <span
                                                        className={`screening-ai-compare-badge screening-ai-compare-badge--rec screening-ai-compare-badge--rec-${decisionActionTone(
                                                            row.decisionAction
                                                        )}`}
                                                    >
                                                        {row.decisionAction}
                                                    </span>
                                                ) : null}
                                                {badgeLabel ? (
                                                    <span
                                                        className={`screening-ai-compare-badge screening-ai-compare-badge--rec screening-ai-compare-badge--rec-${recommendationTone(
                                                            row.recommendation
                                                        )}`}
                                                    >
                                                        {badgeLabel}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {recLine ? (
                                                <p className={`screening-ai-compare-card__rec-line ${getScriptFontClass(recLine)}`}>
                                                    {recLine}
                                                </p>
                                            ) : null}
                                            {confidencePct != null && confidenceRationale ? (
                                                <p className={`screening-ai-compare-card__conf-rationale ${getScriptFontClass(confidenceRationale)}`}>
                                                    {confidenceRationale}
                                                </p>
                                            ) : null}
                                        </header>

                                        {executiveComment ? (
                                            <p className="screening-ai-compare-card__comment">
                                                {executiveComment}
                                            </p>
                                        ) : null}

                                        {(row.keyDecisionFactor || '').trim() ? (
                                            <p className="screening-ai-compare-card__factor">
                                                <strong>{t('aiCompareTop_keyDecisionFactor')}: </strong>
                                                {row.keyDecisionFactor}
                                            </p>
                                        ) : null}

                                        {Array.isArray(row.keyGaps) && row.keyGaps.length > 0 ? (
                                            <section className="screening-ai-compare-card__section">
                                                <h5>{t('aiCompareTop_keyGaps')}</h5>
                                                <ul className="screening-ai-compare-card__list">
                                                    {row.keyGaps.map((g, gi) => (
                                                        <li key={gi}>{g}</li>
                                                    ))}
                                                </ul>
                                            </section>
                                        ) : null}

                                        <DecisionOptionsList options={row.decisionOptions} t={t} />

                                        {reasons.length > 0 ? (
                                            <section className="screening-ai-compare-card__section">
                                                <h5>{t('aiCompareTop_why')}</h5>
                                                <ul className="screening-ai-compare-card__list screening-ai-compare-card__list--check">
                                                    {reasons.map((r, ri) => (
                                                        <li key={ri}>{r}</li>
                                                    ))}
                                                </ul>
                                            </section>
                                        ) : null}

                                        {strengths.length > 0 ? (
                                            <section className="screening-ai-compare-card__section">
                                                <h5>{t('aiCompareTop_strengthsLabel')}</h5>
                                                <ul className="screening-ai-compare-card__list screening-ai-compare-card__list--check">
                                                    {strengths.map((s, si) => (
                                                        <li key={si}>{s}</li>
                                                    ))}
                                                </ul>
                                            </section>
                                        ) : null}

                                        {risks.length > 0 ? (
                                            <section className="screening-ai-compare-card__section">
                                                <h5>{t('aiCompareTop_risks')}</h5>
                                                <ul className="screening-ai-compare-card__list screening-ai-compare-card__list--risk">
                                                    {risks.map((r, ri) => (
                                                        <li key={ri}>{r}</li>
                                                    ))}
                                                </ul>
                                            </section>
                                        ) : null}

                                        {(row.watchOut || '').trim() ? (
                                            <section className="screening-ai-compare-card__section screening-ai-compare-card__section--watch">
                                                <h5>{t('aiCompareTop_watchOut')}</h5>
                                                <p>{row.watchOut}</p>
                                            </section>
                                        ) : null}

                                        {!isLast && (row.differenceFromNext || '').trim() ? (
                                            <section className="screening-ai-compare-card__section screening-ai-compare-card__section--diff">
                                                <h5>{t('aiCompareTop_differenceFromNext')}</h5>
                                                <p>{row.differenceFromNext}</p>
                                            </section>
                                        ) : null}

                                        {/* توافق رجعي: نتيجة قديمة بلا حقول غنية → اعرض النص المختصر */}
                                        {reasons.length === 0 &&
                                        strengths.length === 0 &&
                                        risks.length === 0 &&
                                        !executiveComment &&
                                        !(row.watchOut || '').trim() &&
                                        fallbackReason ? (
                                            <p className="screening-ai-compare-card__comment">
                                                {fallbackReason}
                                            </p>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                        </>
                    ) : !summary && !decisionSummary && !contextualIntroduction ? (
                        <div className="screening-ai-compare-panel__status-box">
                            <div className="screening-ai-compare-panel__state">
                                {t('aiCompareTop_noRanking')}
                            </div>
                        </div>
                    ) : null}

                    {/* ⑥ لماذا هذا المرشح — يشرح تفوّق الأول على الثاني */}
                    {whyTopCandidateWins ? (
                        <section className="compare-section compare-section--why">
                            <div className="compare-section__label">
                                {t('aiCompareTop_whyTopCandidateWins')}
                            </div>
                            <p className="compare-section__text">{whyTopCandidateWins}</p>
                        </section>
                    ) : null}

                    {/* ⑦ التوصية النهائية الحازمة — خاتمة التقرير */}
                    {finalRecommendation ? (
                        <section className="compare-section compare-section--final">
                            <div className="compare-section__label">
                                {t('aiCompareTop_finalRecommendation')}
                            </div>
                            <p className="compare-section__text">{finalRecommendation}</p>
                        </section>
                    ) : null}
                </>
            )}
            </div>
        </div>
    );
}
