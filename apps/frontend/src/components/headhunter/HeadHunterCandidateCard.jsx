import React, { useEffect, useMemo, useState } from 'react';
import { stripHtmlForDisplay } from '../../utils/headHunterNormalize.js';
import { buildHeadHunterContactChannels } from '../../utils/headHunterContactChannels.js';
import { countRevealPieces } from '../../utils/headHunterContactReveal.js';
import HeadHunterCandidateMainBrief from './HeadHunterCandidateMainBrief.jsx';
import HeadHunterContactGate, { RevealContactLockIcon } from './HeadHunterContactGate.jsx';
import HeadHunterCardVideoInvite from './HeadHunterCardVideoInvite.jsx';

/**
 * @typedef {import('../../utils/headHunterNormalize.js').HeadHunterCandidate} HeadHunterCandidate
 */

/** عتبة شارة TOP على الشريط الأخضر (مطابقة قوية). */
const TOP_MATCH_THRESHOLD = 60;

/** نبذة العمود الأوسط: ملخص/ذكاء فقط — بدون إدراج headline لأنه معروض في العمود الرئيسي. */
function cardAboutText(c) {
    const sum = stripHtmlForDisplay(c.summary);
    const ai = stripHtmlForDisplay(c.ai_summary);
    if (sum) return sum;
    if (ai) return ai;
    return '';
}

/**
 * @param {object} props
 * @param {HeadHunterCandidate} props.candidate
 * @param {boolean} props.selected
 * @param {(c: HeadHunterCandidate) => void} props.onSelect
 * @param {unknown} [props.contactStatus]
 * @param {string} [props.campaignId]
 * @param {string} [props.campaignPosition]
 * @param {object} [props.searchContext]
 * @param {(key: string) => string} props.t
 */
