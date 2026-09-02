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

const WhyEvaalo = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
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
