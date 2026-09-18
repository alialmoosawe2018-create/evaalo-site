import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    buildMailtoShareLink,
    buildPublicVideoScreeningUrl,
    buildShareInviteText,
    buildWhatsAppShareLink,
    createHeadHunterSourcingContext,
    getHeadHunterSendChannels,
    useHeadHunterContactSend,
} from '../../hooks/useHeadHunterContact.js';
import { headHunterInviteRole } from '../../utils/headHunterInviteRole.js';

const CAN_NATIVE_SHARE = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function IconShareLink({ className }) {
    return (
        <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
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
    );
}

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
 * زر مشاركة / إرسال رابط مقابلة فيديو على بطاقة الهيد هانتر.
 */
/**
 * ⚠️ `shareCampaign` بلا أقواس اختيارية وبلا قيمة افتراضية، عن قصد.
 *
 * التوقيع النصّي للعطب الذي أُصلح كان `@param {string} [props.campaignId]` —
 * prop اختياري يصير `undefined` بصمت فيخرج الرابط ناقصاً. كاشف المصدر يرفض
 * إعادته إلى الاختيارية.
 *
 * @param {object} props
 * @param {{campaignId: string, title: string}} props.shareCampaign `null` قبل الاختيار
 * @param {() => void} props.onChooseShareCampaign
 */
