import React from 'react';
import LegalPageShell from '../components/LegalPageShell';
import { useLanguage } from '../contexts/LanguageContext';
import { getLegalDocs } from '../i18n/legalPages';
import LegalBullets from '../components/LegalBullets';
import LegalParagraphs from '../components/LegalParagraphs';
import { localizeLegalBrandText } from '../utils/localizeLegalBrandText';

function PrivacyEmailLink() {
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

export default function PrivacyPage() {
    const { t, currentLang } = useLanguage();
    const { privacy: p } = getLegalDocs(currentLang);
    const lt = (text) => localizeLegalBrandText(text, currentLang);
    const isRtl = currentLang === 'ar' || currentLang === 'ku';

    const body = (
        <>
            <div className="legal-meta-pill" aria-label={lt(p.updated)}>
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
                <span>{lt(p.updated)}</span>
            </div>

            <LegalParagraphs paragraphs={p.opening?.paragraphs} />
            {p.opening?.contactLine ? (
                <p>
                    {lt(p.opening.contactLine)}{' '}
                    <a href="mailto:team@evaalo.com">team@evaalo.com</a>
                </p>
            ) : null}

            <h2>{lt(p.s1.title)}</h2>
            <LegalParagraphs paragraphs={p.s1.paragraphs} />

            <h2>{lt(p.s2.title)}</h2>
            <p>{lt(p.s2.intro)}</p>

            <h3>{lt(p.s2.candidate.title)}</h3>
            <p>{lt(p.s2.candidate.intro)}</p>
            <LegalBullets items={p.s2.candidate.bullets} />

            <h3>{lt(p.s2.employer.title)}</h3>
            <p>{lt(p.s2.employer.intro)}</p>
            <LegalBullets items={p.s2.employer.bullets} />

            <h3>{lt(p.s2.technical.title)}</h3>
            <p>{lt(p.s2.technical.intro)}</p>
            <LegalBullets items={p.s2.technical.bullets} />

            <h2>{lt(p.s3.title)}</h2>
            <LegalParagraphs paragraphs={p.s3.paragraphs} />
            <p>{lt(p.s3.analyzeIntro)}</p>
            <LegalBullets items={p.s3.analyzeBullets} />
            <LegalParagraphs paragraphs={p.s3.footParagraphs} />

            <h2>{lt(p.s4.title)}</h2>
            <LegalParagraphs paragraphs={p.s4.paragraphs} />

            <h2>{lt(p.s5.title)}</h2>
            <p>{lt(p.s5.intro)}</p>
            <LegalBullets items={p.s5.bullets} />

            <h2>{lt(p.s6.title)}</h2>
            <p>{lt(p.s6.intro)}</p>

            <h3>{lt(p.s6.hiringOrgs.title)}</h3>
            <p>{lt(p.s6.hiringOrgs.p)}</p>

            <h3>{lt(p.s6.authorizedUsers.title)}</h3>
            <p>{lt(p.s6.authorizedUsers.p)}</p>

            <h3>{lt(p.s6.serviceProviders.title)}</h3>
            <p>{lt(p.s6.serviceProviders.intro)}</p>
            <LegalBullets items={p.s6.serviceProviders.bullets} />
            <p>{lt(p.s6.serviceProviders.foot)}</p>

            <h3>{lt(p.s6.legal.title)}</h3>
            <p>{lt(p.s6.legal.intro)}</p>
            <LegalBullets items={p.s6.legal.bullets} />

            <h3>{lt(p.s6.noSell.title)}</h3>
            <p>{lt(p.s6.noSell.p)}</p>

            <h2>{lt(p.s7.title)}</h2>
            <p>{lt(p.s7.intro)}</p>
            <LegalBullets items={p.s7.bullets} />
            <p>{lt(p.s7.foot)}</p>

            <h2>{lt(p.s8.title)}</h2>
            <LegalParagraphs paragraphs={p.s8.paragraphs} />

            <h2>{lt(p.s9.title)}</h2>
            <p>{lt(p.s9.intro)}</p>
            <LegalBullets items={p.s9.bullets} />
            <p>{lt(p.s9.requestIntro)}</p>
            <PrivacyEmailLink />
            <p>{lt(p.s9.verifyNote)}</p>
            <p>{lt(p.s9.candidateNote)}</p>

            <h2>{lt(p.s10.title)}</h2>
            <p>{lt(p.s10.intro)}</p>
            <LegalBullets items={p.s10.bullets} />
            <p>{lt(p.s10.foot)}</p>

            <h2>{lt(p.s11.title)}</h2>
            <LegalParagraphs paragraphs={p.s11.paragraphs} />

            <h2>{lt(p.s12.title)}</h2>
            <LegalParagraphs paragraphs={p.s12.paragraphs} />
            {p.s12.contactLine ? (
                <p>
                    {lt(p.s12.contactLine)}{' '}
                    <a href="mailto:team@evaalo.com">team@evaalo.com</a>
                </p>
            ) : null}

            <h2>{lt(p.s13.title)}</h2>
            <LegalParagraphs paragraphs={p.s13.paragraphs} />

            <h2>{lt(p.s14.title)}</h2>
            <LegalParagraphs paragraphs={p.s14.paragraphs} />

            <h2>{lt(p.contact.title)}</h2>
            <div className="legal-contact-card">
                <p className="legal-contact-card__intro">{lt(p.contact.intro)}</p>
                {p.contact.company ? (
                    <p className="legal-contact-card__company">
                        <strong>{lt(p.contact.company)}</strong>
                    </p>
                ) : null}
                <PrivacyEmailLink />
            </div>
        </>
    );

    return (
        <LegalPageShell title={t('privacy')} variant="features">
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