export default function HeadHunterCandidateCard({
    candidate,
    selected,
    onSelect,
    contactStatus,
    campaignId,
    campaignPosition,
    searchContext,
    contactRevealed = false,
    contactRevealPending = false,
    contactRevealError = '',
    onRevealContact,
    t,
}) {
    const aboutText = cardAboutText(candidate);
    const hasAbout = Boolean(aboutText);

    const contact = useMemo(
        () => buildHeadHunterContactChannels(candidate),
        [candidate.phone, candidate.email, candidate.linkedin_url],
    );

    const revealPieces = countRevealPieces(contact);
    const contactLocked = revealPieces > 0 && !contactRevealed;

    const nameId = `hh-card-${String(candidate.id).replace(/[^\w.-]/g, '_')}`;

    const matchPct =
        candidate.match_score != null && Number.isFinite(candidate.match_score)
            ? Math.round(Math.min(100, Math.max(0, candidate.match_score)))
            : null;

    const hasAboutColumn = hasAbout || matchPct != null;
    const isTopMatch = matchPct != null && matchPct >= TOP_MATCH_THRESHOLD;

    const [photoBroken, setPhotoBroken] = useState(false);
    const [tailDecorSettled, setTailDecorSettled] = useState(() => {
        if (typeof window === 'undefined') return true;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });

    useEffect(() => {
        setPhotoBroken(false);
    }, [candidate.id, candidate.photo_url]);

    /** Wait for grid/compositor to settle before showing ribbon pseudo-elements (avoids green/yellow flash). */
    useEffect(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setTailDecorSettled(true);
            return undefined;
        }
        setTailDecorSettled(false);
        let cancelled = false;
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (!cancelled) setTailDecorSettled(true);
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, [candidate.id]);

    const showPhoto = Boolean(candidate.photo_url) && !photoBroken;

    /** إيقاف اختيار البطاقة عند النقر على رابط أو أيقونة غير فعّالة */
    /** @param {React.MouseEvent} e */
    const stopTailLinkBubble = (e) => {
        e.stopPropagation();
    };

    return (
        <article
            className={`headhunter-card ${selected ? 'headhunter-card--selected' : ''}`}
            data-candidate-id={candidate.id}
        >
            <div
                className={[
                    'headhunter-card__content-row',
                    !hasAboutColumn ? 'headhunter-card__content-row--no-about' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                <button
                    type="button"
                    className="headhunter-card__main headhunter-card__pane"
                    onClick={() => onSelect(candidate)}
                    aria-labelledby={nameId}
                >
                    <HeadHunterCandidateMainBrief
                        candidate={candidate}
                        t={t}
                        nameId={nameId}
                        showPhoto={showPhoto}
                        onPhotoError={() => setPhotoBroken(true)}
                        tenureTruncate={112}
                        showSkills={false}
                        variant="card"
                    />
                </button>
                {hasAboutColumn ? (
                    <aside className="headhunter-card__about headhunter-card__pane" aria-label={t('aiHeadHunterAbout')}>
                        {matchPct != null ? (
                            <div className="headhunter-card__about-match">
                                <div className="headhunter-card__match-bar" aria-hidden>
                                    <div
                                        className="headhunter-card__match-bar-fill"
                                        style={{ width: `${matchPct}%` }}
                                    />
                                </div>
                                <span className="headhunter-card__match">
                                    {t('aiHeadHunterMatchLabel')}: {matchPct}%
                                </span>
                            </div>
                        ) : null}
                        {hasAbout ? (
                            <>
                                <span className="headhunter-card__about-label">{t('aiHeadHunterAbout')}</span>
                                <p className="headhunter-card__about-text" dir="auto">
                                    {aboutText.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ')}
                                </p>
                            </>
                        ) : null}
                    </aside>
                ) : null}
                <div
                    className={[
                        'headhunter-card__tail headhunter-card__pane',
                        contactLocked ? 'headhunter-card__tail--contact-locked' : '',
                        isTopMatch ? 'headhunter-card__tail--top' : '',
                        tailDecorSettled ? 'headhunter-card__tail--decor-settled' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    role="group"
                    aria-label={t('aiHeadHunterCardContactInfo')}
                    tabIndex={-1}
                >
                    {isTopMatch ? (
                        <div className="headhunter-card__top-badge" aria-label={t('aiHeadHunterTopBadgeAria')}>
                            <span className="headhunter-card__top-badge-text">{t('aiHeadHunterTopBadge')}</span>
                        </div>
                    ) : null}
                    {contactLocked ? (
                        <button
                            type="button"
                            className="headhunter-reveal-lock headhunter-reveal-lock--corner"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!contactRevealPending) onRevealContact?.(candidate);
                            }}
                            onMouseDown={stopTailLinkBubble}
                            disabled={contactRevealPending}
                            title={t('aiHeadHunterRevealHint')}
                            aria-label={t('aiHeadHunterRevealHint')}
                        >
                            {contactRevealPending ? (
                                <span className="headhunter-reveal-lock__badge" aria-hidden>
                                    <span className="headhunter-reveal-lock__spinner" />
                                </span>
                            ) : (
                                <span className="headhunter-reveal-lock__badge" aria-hidden>
                                    <RevealContactLockIcon className="headhunter-reveal-lock__icon" />
                                </span>
                            )}
                        </button>
                    ) : null}

                    {candidate.last_activity_label ? (
                        <div className="headhunter-card__tail-meta">
                            <div className="headhunter-card__footer">
                                <span className="headhunter-card__activity">
                                    {candidate.last_activity_label}
                                </span>
                            </div>
                        </div>
                    ) : null}

                    <div
                        className="headhunter-card__tail-split"
                        onClick={stopTailLinkBubble}
                        onMouseDown={stopTailLinkBubble}
                    >
                        <div className="headhunter-card__tail-segment headhunter-card__tail-segment--contacts">
                            <HeadHunterContactGate
                                contact={contact}
                                revealed={contactRevealed}
                                pending={contactRevealPending}
                                error={contactRevealError}
                                onReveal={() => onRevealContact?.(candidate)}
                                onActionClick={stopTailLinkBubble}
                                hideLock
                                t={t}
                            />
                        </div>
                        <HeadHunterCardVideoInvite
                            candidate={candidate}
                            contactStatus={contactStatus}
                            campaignId={campaignId}
                            campaignPosition={campaignPosition}
                            searchContext={searchContext}
                            t={t}
                            onActionClick={stopTailLinkBubble}
                        />
                    </div>
                </div>
            </div>
        </article>
    );
}
