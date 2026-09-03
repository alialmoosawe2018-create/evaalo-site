import React, { useEffect, useMemo, useState } from 'react';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import { buildHeadHunterContactChannels } from '../../utils/headHunterContactChannels.js';
import { groupExperienceTimelineByCompany, sortExperienceTimelineDescending } from '../../utils/headhunterCandidateBrief.js';
import HeadHunterCandidateMainBrief from './HeadHunterCandidateMainBrief.jsx';
import HeadHunterContactGate from './HeadHunterContactGate.jsx';
import HeadHunterSendActions from './HeadHunterSendActions.jsx';

/**
 * @typedef {import('../../utils/headHunterNormalize.js').HeadHunterCandidate} HeadHunterCandidate
 */

function MatchScoreRing({ score, label }) {
    const pct = Math.min(100, Math.max(0, Number(score) || 0));
    const r = 36;
    const c = 2 * Math.PI * r;
    const offset = c - (pct / 100) * c;

    // Start empty, then fill to the target on mount so the ring animates in.
    const [animatedOffset, setAnimatedOffset] = useState(c);
    useEffect(() => {
        const id = requestAnimationFrame(() => setAnimatedOffset(offset));
        return () => cancelAnimationFrame(id);
    }, [offset, c]);

    return (
        <div className="headhunter-panel__match-ring-wrap" aria-label={label}>
            <svg className="headhunter-panel__match-ring" viewBox="0 0 88 88" width="88" height="88">
                <circle
                    className="headhunter-panel__match-ring-bg"
                    cx="44"
                    cy="44"
                    r={r}
                    fill="none"
                    strokeWidth="8"
                />
                <circle
                    className="headhunter-panel__match-ring-fg"
                    cx="44"
                    cy="44"
                    r={r}
                    fill="none"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={animatedOffset}
                    transform="rotate(-90 44 44)"
                />
                <text x="44" y="48" textAnchor="middle" className="headhunter-panel__match-ring-text" fontSize="18" fontWeight="700">
                    {Math.round(pct)}%
                </text>
            </svg>
        </div>
    );
}

function availabilityLabel(t, avail) {
    if (avail === 'open_to_work') return t('aiHeadHunterAvailOpen');
    if (avail === 'passive') return t('aiHeadHunterAvailPassive');
    if (avail === 'recently_active') return t('aiHeadHunterAvailRecent');
    return '';
}

/** @param {string} name */
function companyInitialGlyph(name) {
    const t = typeof name === 'string' ? name.trim() : '';
    if (!t || t === '—') return '·';
    return t.slice(0, 1);
}

/** اسم الجامعة لأيقونة مختصرة (قطعة قبل أول ·). */
function educationSchoolGlyphLabel(schoolLine) {
    const t = typeof schoolLine === 'string' ? schoolLine.replace(/\s+/g, ' ').trim() : '';
    const head = t.split(/\s*[·︱|]\s*/)[0]?.trim();
    return head || t || '—';
}

/**
 * شعار جهة التعليم (دائرة مشابهة لتجربة الخبرات).
 *
 * @param {{ logoUrl: string; label: string }} props
 */
function EducationSchoolLogoPlate({ logoUrl, label }) {
    const [broken, setBroken] = useState(false);
    useEffect(() => {
        setBroken(false);
    }, [logoUrl]);
    const showImg = Boolean(logoUrl) && !broken;
    const glyphLabel = educationSchoolGlyphLabel(label);
    return (
        <div className="headhunter-edu__logo-slot" aria-hidden>
            {showImg ? (
                <img
                    src={logoUrl}
                    alt=""
                    className="headhunter-edu__logo-img"
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken(true)}
                />
            ) : (
                <div className="headhunter-edu__logo-ph" title={glyphLabel}>
                    {companyInitialGlyph(glyphLabel)}
                </div>
            )}
        </div>
    );
}

/**
 * شعار دائري في عمود التجربة (LinkedIn-like).
 *
 * @param {{ logoUrl: string; label: string }} props
 */
