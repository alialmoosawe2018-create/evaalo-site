import React from 'react';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';

/**
 * @typedef {import('../../utils/headHunterContactChannels.js').HeadHunterContactChannels} HeadHunterContactChannels
 */

function IconPhone({ className }) {
    return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V21c0 .55-.45 1-1 1C9.61 22 2 14.39 2 5c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
            />
        </svg>
    );
}

function IconEnvelope({ className }) {
    return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
            />
        </svg>
    );
}

function IconLinkedIn({ className }) {
    return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path
                fill="currentColor"
                d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
            />
        </svg>
    );
}

/**
 * صف أزرار LinkedIn / بريد / هاتف — نفس الترتيب والأنماط على البطاقة واللوحة.
 *
 * @param {object} props
 * @param {HeadHunterContactChannels} props.contact
 * @param {(key: string) => string} props.t
 * @param {string} [props.rowClassName]
 * @param {(e: React.MouseEvent) => void} [props.onActionClick]
 */
export default function HeadHunterContactActions({ contact, t, rowClassName, onActionClick }) {
    const stop = onActionClick ?? ((e) => e.stopPropagation());
    const iconCls = 'headhunter-card__contact-icon-svg';

    return (
        <div className={rowClassName ?? 'headhunter-card__contact-row'}>
            {contact.linkedinHref ? (
                <a
                    className="headhunter-card__contact-btn"
                    href={contact.linkedinHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={contact.linkedinHref}
                    aria-label={t('aiHeadHunterCardLinkedInAria')}
                    onClick={stop}
                >
                    <IconLinkedIn className={iconCls} />
                </a>
            ) : (
                <span
                    className="headhunter-card__contact-btn headhunter-card__contact-btn--disabled"
                    aria-disabled="true"
                    aria-label={t('aiHeadHunterCardLinkedInUnavailable')}
                    title={t('aiHeadHunterCardLinkedInUnavailable')}
                    onClick={stop}
                >
                    <IconLinkedIn className={iconCls} />
                </span>
            )}
            {contact.mailtoHref ? (
                <a
                    className="headhunter-card__contact-btn"
                    href={contact.mailtoHref}
                    title={contact.email}
                    aria-label={fillI18nTemplate(t('aiHeadHunterCardEmailAria'), {
                        value: contact.email,
                    })}
                    onClick={stop}
                >
                    <IconEnvelope className={iconCls} />
                </a>
            ) : (
                <span
                    className="headhunter-card__contact-btn headhunter-card__contact-btn--disabled"
                    aria-disabled="true"
                    aria-label={t('aiHeadHunterCardEmailUnavailable')}
                    title={t('aiHeadHunterCardEmailUnavailable')}
                    onClick={stop}
                >
                    <IconEnvelope className={iconCls} />
                </span>
            )}
            {contact.telHref ? (
                <a
                    className="headhunter-card__contact-btn"
                    href={contact.telHref}
                    title={contact.phone}
                    aria-label={fillI18nTemplate(t('aiHeadHunterCardPhoneAria'), {
                        value: contact.phone,
                    })}
                    onClick={stop}
                >
                    <IconPhone className={iconCls} />
                </a>
            ) : (
                <span
                    className="headhunter-card__contact-btn headhunter-card__contact-btn--disabled"
                    aria-disabled="true"
                    aria-label={t('aiHeadHunterCardPhoneUnavailable')}
                    title={t('aiHeadHunterCardPhoneUnavailable')}
                    onClick={stop}
                >
                    <IconPhone className={iconCls} />
                </span>
            )}
        </div>
    );
}
