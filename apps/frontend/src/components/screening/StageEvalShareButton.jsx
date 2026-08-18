import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    buildMailtoShareLink,
    buildWhatsAppShareLink,
} from '../../hooks/useHeadHunterContact.js';
import InterviewLinkResetButton from './InterviewLinkResetButton.jsx';

const CAN_NATIVE_SHARE = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * @param {DOMRect} rect
 */
function popoverStyleFromAnchor(rect) {
    const gap = 8;
    const width = Math.min(280, window.innerWidth - 16);
    let top = rect.bottom + gap;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + 220 > window.innerHeight) {
        top = Math.max(8, rect.top - gap - 220);
    }
    return { top, left, width };
}

/**
 * زر مشاركة لجدول التقييم: بريد → واتساب → مشاركة أصلية (بلا تكلفة Unipile، بلا حركة على الزر).
 *
 * @param {object} props
 * @param {object} props.candidate
 * @param {(candidate: object) => { shareText: string; interviewLink?: string; phone: string; email: string; name: string; emailSubject: string }} props.getShareData
 * @param {(key: string) => string} props.t
 * @param {string} props.shareTitle
 * @param {{ stage: 'voice' | 'video'; consumedAt?: string | null; onReset?: () => void } | null} [props.interviewLinkReset]
 */
export default function StageEvalShareButton({
    candidate,
    getShareData,
    t,
    shareTitle,
    interviewLinkReset = null,
}) {
    const anchorRef = useRef(null);
    const popoverRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [popoverStyle, setPopoverStyle] = useState(null);

    const closePopover = useCallback(() => {
        setOpen(false);
    }, []);

    const updatePopoverPosition = useCallback(() => {
        const el = anchorRef.current;
        if (!el) return;
        setPopoverStyle(popoverStyleFromAnchor(el.getBoundingClientRect()));
    }, []);

    useEffect(() => {
        if (!open) return;
        updatePopoverPosition();
        const onScrollOrResize = () => updatePopoverPosition();
        window.addEventListener('resize', onScrollOrResize);
        window.addEventListener('scroll', onScrollOrResize, true);
        return () => {
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('scroll', onScrollOrResize, true);
        };
    }, [open, updatePopoverPosition]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            const target = e.target;
            if (!(target instanceof Node)) return;
            if (anchorRef.current?.contains(target)) return;
            if (popoverRef.current?.contains(target)) return;
            closePopover();
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open, closePopover]);

    const stopBubble = (e) => e.stopPropagation();

    const togglePopover = (e) => {
        stopBubble(e);
        setOpen((v) => !v);
    };

    const data = open ? getShareData(candidate) : null;
    const phone = data?.phone || '';
    const email = data?.email || '';
    const canShareWhatsApp = Boolean(phone);
    const canShareEmail = Boolean(email);

    const openEmail = (e) => {
        stopBubble(e);
        if (!data) return;
        window.location.href = buildMailtoShareLink(email, data.emailSubject, data.shareText);
    };

    const openWhatsApp = (e) => {
        stopBubble(e);
        if (!data) return;
        window.open(buildWhatsAppShareLink(phone, data.shareText), '_blank', 'noopener,noreferrer');
    };

    const openNative = async (e) => {
        stopBubble(e);
        if (!data || !CAN_NATIVE_SHARE) return;
        try {
            await navigator.share({
                title: data.emailSubject,
                text: data.shareText,
            });
        } catch {
            /* المستخدم ألغى المشاركة */
        }
    };

    const popover = open && popoverStyle && data ? (
        <div
            ref={popoverRef}
            className="headhunter-card__video-popover headhunter-card__video-popover--portal"
            role="dialog"
            aria-label={shareTitle}
            style={{ top: popoverStyle.top, left: popoverStyle.left, width: popoverStyle.width }}
            onMouseDown={stopBubble}
            onClick={stopBubble}
        >
            <p className="headhunter-card__video-popover-title">{shareTitle}</p>

            <p className="headhunter-card__video-popover-divider">{t('aiHeadHunterOrShareVia')}</p>
            <div className="headhunter-card__video-popover-channels">
                {canShareEmail ? (
                    <button
                        type="button"
                        className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--email"
                        onClick={openEmail}
                    >
                        {t('aiHeadHunterShareEmail')}
                    </button>
                ) : null}
                {canShareWhatsApp ? (
                    <button
                        type="button"
                        className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--wa"
                        onClick={openWhatsApp}
                    >
                        {t('aiHeadHunterShareWhatsApp')}
                    </button>
                ) : null}
                {CAN_NATIVE_SHARE ? (
                    <button
                        type="button"
                        className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--native"
                        onClick={openNative}
                    >
                        {t('aiHeadHunterShareMore')}
                    </button>
                ) : null}
            </div>

            {interviewLinkReset ? (
                <InterviewLinkResetButton
                    variant="menu"
                    candidate={candidate}
                    stage={interviewLinkReset.stage}
                    t={t}
                    consumedAt={interviewLinkReset.consumedAt}
                    onReset={() => {
                        interviewLinkReset.onReset?.();
                        closePopover();
                    }}
                />
            ) : null}
        </div>
    ) : null;

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                className="stage-eval-share-btn"
                onClick={togglePopover}
                onMouseDown={stopBubble}
                title={shareTitle}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
            {popover ? createPortal(popover, document.body) : null}
        </>
    );
}
