import React from 'react';
import LegalPageShell from '../components/LegalPageShell';
import LegalBullets from '../components/LegalBullets';
import { useLanguage } from '../contexts/LanguageContext';
import { getLegalDocs } from '../i18n/legalPages';

export default function AboutPage() {
    const { t, currentLang } = useLanguage();
    const { about: a } = getLegalDocs(currentLang);
    const isRtl = currentLang === 'ar' || currentLang === 'ku';

    const body = (
        <>
            <p>{a.introP1}</p>
            <p>{a.introP2}</p>

            <h2>{a.mission.title}</h2>
            <p>{a.mission.p1}</p>
            <p>{a.mission.p2}</p>

            <h2>{a.whatWeDo.title}</h2>
            <p>{a.whatWeDo.intro}</p>
            <LegalBullets items={a.whatWeDo.bullets} />
            <p>{a.whatWeDo.foot}</p>

            <h2>{a.technology.title}</h2>
            <p>{a.technology.intro}</p>
            <LegalBullets items={a.technology.bullets} />

            <h2>{a.vision.title}</h2>
            <p>{a.vision.p}</p>

            <h2>{a.why.title}</h2>
            <LegalBullets items={a.why.bullets} />

            <h2>{a.contact.title}</h2>
            <p>{a.contact.intro}</p>
            <div className="legal-contact-card">
                <a
                    className="legal-contact-card__link"
                    href="mailto:team@evaalo.com"
                >
                    <span className="legal-contact-card__icon" aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect
                                x="3"
                                y="5"
                                width="18"
                                height="14"
                                rx="2"
                                stroke="currentColor"
                                strokeWidth="1.6"
                            />
                            <path
                                d="M3 7l9 6 9-6"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </span>
                    <span>team@evaalo.com</span>
                </a>
            </div>
        </>
    );

    return (
        <LegalPageShell title={t('aboutUs')} variant="features">
            {isRtl ? (
                <div className="legal-page-rtl" dir="rtl" lang={currentLang}>
                    {body}
                </div>
            ) : (
                body
            )}
        </LegalPageShell>
    );
}
