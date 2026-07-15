import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

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

export default function ScreeningAiComparePanel({ status, result, onDismiss }) {
    const { t } = useLanguage();

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

    return (
        <div className="screening-ai-compare-panel">
            <div className="screening-ai-compare-panel__header">
                <div className="screening-ai-compare-panel__title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 2l2.09 5.26L20 8.27l-4 3.64L17.18 18 12 15.27 6.82 18 8 11.91 4 8.27l5.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                    <span>{t('aiCompareTop_panelTitle')}</span>
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
                        <div className="screening-ai-compare-cards">
                            {ranking.map((row, i) => {
                                const reasons = toList(row.reasons);
                                const strengths = toList(row.strengthsList ?? row.strengths);
                                const risks = toList(row.risks ?? row.weaknesses);
                                const rank = row.rank ?? i + 1;
                                const isLast = i === ranking.length - 1;
                                const recommendation = (row.overallRecommendation || '').trim();
                                const executiveComment = (row.executiveComment || '').trim();
                                const hasConfidence =
                                    row.confidence != null && Number.isFinite(Number(row.confidence));
                                // نصّ حرّ قديم كبديل عند غياب الحقول الغنية
                                const fallbackReason = (row.reason || '').trim();

                                return (
                                    <article
                                        className={`screening-ai-compare-card${rank === 1 ? ' screening-ai-compare-card--top' : ''}`}
                                        key={`${row.candidateEmail || row.candidateName || 'row'}-${i}`}
                                    >
                                        <header className="screening-ai-compare-card__head">
                                            <span className="screening-ai-compare-card__rank">{rank}</span>
                                            <div className="screening-ai-compare-card__identity">
                                                <div className="screening-ai-compare-card__name">
                                                    {row.candidateName || '—'}
                                                </div>
                                                {row.candidateEmail ? (
                                                    <div className="screening-ai-compare-card__email">
                                                        {row.candidateEmail}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="screening-ai-compare-card__badges">
                                                {recommendation ? (
                                                    <span
                                                        className={`screening-ai-compare-badge screening-ai-compare-badge--rec screening-ai-compare-badge--rec-${recommendationTone(
                                                            row.recommendation
                                                        )}`}
                                                    >
                                                        {recommendation}
                                                    </span>
                                                ) : null}
                                                {hasConfidence ? (
                                                    <div className="screening-ai-compare-card__conf">
                                                        <span className="screening-ai-compare-badge screening-ai-compare-badge--conf">
                                                            {t('aiCompareTop_confidence')}: {Math.round(Number(row.confidence))}%
                                                        </span>
                                                        {(row.confidence_rationale || '').trim() ? (
                                                            <span className="screening-ai-compare-card__conf-rationale">
                                                                {row.confidence_rationale}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {row.score != null ? (
                                                    <span className="screening-ai-compare-badge screening-ai-compare-badge--score">
                                                        {t('aiCompareTop_colScore')}: {row.score}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </header>

                                        {executiveComment ? (
                                            <p className="screening-ai-compare-card__comment">
                                                {executiveComment}
                                            </p>
                                        ) : null}

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
