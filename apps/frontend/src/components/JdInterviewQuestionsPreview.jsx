import React, { useRef } from 'react';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea.js';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import {
    JD_QUESTION_MAX_CHARS,
    isJdDraftEdited,
    jdFailureMessageKey,
    jdProblemMessageKeys,
    jdSetProblemMessageKeys,
} from '../utils/jdInterviewQuestions.js';

const META = '#94A3B8';
const ERROR = '#EF4444';

/** A question or clarification box that follows its text, like the description box above it. */
function QuestionBox({ value, onChange, readOnly, dir, ariaLabel, fontSize, invalid }) {
    const ref = useRef(null);
    useAutoGrowTextarea(ref, value);
    return (
        <div className="ni-job-ad-preview ni-job-ad-preview__body--edit" style={{ marginTop: '6px' }}>
            <textarea
                ref={ref}
                className="ni-job-ad-preview__textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                readOnly={readOnly}
                maxLength={JD_QUESTION_MAX_CHARS}
                rows={2}
                dir={dir}
                aria-label={ariaLabel}
                aria-invalid={invalid || undefined}
                style={{ minHeight: 'unset', padding: '10px 14px', fontSize, lineHeight: 1.7 }}
            />
        </div>
    );
}

function Notes({ keys, t }) {
    if (!keys.length) return null;
    return (
        <ul role="alert" style={{ margin: '6px 0 0', paddingInlineStart: '18px', color: ERROR, fontSize: '12.5px', lineHeight: 1.6 }}>
            {keys.map((key) => (
                <li key={key}>{t(key)}</li>
            ))}
        </ul>
    );
}

function Muted({ children }) {
    return <p style={{ margin: '10px 0 0', fontSize: '13px', color: META, lineHeight: 1.6 }}>{children}</p>;
}

/**
 * «Opening questions of the video interview» — the three questions written from the
 * job description, shown before the job is created so the recruiter sees, and may
 * edit, exactly what the interviewer will ask. Rendered only while the backend has
 * the feature on (the parent passes applicability 'off' otherwise).
 */