function ExperienceCompanyLogoPlate({ logoUrl, label }) {
    const [broken, setBroken] = useState(false);
    useEffect(() => {
        setBroken(false);
    }, [logoUrl]);
    const showImg = Boolean(logoUrl) && !broken;
    return (
        <div className="headhunter-exp-ln__logo-slot">
            {showImg ? (
                <img
                    src={logoUrl}
                    alt=""
                    className="headhunter-exp-ln__logo-img"
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken(true)}
                />
            ) : (
                <div className="headhunter-exp-ln__logo-ph" aria-hidden>
                    {companyInitialGlyph(label)}
                </div>
            )}
        </div>
    );
}

/** @param {import('../../utils/headHunterNormalize.js').HeadHunterTimelineEntry} ex */
function experienceDateRange(ex) {
    return [ex.start, ex.end].filter(Boolean).join(' — ');
}

/**
 * @param {{ ex: import('../../utils/headHunterNormalize.js').HeadHunterTimelineEntry }} props
 */
function PanelExperienceRoleBody({ ex }) {
    const range = experienceDateRange(ex);
    const loc = typeof ex.location === 'string' ? ex.location.trim() : '';
    const desc = typeof ex.description === 'string' ? ex.description.trim() : '';
    return (
        <>
            <strong className="headhunter-exp-ln__role-title" dir="auto">
                {ex.title || '—'}
            </strong>
            {range ? (
                <span className="headhunter-exp-ln__role-dates" dir="auto">
                    {range}
                </span>
            ) : null}
            {loc ? (
                <span className="headhunter-exp-ln__role-loc" dir="auto">
                    {loc}
                </span>
            ) : null}
            {desc ? (
                <p className="headhunter-exp-ln__role-desc" dir="auto">
                    {desc}
                </p>
            ) : null}
        </>
    );
}

/**
 * @param {object} props
 * @param {HeadHunterCandidate | null} props.candidate
 * @param {() => void} [props.onClose]
 * @param {boolean} [props.showClose]
 * @param {unknown} [props.contactStatus]
 * @param {(key: string) => string} props.t
 */
