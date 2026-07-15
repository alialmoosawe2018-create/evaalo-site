import React from 'react';
import { countRevealPieces } from '../../utils/headHunterContactReveal.js';
import HeadHunterContactActions from './HeadHunterContactActions.jsx';

/** أيقونة قفل احترافية — متناسقة مع زاوية كشف بيانات الاتصال. */
export function RevealContactLockIcon({ className }) {
    return (
        <svg
            className={className}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            focusable="false"
        >
            <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2.5"
                fill="currentColor"
                fillOpacity="0.12"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
            />
            <path
                d="M8.5 11V8.75a3.5 3.5 0 0 1 7 0V11"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
            />
            <circle cx="12" cy="15.25" r="1.35" fill="currentColor" />
            <path
                d="M12 16.5v1.25"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

/** @deprecated استخدم RevealContactLockIcon */
export const Lock3DIcon = RevealContactLockIcon;

/**
 * بوابة كشف بيانات الاتصال.
 *  - لا توجد بيانات أو مكشوفة → أزرار الاتصال الفعّالة كما هي.
 *  - بيانات موجودة ولم تُكشف → الأيقونات تظهر كما هي لكن مقفولة (لا تُفتح)،
 *    والكشف يتم عبر زر القفل (في البطاقة: ركن مثلث؛ في اللوحة: زر داخلي).
 *
 * @param {object} props
 * @param {import('../../utils/headHunterContactChannels.js').HeadHunterContactChannels} props.contact
 * @param {boolean} props.revealed
 * @param {boolean} [props.pending]
 * @param {string} [props.error]
 * @param {() => void} props.onReveal
 * @param {(e: React.MouseEvent) => void} [props.onActionClick]
 * @param {boolean} [props.hideLock] عند true لا تُرسم بوابة القفل الداخلية (البطاقة ترسم ركنها).
 * @param {(key: string) => string} props.t
 */
export default function HeadHunterContactGate({
    contact,
    revealed,
    pending = false,
    error = '',
    onReveal,
    onActionClick,
    hideLock = false,
    t,
}) {
    const pieces = countRevealPieces(contact);
    const locked = pieces > 0 && !revealed;
    const stop = onActionClick ?? ((e) => e.stopPropagation());

    return (
        <div
            className={
                'headhunter-contact-gate' + (locked ? ' headhunter-contact-gate--locked' : '')
            }
        >
            <HeadHunterContactActions
                contact={contact}
                t={t}
                onActionClick={stop}
                rowClassName={
                    'headhunter-card__contact-row' +
                    (locked ? ' headhunter-card__contact-row--locked' : '')
                }
            />

            {locked && !hideLock ? (
                <button
                    type="button"
                    className="headhunter-reveal-lock headhunter-reveal-lock--inline"
                    onClick={(e) => {
                        stop(e);
                        if (!pending) onReveal();
                    }}
                    disabled={pending}
                    title={t('aiHeadHunterRevealHint')}
                    aria-label={t('aiHeadHunterRevealHint')}
                >
                    {pending ? (
                        <span className="headhunter-reveal-lock__spinner" aria-hidden />
                    ) : (
                        <RevealContactLockIcon className="headhunter-reveal-lock__icon" />
                    )}
                    <span className="headhunter-reveal-lock__text">{t('aiHeadHunterRevealShort')}</span>
                </button>
            ) : null}

            {error ? <span className="headhunter-contact-reveal__error">{error}</span> : null}
        </div>
    );
}
