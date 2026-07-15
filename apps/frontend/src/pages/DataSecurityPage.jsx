import React from 'react';
import LegalPageShell from '../components/LegalPageShell';
import { useLanguage } from '../contexts/LanguageContext';
import { getLegalDocs } from '../i18n/legalPages';
import LegalBullets from '../components/LegalBullets';
import LegalParagraphs from '../components/LegalParagraphs';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';

function SecurityEmailLink() {
    return (
        <a className="legal-contact-card__link" href="mailto:team@evaalo.com">
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
    );
}

export default function DataSecurityPage() {
    const { t, currentLang } = useLanguage();
    const { security: s } = getLegalDocs(currentLang);
    const lt = (text) => localizeLegalBrandText(text, currentLang);
    const isRtl = currentLang === 'ar' || currentLang === 'ku';

    const body = (
        <>
            <div className="legal-meta-pill" aria-label={lt(s.updated)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect
                        x="3"
                        y="5"
                        width="18"
                        height="16"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                    />
                    <path
                        d="M3 9h18M8 3v4M16 3v4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                    />
                </svg>
                <span>{lt(s.updated)}</span>
            </div>

            <LegalParagraphs paragraphs={s.opening?.paragraphs} />
            {s.opening?.contactLine ? (
                <p>
                    {lt(s.opening.contactLine)}{' '}
                    <a href="mailto:team@evaalo.com">team@evaalo.com</a>
                </p>
            ) : null}

            <h2>{lt(s.s1.title)}</h2>
            <LegalParagraphs paragraphs={s.s1.paragraphs} />

            <h2>{lt(s.s2.title)}</h2>
            <p>{lt(s.s2.intro)}</p>
            <p>{lt(s.s2.measuresIntro)}</p>
            <LegalBullets items={s.s2.bullets} />

            <h2>{lt(s.s3.title)}</h2>
            <LegalParagraphs paragraphs={s.s3.paragraphs} />
            <p>{lt(s.s3.servicesIntro)}</p>
            <LegalBullets items={s.s3.bullets} />
            <p>{lt(s.s3.foot)}</p>

            <h2>{lt(s.s4.title)}</h2>
            <p>{lt(s.s4.intro)}</p>
            <p>{lt(s.s4.controlsIntro)}</p>
            <LegalBullets items={s.s4.bullets} />
            <p>{lt(s.s4.foot)}</p>

            <h2>{lt(s.s5.title)}</h2>
            <LegalParagraphs paragraphs={s.s5.paragraphs} />

            <h2>{lt(s.s6.title)}</h2>
            <p>{lt(s.s6.intro)}</p>
            <p>{lt(s.s6.providersIntro)}</p>
            <LegalBullets items={s.s6.bullets} />
            <LegalParagraphs paragraphs={s.s6.footParagraphs} />

            <h2>{lt(s.s7.title)}</h2>
            <p>{lt(s.s7.intro)}</p>
            <LegalBullets items={s.s7.bullets} />
            <p>{lt(s.s7.foot)}</p>

            <h2>{lt(s.s8.title)}</h2>
            <LegalParagraphs paragraphs={s.s8.paragraphs} />

            <h2>{lt(s.s9.title)}</h2>
            <p>{lt(s.s9.intro)}</p>
            <p>{lt(s.s9.responsibleIntro)}</p>
            <LegalBullets items={s.s9.bullets} />
            <p>{lt(s.s9.foot)}</p>

            <h2>{lt(s.s10.title)}</h2>
            <p>{lt(s.s10.intro)}</p>
            <p>{lt(s.s10.dependsIntro)}</p>
            <LegalBullets items={s.s10.bullets} />
            <p>{lt(s.s10.foot)}</p>

            <h2>{lt(s.s11.title)}</h2>
            <LegalParagraphs paragraphs={s.s11.paragraphs} />

            <h2>{lt(s.contact.title)}</h2>
            <div className="legal-contact-card">
                <p className="legal-contact-card__intro">{lt(s.contact.intro)}</p>
                {s.contact.company ? (
                    <p className="legal-contact-card__company">
                        <strong>{lt(s.contact.company)}</strong>
                    </p>
                ) : null}
                <SecurityEmailLink />
            </div>
        </>
    );

    return (
        <LegalPageShell title={t('dataSecurity')} variant="features">
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
