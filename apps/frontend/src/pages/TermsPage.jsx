import React from 'react';
import LegalPageShell from '../components/LegalPageShell';
import { useLanguage } from '../contexts/LanguageContext';
import { getLegalDocs } from '../i18n/legalPages';
import LegalBullets from '../components/LegalBullets';
import LegalParagraphs from '../components/LegalParagraphs';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';

function TermsEmailLink() {
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

export default function TermsPage() {
    const { t, currentLang } = useLanguage();
    const { terms: tr } = getLegalDocs(currentLang);
    const lt = (text) => localizeLegalBrandText(text, currentLang);
    const isRtl = currentLang === 'ar' || currentLang === 'ku';

    const body = (
        <>
            <div className="legal-meta-pill" aria-label={lt(tr.updated)}>
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
                <span>{lt(tr.updated)}</span>
            </div>

            <LegalParagraphs paragraphs={tr.opening?.paragraphs} />

            <h2>{lt(tr.s1.title)}</h2>
            <p>{lt(tr.s1.intro)}</p>
            <p>{lt(tr.s1.servicesIntro)}</p>
            <LegalBullets items={tr.s1.bullets} />
            <p>{lt(tr.s1.foot)}</p>

            <h2>{lt(tr.s2.title)}</h2>
            <LegalParagraphs paragraphs={tr.s2.paragraphs} />

            <h2>{lt(tr.s3.title)}</h2>
            <p>{lt(tr.s3.intro)}</p>
            <p>{lt(tr.s3.agreeIntro)}</p>
            <LegalBullets items={tr.s3.bullets} />
            <LegalParagraphs paragraphs={tr.s3.footParagraphs} />

            <h2>{lt(tr.s4.title)}</h2>
            <p>{lt(tr.s4.intro)}</p>
            <p>{lt(tr.s4.includesIntro)}</p>
            <LegalBullets items={tr.s4.bullets} />
            <LegalParagraphs paragraphs={tr.s4.footParagraphs} />

            <h2>{lt(tr.s5.title)}</h2>
            <p>{lt(tr.s5.intro)}</p>
            <p>{lt(tr.s5.mustNotIntro)}</p>
            <LegalBullets items={tr.s5.bullets} />
            <p>{lt(tr.s5.foot)}</p>

            <h2>{lt(tr.s6.title)}</h2>
            <LegalParagraphs paragraphs={tr.s6.paragraphs} />

            <h2>{lt(tr.s7.title)}</h2>
            <LegalParagraphs paragraphs={tr.s7.paragraphs} />

            <h2>{lt(tr.s8.title)}</h2>
            <p>{lt(tr.s8.intro)}</p>
            <p>{lt(tr.s8.mustNotIntro)}</p>
            <LegalBullets items={tr.s8.bullets} />
            <p>{lt(tr.s8.foot)}</p>

            <h2>{lt(tr.s9.title)}</h2>
            <LegalParagraphs paragraphs={tr.s9.paragraphs} />
            <p>{lt(tr.s9.grantIntro)}</p>
            <LegalBullets items={tr.s9.grantBullets} />
            <p>{lt(tr.s9.warranty)}</p>

            <h2>{lt(tr.s10.title)}</h2>
            <LegalParagraphs paragraphs={tr.s10.paragraphs} />

            <h2>{lt(tr.s11.title)}</h2>
            <LegalParagraphs paragraphs={tr.s11.paragraphs} />
            <p>{lt(tr.s11.unlessIntro)}</p>
            <LegalBullets items={tr.s11.unlessBullets} />
            <p>{lt(tr.s11.foot)}</p>

            <h2>{lt(tr.s12.title)}</h2>
            <p>{lt(tr.s12.intro)}</p>
            <LegalBullets items={tr.s12.bullets} />
            <LegalParagraphs paragraphs={tr.s12.footParagraphs} />

            <h2>{lt(tr.s13.title)}</h2>
            <LegalParagraphs paragraphs={tr.s13.paragraphs} />

            <h2>{lt(tr.s14.title)}</h2>
            <p>{lt(tr.s14.intro)}</p>
            <p>{lt(tr.s14.guaranteeIntro)}</p>
            <LegalBullets items={tr.s14.guaranteeBullets} />
            <p>{lt(tr.s14.foot)}</p>

            <h2>{lt(tr.s15.title)}</h2>
            <p>{lt(tr.s15.intro)}</p>
            <p>{lt(tr.s15.includesIntro)}</p>
            <LegalBullets items={tr.s15.includesBullets} />
            <LegalParagraphs paragraphs={tr.s15.footParagraphs} />

            <h2>{lt(tr.s16.title)}</h2>
            <p>{lt(tr.s16.intro)}</p>
            <LegalBullets items={tr.s16.bullets} />

            <h2>{lt(tr.s17.title)}</h2>
            <LegalParagraphs paragraphs={tr.s17.paragraphs} />

            <h2>{lt(tr.s18.title)}</h2>
            <LegalParagraphs paragraphs={tr.s18.paragraphs} />

            <h2>{lt(tr.s19.title)}</h2>
            <LegalParagraphs paragraphs={tr.s19.paragraphs} />

            <h2>{lt(tr.contact.title)}</h2>
            <div className="legal-contact-card">
                <p className="legal-contact-card__intro">{lt(tr.contact.intro)}</p>
                {tr.contact.company ? (
                    <p className="legal-contact-card__company">
                        <strong>{lt(tr.contact.company)}</strong>
                    </p>
                ) : null}
                <TermsEmailLink />
            </div>
        </>
    );

    return (
        <LegalPageShell title={t('terms')} variant="features">
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