export default function JdInterviewQuestionsPreview({
    t,
    uiLang,
    applicability,
    view,
    draft,
    interviewLanguage,
    notice,
    sectionRef,
    busy,
    onPrepare,
    onRegenerate,
    onSkip,
    onUndoSkip,
    onEdit,
}) {
    if (applicability === 'off') return null;
    const questionDir = interviewLanguage === 'en' ? 'ltr' : 'rtl';
    const edited = view === 'ready' && isJdDraftEdited(draft);

    const ghost = (label, onClick, disabled = false) => (
        <button
            type="button"
            className="ni-proposal-btn ni-proposal-btn--ghost"
            onClick={onClick}
            disabled={disabled || busy}
        >
            {label}
        </button>
    );
    const primary = (label, onClick) => (
        <button
            type="button"
            className="ni-proposal-btn ni-proposal-btn--primary workflow-btn-primary"
            onClick={onClick}
            disabled={busy}
        >
            {label}
        </button>
    );
    const actions = (...buttons) => (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>{buttons}</div>
    );

    let body = null;
    if (applicability === 'no_description') body = <Muted>{t('newCampaign_jdq_noDescription')}</Muted>;
    else if (applicability === 'no_language') body = <Muted>{t('newCampaign_jdq_noLanguage')}</Muted>;
    else if (applicability === 'language_not_enabled') body = <Muted>{t('newCampaign_jdq_languageNotEnabled')}</Muted>;
    else if (view === 'loading') {
        body = (
            <p className="ni-generate-ad-loading" style={{ margin: '12px 0 0', fontSize: '13px', color: META }}>
                <span className="ni-generate-ad-loading__text">{t('newCampaign_jdq_preparing')}</span>
                <span className="ni-generate-ad-loading__dots" aria-hidden="true">
                    <span className="ni-generate-ad-loading__dot" />
                    <span className="ni-generate-ad-loading__dot" />
                    <span className="ni-generate-ad-loading__dot" />
                </span>
            </p>
        );
    } else if (view === 'failed') {
        body = (
            <>
                <p role="alert" style={{ margin: '10px 0 0', fontSize: '13px', color: ERROR, lineHeight: 1.6 }}>
                    {t(jdFailureMessageKey(draft.error))}
                </p>
                {actions(
                    <React.Fragment key="retry">{primary(t('newCampaign_jdq_retry'), onPrepare)}</React.Fragment>,
                    <React.Fragment key="skip">{ghost(t('newCampaign_jdq_skip'), onSkip)}</React.Fragment>
                )}
            </>
        );
    } else if (view === 'skipped') {
        body = (
            <>
                <Muted>{t('newCampaign_jdq_skipped')}</Muted>
                {actions(<React.Fragment key="unskip">{ghost(t('newCampaign_jdq_unskip'), onUndoSkip)}</React.Fragment>)}
            </>
        );
    } else if (view === 'ready') {
        body = (
            <>
                <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                    {draft.questions.map((q, i) => {
                        const notes = jdProblemMessageKeys(draft.problems?.[i] || [], interviewLanguage);
                        return (
                            <li key={q.id || i} style={{ marginBottom: '16px' }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'baseline',
                                        gap: '12px',
                                        flexWrap: 'wrap',
                                        fontSize: '12.5px',
                                        color: META,
                                    }}
                                >
                                    <span style={{ fontWeight: 700 }}>
                                        {fillI18nTemplate(t('newCampaign_jdq_questionLabel'), { n: i + 1 })}
                                    </span>
                                    {q.duty ? (
                                        <span dir="auto">{fillI18nTemplate(t('newCampaign_jdq_covers'), { duty: q.duty })}</span>
                                    ) : null}
                                </div>
                                <QuestionBox
                                    value={q.question}
                                    onChange={(v) => onEdit(i, 'question', v)}
                                    readOnly={busy}
                                    dir={questionDir}
                                    ariaLabel={fillI18nTemplate(t('newCampaign_jdq_questionLabel'), { n: i + 1 })}
                                    fontSize="14.5px"
                                    invalid={notes.length > 0}
                                />
                                <div style={{ marginTop: '8px', fontSize: '12px', color: META }}>{t('newCampaign_jdq_hintLabel')}</div>
                                <QuestionBox
                                    value={q.clarifyHint}
                                    onChange={(v) => onEdit(i, 'clarifyHint', v)}
                                    readOnly={busy}
                                    dir={questionDir}
                                    ariaLabel={`${fillI18nTemplate(t('newCampaign_jdq_questionLabel'), { n: i + 1 })} — ${t('newCampaign_jdq_hintLabel')}`}
                                    fontSize="13px"
                                    invalid={notes.length > 0}
                                />
                                <Notes keys={notes} t={t} />
                            </li>
                        );
                    })}
                </ol>
                <Notes keys={jdSetProblemMessageKeys(draft.setProblems)} t={t} />
                {actions(
                    <React.Fragment key="regen">{ghost(t('newCampaign_jdq_regenerate'), onRegenerate)}</React.Fragment>,
                    <React.Fragment key="skip">{ghost(t('newCampaign_jdq_skip'), onSkip)}</React.Fragment>
                )}
            </>
        );
    } else {
        // idle, or a set made from an older description / language.
        body = (
            <>
                {view === 'stale' ? <Muted>{t('newCampaign_jdq_stale')}</Muted> : null}
                {actions(
                    <React.Fragment key="prepare">{primary(t('newCampaign_jdq_prepare'), onPrepare)}</React.Fragment>,
                    <React.Fragment key="skip">{ghost(t('newCampaign_jdq_skip'), onSkip)}</React.Fragment>
                )}
            </>
        );
    }

    return (
        <div ref={sectionRef} className="ni-job-ad-section ni-jdq-section" data-jdq-view={applicability === 'on' ? view : applicability}>
            <div className="ni-job-ad-block">
                <h4
                    className="ni-job-ad-heading"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        fontSize: '14px',
                        fontWeight: 700,
                        margin: '0 0 8px',
                        textTransform: uiLang === 'en' ? 'uppercase' : 'none',
                        letterSpacing: uiLang === 'en' ? '0.5px' : '0',
                    }}
                >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                            d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 014 14.5v-9z"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinejoin="round"
                        />
                        <path d="M9.5 8.2a2.5 2.5 0 114 2c-.8.5-1.5 1-1.5 1.9M12 14h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    {t('newCampaign_jdq_title')}
                    {edited ? (
                        <span
                            style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'none',
                                letterSpacing: 0,
                                padding: '2px 8px',
                                borderRadius: '999px',
                                border: '1px solid rgba(148, 163, 184, 0.45)',
                                color: META,
                            }}
                        >
                            {t('newCampaign_jdq_edited')}
                        </span>
                    ) : null}
                </h4>
                <p className="ni-job-ad-desc" style={{ fontSize: '13px', margin: 0 }}>
                    {t('newCampaign_jdq_desc')}
                </p>
            </div>
            {body}
            {notice ? (
                <p role="alert" style={{ margin: '10px 0 0', fontSize: '13px', fontWeight: 600, color: ERROR }}>
                    {notice}
                </p>
            ) : null}
        </div>
    );
}