export default function HeadHunterCardVideoInvite({
    candidate,
    contactStatus,
    shareCampaign,
    onChooseShareCampaign,
    searchContext,
    t,
    onActionClick,
}) {
    const anchorRef = useRef(null);
    const popoverRef = useRef(null);
    const hhPromiseRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [channel, setChannel] = useState(null);
    const [message, setMessage] = useState('');
    const [localFeedback, setLocalFeedback] = useState(null);
    const [popoverStyle, setPopoverStyle] = useState(null);
    const [hhId, setHhId] = useState('');

    const { phone, linkedinUrl, canWhatsApp, canLinkedIn } = useMemo(
        () => getHeadHunterSendChannels(contactStatus, candidate),
        [contactStatus, candidate],
    );

    const email = typeof candidate?.email === 'string' ? candidate.email.trim() : '';

    // قنوات الإرسال الآلي عبر Unipile (تظهر فقط عند ربط التكامل فعليًا).
    const canSend = canWhatsApp || canLinkedIn;

    // مشاركة مجانية بلا تكلفة: واتساب (wa.me) عند توفّر رقم وعدم ربط الإرسال الآلي،
    // البريد (mailto) عند توفّر بريد، والمشاركة الأصلية على الأجهزة الداعمة.
    const canShareWhatsApp = Boolean(phone) && !canWhatsApp;
    const canShareEmail = Boolean(email);
    const hasFreeShare = canShareWhatsApp || canShareEmail || CAN_NATIVE_SHARE;
    // الوظيفة في الرابط هي دور حملة البحث وحده — لا وظيفة المرشّح الحالية.
    //
    // ⚠️ كانت `headHunterCandidatePosition(candidate) || campaignPosition`، و‍تلك
    // الدالة تُرجع `current_title || headline`: أي أنّ الوظيفة التي يشغلها المرشّح
    // **الآن** كانت تسبق الدور الذي يوظّف عليه صاحب العمل. فموظّفٌ يبحث عن
    // «HR Generalist» ويشارك مرشّحاً عنوانه «Sales Manager» كان يولّد رابطاً
    // يقول `position=Sales Manager` — وهو ما يراه المرشّح على الاستمارة، وما
    // يُسجَّل بوصفه ما «صرّح» به وهو لم يصرّح بشيء.
    //
    // الخادم يصحّح هوية المقابلة بطبقتين قائمتين (`reconcileIntakePosition` عند
    // الإدخال و`applyApplicationJobContext` عند القراءة)، وسجلّ الإنتاج يُظهر
    // `[AGENT JOB] … → match` في كل الجلسات — فالمقابلة لم تكن تُطرح على الدور
    // الخاطئ. لكنّ كلتا الطبقتين تحتاج دوراً للحملة تصحّح إليه: **حملة بلا دور
    // لا مرجع لها**، فتمرّ وظيفة المرشّح كما هي. الرابط لا يجوز أن يكون مصدر
    // هذه الحقيقة أصلاً.
    //
    // وغياب الدور يعني ألّا يُرسَل `position` إطلاقاً، لا أن يُملأ بتخمين.
    // دور الحملة نفسها — لا وظيفة المرشّح الحالية، ولا عنوان بحث الهيد هانتر.
    // (الخادم يتجاهل هذه القيمة عند توليد السياق ويقرأ الحملة بنفسه؛ هذه للعرض
    // على الاستمارة، فتبقى متّسقة مع ما سيُسجَّل.)
    const campaignId = shareCampaign?.campaignId || '';
    /*
     * 🔴 لغة المقابلة من **الوظيفة**، لا من لغة واجهة الموظّف.
     *
     * كان الرابط يحمل `currentLang`، فموظّفٌ يتصفّح بالإنجليزية يُرسل مقابلةً
     * إنجليزية — قِيس 2026-09-18: `session.language="en"` على مخطّطةٍ مرتكزاتها
     * عربية، فترجمها الوكيل دوراً بدور. ولا شيء يُترجَم إليه أصلاً: ٥٤ من ٥٤
     * مخطّطة في الإنتاج عربية.
     *
     * وحملةٌ لم تُقفل مخطّطتها بعد لا تُبلغ لغة، فيُحذف المُعامل من الرابط بدل
     * اختراع واحدة — والخادم والوكيل يملكان احتياطهما.
     */
    const shareLanguage = shareCampaign?.language || undefined;
    const position = headHunterInviteRole(shareCampaign?.title);

    // ينشئ لقطة سياق المصدر مرة واحدة (يبدأ عند فتح الـ popover) ويعيد المعرّف.
    const ensureSourcingContext = useCallback(() => {
        if (hhId) return Promise.resolve(hhId);
        if (!hhPromiseRef.current) {
            hhPromiseRef.current = createHeadHunterSourcingContext({
                candidate,
                searchContext,
                campaignId,
                position,
            })
                .then((id) => {
                    if (id) setHhId(id);
                    return id;
                })
                .catch(() => '');
        }
        return hhPromiseRef.current;
    }, [hhId, candidate, searchContext, campaignId, position]);

    const { send, sending, feedback, resetFeedback } = useHeadHunterContactSend({
        t,
        interviewType: 'video',
    });

    const displayFeedback = localFeedback || feedback;

    const closePopover = useCallback(() => {
        setOpen(false);
        setChannel(null);
        resetFeedback();
        setLocalFeedback(null);
    }, [resetFeedback]);

    const updatePopoverPosition = useCallback(() => {
        const el = anchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setPopoverStyle(popoverStyleFromAnchor(rect));
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

    const stopBubble = (e) => {
        e.stopPropagation();
        onActionClick?.(e);
    };

    const togglePopover = (e) => {
        stopBubble(e);
        if (open) {
            closePopover();
            return;
        }
        resetFeedback();
        setLocalFeedback(null);
        setMessage('');
        setChannel(null);
        setOpen(true);
        ensureSourcingContext();
    };

    const pickChannel = (ch) => {
        resetFeedback();
        setLocalFeedback(null);
        setChannel(ch);
        setMessage('');
    };

    const handleCopyLink = async (e) => {
        stopBubble(e);
        try {
            const id = await ensureSourcingContext();
            const url = buildPublicVideoScreeningUrl({
                campaignId,
                position,
                headHunterContextId: id,
                language: shareLanguage,
            });
            await navigator.clipboard.writeText(url);
            setLocalFeedback({ ok: true, text: t('aiHeadHunterLinkCopied') });
        } catch {
            // يشمل رفض البانِي رابطاً بلا حملة، ورفض الحافظة.
            setLocalFeedback({ ok: false, text: t('aiHeadHunterLinkCopyFailed') });
        }
    };

    const openFreeShare = async (kind) => {
        // ⚠️ كانت بلا catch: رمْيُ البانِي كان سيظهر كـunhandled rejection وحدها.
        let id;
        let url;
        try {
            id = await ensureSourcingContext();
            url = buildPublicVideoScreeningUrl({
                campaignId,
                position,
                headHunterContextId: id,
                language: shareLanguage,
            });
        } catch {
            setLocalFeedback({ ok: false, text: t('aiHeadHunterShareNeedsCampaign') });
            return;
        }
        if (kind === 'whatsapp') {
            const text = buildShareInviteText({ t, candidate, url });
            window.open(buildWhatsAppShareLink(phone, text), '_blank', 'noopener,noreferrer');
        } else if (kind === 'email') {
            const text = buildShareInviteText({ t, candidate, url });
            window.location.href = buildMailtoShareLink(email, t('aiHeadHunterEmailSubject'), text);
        } else if (kind === 'native' && CAN_NATIVE_SHARE) {
            const text = buildShareInviteText({ t, candidate, url, includeLink: false });
            try {
                await navigator.share({ title: t('aiHeadHunterVideoInviteTitle'), text, url });
            } catch {
                /* المستخدم ألغى المشاركة */
            }
        }
    };

    const handleSend = async () => {
        if (!channel) return;
        const recipient = channel === 'whatsapp' ? phone : linkedinUrl;
        const id = await ensureSourcingContext();
        const ok = await send({
            channel,
            recipient,
            message,
            campaignId,
            position,
            headHunterContextId: id,
            sendInterviewLink: true,
            language: shareLanguage,
        });
        if (ok) {
            setTimeout(closePopover, 1200);
        }
    };

    const popover = open && popoverStyle ? (
        <div
            ref={popoverRef}
            className="headhunter-card__video-popover headhunter-card__video-popover--portal"
            role="dialog"
            aria-label={t('aiHeadHunterVideoInviteTitle')}
            style={{
                top: popoverStyle.top,
                left: popoverStyle.left,
                width: popoverStyle.width,
            }}
            onMouseDown={stopBubble}
            onClick={stopBubble}
        >
            <p className="headhunter-card__video-popover-title">{t('aiHeadHunterVideoInviteTitle')}</p>

            {/*
              * بلا حملة: زرّ الاختيار **وحده**، وكل أزرار النسخ/المشاركة/الإرسال
              * غائبة لا معطّلة. زرٌّ معطّل يقول «لاحقاً»؛ والحقيقة أنّه لا يوجد
              * رابطٌ صالح يمكن إنتاجه قبل اختيار الحملة.
              */}
            {!shareCampaign ? (
                <>
                    <p className="headhunter-card__video-popover-note">
                        {t('aiHeadHunterShareNeedsCampaign')}
                    </p>
                    <button
                        type="button"
                        className="headhunter-card__video-popover-copy"
                        onClick={(e) => {
                            stopBubble(e);
                            closePopover();
                            onChooseShareCampaign?.();
                        }}
                    >
                        {t('aiHeadHunterShareCampaignChoose')}
                    </button>
                </>
            ) : (
            <>
            {hasFreeShare ? (
                <>
                    <p className="headhunter-card__video-popover-divider">{t('aiHeadHunterOrShareVia')}</p>
                    <div className="headhunter-card__video-popover-channels">
                        {canShareEmail ? (
                            <button
                                type="button"
                                className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--email"
                                onClick={() => openFreeShare('email')}
                            >
                                {t('aiHeadHunterShareEmail')}
                            </button>
                        ) : null}
                        {canShareWhatsApp ? (
                            <button
                                type="button"
                                className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--wa"
                                onClick={() => openFreeShare('whatsapp')}
                            >
                                {t('aiHeadHunterShareWhatsApp')}
                            </button>
                        ) : null}
                        {CAN_NATIVE_SHARE ? (
                            <button
                                type="button"
                                className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--native"
                                onClick={() => openFreeShare('native')}
                            >
                                {t('aiHeadHunterShareMore')}
                            </button>
                        ) : null}
                    </div>
                </>
            ) : null}

            <button type="button" className="headhunter-card__video-popover-copy" onClick={handleCopyLink}>
                {t('aiHeadHunterCopyVideoLink')}
            </button>

            {canSend ? (
                <>
                    <p className="headhunter-card__video-popover-divider">{t('aiHeadHunterOrSendVia')}</p>
                    {!channel ? (
                        <div className="headhunter-card__video-popover-channels">
                            {canWhatsApp ? (
                                <button
                                    type="button"
                                    className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--wa"
                                    onClick={() => pickChannel('whatsapp')}
                                >
                                    {t('aiHeadHunterSendWhatsApp')}
                                </button>
                            ) : null}
                            {canLinkedIn ? (
                                <button
                                    type="button"
                                    className="headhunter-card__video-popover-channel headhunter-card__video-popover-channel--li"
                                    onClick={() => pickChannel('linkedin')}
                                >
                                    {t('aiHeadHunterSendLinkedIn')}
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <>
                            <textarea
                                className="headhunter-card__video-popover-textarea"
                                rows={2}
                                value={message}
                                placeholder={t('aiHeadHunterMessagePlaceholder')}
                                onChange={(e) => setMessage(e.target.value)}
                            />
                            <div className="headhunter-card__video-popover-actions">
                                <button
                                    type="button"
                                    className="headhunter-card__video-popover-btn headhunter-card__video-popover-btn--ghost"
                                    onClick={() => {
                                        setChannel(null);
                                        resetFeedback();
                                        setLocalFeedback(null);
                                    }}
                                    disabled={sending}
                                >
                                    {t('aiHeadHunterCancel')}
                                </button>
                                <button
                                    type="button"
                                    className="headhunter-card__video-popover-btn headhunter-card__video-popover-btn--primary"
                                    onClick={handleSend}
                                    disabled={sending}
                                >
                                    {sending ? t('aiHeadHunterSending') : t('aiHeadHunterSend')}
                                </button>
                            </div>
                        </>
                    )}
                </>
            ) : null}

            {!hasFreeShare && !canSend ? (
                <p className="headhunter-card__video-popover-hint">{t('aiHeadHunterVideoInviteHint')}</p>
            ) : null}
            </>
            )}

            {displayFeedback ? (
                <p
                    className={`headhunter-card__video-popover-feedback${
                        displayFeedback.ok ? '' : ' headhunter-card__video-popover-feedback--err'
                    }`}
                    role="status"
                >
                    {displayFeedback.text}
                </p>
            ) : null}
        </div>
    ) : null;

    return (
        <>
            <div className="headhunter-card__tail-segment headhunter-card__tail-segment--share headhunter-card__video-invite">
                <button
                    ref={anchorRef}
                    type="button"
                    className="headhunter-card__tail-video-btn"
                    title={t('aiHeadHunterSendVideoInvite')}
                    aria-label={t('aiHeadHunterSendVideoInviteAria')}
                    aria-expanded={open}
                    aria-haspopup="dialog"
                    onMouseDown={stopBubble}
                    onClick={togglePopover}
                >
                    <IconShareLink className="headhunter-card__tail-video-btn-icon" />
                </button>
            </div>
            {popover ? createPortal(popover, document.body) : null}
        </>
    );
}
