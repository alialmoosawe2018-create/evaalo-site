import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import './WhyEvaalo.css';

/**
 * "Why evaalo" — problem statement + positioning + hiring pipeline + trial CTA.
 * Sits between Hero and Features. Bilingual via translations.js (en/ar/ku).
 */

const STEP_ICONS = [
    // AI Screening — scan a list
    'M4 6h16M4 11h9M4 16h6 M17.2 14.2m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0 M19.6 16.6L22 19',
    // Voice Interview — microphone
    'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
    // Video Assessment — camera
    'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M16 10l5-3v10l-5-3',
    // Candidate Comparison — ranked bars
    'M5 20V12 M12 20V5 M19 20v-5',
    // HR Decision — person + check (the human call)
    'M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z M5 20c0-3.2 3.1-5.3 7-5.3 M15.4 18.4l1.9 1.9 3.4-3.8',
];

/**
 * A miniature of what each stage actually produces, drawn under its label — so
 * the row reads as "what you get" rather than "what happens".
 *
 * Deliberately non-directional: the pipeline flows right-to-left in Arabic, so
 * a "before → after" composition would read backwards. Each one is a single
 * self-contained object instead.
 */
const buildStepArt = (questionMark) => [
    // AI Screening — a CV checked against the criteria, and scored. A checklist
    // rather than plain text lines: Stage 1 is exactly a criteria check that
    // ends in a score out of 100.
    <>
        <rect x="5" y="4" width="32" height="39" rx="4" />
        <path d="M11 12h13" strokeWidth="2.6" />
        <path d="M11 20l2 2 3.5-4M11 28l2 2 3.5-4M11 36l2 2 3.5-4" />
        <path d="M21 20h11M21 28h11M21 36h8" strokeOpacity="0.55" />
        {/* A score dial rather than a printed number: a fixed figure on a public
            page reads as a claim ("82 out of what, for whom?"). */}
        <circle cx="49" cy="33" r="10" strokeOpacity="0.3" />
        <circle cx="49" cy="33" r="10" strokeWidth="2.6" strokeDasharray="47 63" transform="rotate(-90 49 33)" />
    </>,
    // Voice Interview — the candidate, being asked. The question sits inside a
    // speech bubble rather than floating on its own: a bare "?" next to a person
    // reads as "unknown candidate" or as a help icon, which is the opposite of
    // what happens here.
    <>
        <circle cx="20" cy="18" r="6.5" />
        <path d="M9 43c0-7 5-11 11-11s11 4 11 11" />
        <rect x="33" y="5" width="23" height="19" rx="6" />
        <path d="M42 24l1 6 6-6" />
        <text x="44.5" y="20" textAnchor="middle" fontSize="13" fontWeight="700" stroke="none" fill="currentColor">{questionMark}</text>
    </>,
    // Video Assessment — scored against the role's own competency model (this is
    // literally the blueprint radar behind Stage 3).
    <>
        {/* The grid: a regular pentagon with its axes. */}
        <polygon points="32,4 52,19 45,43 19,43 12,19" strokeOpacity="0.28" />
        <path d="M32 25.5L32 4M32 25.5L52 19M32 25.5L45 43M32 25.5L19 43M32 25.5L12 19" strokeOpacity="0.28" />
        {/* The reading: deliberately IRREGULAR — an even shape looks decorative,
            an uneven one is what makes it read as measured data. */}
        <polygon points="32,7 43,22 43,41 26,33 18,21" />
        <circle cx="32" cy="7" r="1.8" fill="currentColor" />
        <circle cx="43" cy="22" r="1.8" fill="currentColor" />
        <circle cx="43" cy="41" r="1.8" fill="currentColor" />
        <circle cx="26" cy="33" r="1.8" fill="currentColor" />
        <circle cx="18" cy="21" r="1.8" fill="currentColor" />
    </>,
    // Candidate Comparison — a ranked shortlist. A podium with the lead in the
    // middle reads the same in either text direction.
    <>
        <path d="M12 43h40" strokeOpacity="0.4" />
        {/* Thick enough to read as bars rather than as three stray lines. */}
        <path d="M17 40V29M32 40V18M47 40V33" strokeWidth="5" />
        <circle cx="32" cy="10" r="4.5" />
    </>,
    // HR Decision — the human signs off. An approval mark rather than another
    // person, so it does not echo the person-and-check icon above it.
    <>
        <rect x="18" y="5" width="28" height="30" rx="7" />
        <path d="M25 20l5 5 9-10" />
        <path d="M14 43h36" strokeOpacity="0.4" />
    </>,
];

const WhyEvaalo = () => {
    const { t, currentLang } = useLanguage();
    const navigate = useNavigate();
    // The Arabic question mark is mirrored — the Latin one would read backwards.
    const stepArt = React.useMemo(
        () => buildStepArt(currentLang === 'en' ? '?' : '؟'),
        [currentLang]
    );
    const steps = [t('whyStep1'), t('whyStep2'), t('whyStep3'), t('whyStep4'), t('whyStep5')];

    return (
        <section className="why-evaalo" id="why">
            <div className="why-bg" aria-hidden="true">
                <svg viewBox="0 0 200 200" className="why-radar">
                    <circle cx="100" cy="100" r="90" />
                    <circle cx="100" cy="100" r="62" />
                    <circle cx="100" cy="100" r="34" />
                </svg>
            </div>

            <div className="why-inner">
                <h2 className="why-title">{t('whyProblemTitle')}</h2>
                <p className="why-body">{t('whyProblemBody')}</p>

                <div className="why-statement">
                    <p className="why-positioning">{t('whyPositioning')}</p>
                </div>

                <div className="why-pipeline-wrap">
                    <span className="why-pipeline-label">{t('whyPipelineLabel')}</span>
                    <div className="why-pipeline" role="list" aria-label={t('whyPipelineLabel')}>
                        {steps.map((label, i) => (
                            <React.Fragment key={i}>
                                <div
                                    className={`why-step${i === steps.length - 1 ? ' why-step--final' : ''}`}
                                    role="listitem"
                                >
                                    <span className="why-step__icon">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                                            stroke="currentColor" strokeWidth="1.8"
                                            strokeLinecap="round" strokeLinejoin="round">
                                            <path d={STEP_ICONS[i]} />
                                        </svg>
                                    </span>
                                    <span className="why-step__label">{label}</span>
                                    <span className="why-step__art" aria-hidden="true">
                                        <svg width="64" height="48" viewBox="0 0 64 48" fill="none"
                                            stroke="currentColor" strokeWidth="1.6"
                                            strokeLinecap="round" strokeLinejoin="round">
                                            {stepArt[i]}
                                        </svg>
                                    </span>
                                </div>
                                {i < steps.length - 1 && (
                                    <span className="why-connector" aria-hidden="true"></span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                <p className="why-tagline">{t('whyTagline')}</p>

                <div className="why-cta">
                    <p className="why-cta__title">{t('whyTryTitle')}</p>
                    <button
                        type="button"
                        className="btn btn-primary btn-large why-cta__btn"
                        onClick={() => navigate('/dashboard')}
                    >
                        <span>{t('whyTryBtn')}</span>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>
            </div>
        </section>
    );
};

export default WhyEvaalo;