export default function HeadHunterCandidatePanel({
    candidate,
    onClose,
    showClose,
    contactStatus,
    contactRevealed = false,
    contactRevealPending = false,
    contactRevealError = '',
    onRevealContact,
    t,
}) {
    const availText = candidate ? availabilityLabel(t, candidate.availability) : '';

    // Every hook must run before the `!candidate` early return below. When the panel
    // closes (candidate -> null) React would otherwise see a different number of
    // hooks between renders and throw "Rendered fewer hooks than expected", so each
    // one reads candidate optionally instead of sitting after the guard.
    const id = candidate?.id;
    const photoUrl = candidate?.photo_url;

    const [photoBroken, setPhotoBroken] = useState(false);
    useEffect(() => {
        setPhotoBroken(false);
    }, [id, photoUrl]);

    const experienceSorted = useMemo(
        () => sortExperienceTimelineDescending(candidate?.experience_timeline || []),
        [candidate?.experience_timeline],
    );

    const experienceGrouped = useMemo(
        () => groupExperienceTimelineByCompany(experienceSorted),
        [experienceSorted],
    );

    const contact = useMemo(
        () => (candidate ? buildHeadHunterContactChannels(candidate) : null),
        [candidate],
    );

    const matchCriteria = useMemo(
        () =>
            (candidate?.match_insights || [])
                .map((ins) => {
                    const raw = String(ins?.text || '').trim();
                    const label = (raw.split(':')[0] || raw).trim();
                    return { label, matched: ins?.kind === 'positive' };
                })
                .filter((c) => c.label),
        [candidate?.match_insights],
    );

    if (!candidate) {
        return null;
    }

    const panelNameId = `hh-panel-${String(id).replace(/[^\w.-]/g, '_')}`;
    const showPhoto = Boolean(photoUrl) && !photoBroken;

    const skills = candidate.skills || [];
    const languages = candidate.languages || [];

    const hasExperience = experienceSorted.length > 0;
    const hasSmartMatch = candidate.match_score != null && Number.isFinite(candidate.match_score);

    return (
        <aside className="headhunter-panel" aria-label={candidate.full_name || t('aiHeadHunterUnknownName')}>
            <div className="headhunter-panel__sticky-actions">
                {showClose && onClose ? (
                    <button type="button" className="headhunter-panel__close-m" onClick={onClose} aria-label={t('aiHeadHunterClosePanel')}>
                        ×
                    </button>
                ) : null}
            </div>

            <div className="headhunter-panel__scroll">
            <div className="headhunter-panel__header">
                <div className="headhunter-panel__dual">
                    <div className="headhunter-panel__dual-col headhunter-panel__dual-col--cv">
                        <div
                            className={
                                'headhunter-panel__cv-split' +
                                (!hasExperience ? ' headhunter-panel__cv-split--single' : '')
                            }
                        >
                            {hasExperience ? (
                                <div className="headhunter-panel__cv-split-col headhunter-panel__cv-split-col--exp">
                                    <section className="headhunter-panel__section headhunter-panel__section--in-dual">
                                        <h3 className="headhunter-panel__section-title">{t('aiHeadHunterExperience')}</h3>
                                        <ul className="headhunter-exp-ln" role="list">
                                            {experienceGrouped.map((g, gi) => (
                                                <li key={`${id}-xpgrp-${gi}`} className="headhunter-exp-ln__block">
                                                    <div className="headhunter-exp-ln__logo-cell">
                                                        <ExperienceCompanyLogoPlate
                                                            logoUrl={g.logoUrl}
                                                            label={g.companyDisplay}
                                                        />
                                                    </div>
                                                    <strong className="headhunter-exp-ln__co-name">
                                                        <bdi>{g.companyDisplay}</bdi>
                                                    </strong>
                                                    {g.roles.length === 1 ? (
                                                        <div className="headhunter-exp-ln__roles-cell">
                                                            <PanelExperienceRoleBody ex={g.roles[0]} />
                                                        </div>
                                                    ) : (
                                                        <div className="headhunter-exp-ln__roles-cell headhunter-exp-ln__roles-cell--multi">
                                                            <ul className="headhunter-exp-ln__role-list" role="list">
                                                                {g.roles.map((ex, ri) => (
                                                                    <li
                                                                        key={`${id}-xpr-${gi}-${ri}`}
                                                                        className="headhunter-exp-ln__role-item"
                                                                    >
                                                                        <div className="headhunter-exp-ln__role-marker" aria-hidden>
                                                                            <span className="headhunter-exp-ln__role-dot" />
                                                                        </div>
                                                                        <div className="headhunter-exp-ln__role-body">
                                                                            <PanelExperienceRoleBody ex={ex} />
                                                                        </div>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                </div>
                            ) : null}
                            <div
                                className={
                                    'headhunter-panel__cv-split-col headhunter-panel__cv-split-col--ai' +
                                    (!hasExperience ? ' headhunter-panel__cv-split-col--ai-full' : '')
                                }
                            >
                                <section
                                    className="headhunter-panel__section headhunter-panel__section--in-dual headhunter-panel__section--ai-analysis"
                                    aria-labelledby={`${panelNameId}-ai-analysis`}
                                >
                                    <h3 className="headhunter-panel__section-title" id={`${panelNameId}-ai-analysis`}>
                                        {t('aiHeadHunterAiAnalysis')}
                                    </h3>
                                    <div className="headhunter-panel__ai-analysis-body">
                                        {hasSmartMatch ? (
                                            <div className="headhunter-panel__score-row headhunter-panel__score-row--in-ai">
                                                <MatchScoreRing
                                                    score={candidate.match_score}
                                                    label={fillI18nTemplate(t('aiHeadHunterSmartScoreAria'), {
                                                        n: Math.round(candidate.match_score),
                                                    })}
                                                />
                                            </div>
                                        ) : (
                                            <p className="headhunter-panel__ai-analysis-body--empty">{t('aiHeadHunterSmartScoreEmpty')}</p>
                                        )}
                                        {matchCriteria.length > 0 ? (
                                            <ul className="headhunter-panel__criteria">
                                                {matchCriteria.map((crit, i) => (
                                                    <li
                                                        key={i}
                                                        className={`headhunter-panel__criteria-item${crit.matched ? ' headhunter-panel__criteria-item--matched' : ''}`}
                                                    >
                                                        <span className="headhunter-panel__criteria-label">{crit.label}</span>
                                                        {crit.matched ? (
                                                            <span className="headhunter-panel__criteria-check" aria-hidden>
                                                                ✓
                                                            </span>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>

                    <div className="headhunter-panel__dual-col headhunter-panel__dual-col--profile">
                        <HeadHunterCandidateMainBrief
                            candidate={candidate}
                            t={t}
                            nameId={panelNameId}
                            showPhoto={showPhoto}
                            onPhotoError={() => setPhotoBroken(true)}
                            tenureTruncate={200}
                            showSkills={false}
                            variant="card-linkedin"
                        />

                        {skills.length > 0 ? (
                            <section className="headhunter-panel__section headhunter-panel__section--in-dual headhunter-panel__section--profile-col">
                                <h3 className="headhunter-panel__section-title">{t('aiHeadHunterSkillsAndCerts')}</h3>
                                <div className="headhunter-panel__skill-chips headhunter-chips">
                                    {skills.map((skill, i) => (
                                        <span key={`${id}-panel-skill-${i}`} className="headhunter-chip headhunter-panel__skill-chip">
                                            {skill}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {languages.length > 0 ? (
                            <section className="headhunter-panel__section headhunter-panel__section--in-dual headhunter-panel__section--profile-col">
                                <h3 className="headhunter-panel__section-title">{t('aiHeadHunterLanguages')}</h3>
                                <div className="headhunter-panel__skill-chips headhunter-chips">
                                    {languages.map((lang, i) => (
                                        <span key={`${id}-panel-lang-${i}`} className="headhunter-chip headhunter-panel__skill-chip">
                                            {lang}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {(candidate.education || []).length > 0 ? (
                            <section className="headhunter-panel__section headhunter-panel__section--in-dual headhunter-panel__section--profile-col">
                                <h3 className="headhunter-panel__section-title">{t('aiHeadHunterEducation')}</h3>
                                <ul className="headhunter-edu">
                                    {(candidate.education || []).map((ed, i) => (
                                        <li key={i} className="headhunter-edu__item">
                                            <div className="headhunter-edu__item-row">
                                                <EducationSchoolLogoPlate
                                                    logoUrl={typeof ed.school_logo_url === 'string' ? ed.school_logo_url : ''}
                                                    label={ed.school || '—'}
                                                />
                                                <div className="headhunter-edu__body">
                                                    <strong>{ed.school}</strong>
                                                    {ed.years ? <span className="headhunter-edu__years">{ed.years}</span> : null}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}

                        <section className="headhunter-panel__section headhunter-panel__section--in-dual headhunter-panel__section--profile-col headhunter-panel__section--contact">
                            <h3 className="headhunter-panel__section-title">{t('aiHeadHunterCardContactInfo')}</h3>
                            <HeadHunterContactGate
                                contact={contact}
                                revealed={contactRevealed}
                                pending={contactRevealPending}
                                error={contactRevealError}
                                onReveal={() => onRevealContact?.(candidate)}
                                t={t}
                            />
                            <HeadHunterSendActions candidate={candidate} contactStatus={contactStatus} t={t} />
                        </section>
                    </div>
                </div>

                <div className="headhunter-panel__badges-row">
                    {availText ? <span className="headhunter-badge">{availText}</span> : null}
                    {candidate.last_activity_label ? (
                        <span className="headhunter-badge headhunter-badge--muted">{candidate.last_activity_label}</span>
                    ) : null}
                </div>

            </div>
            </div>

        </aside>
    );
}
