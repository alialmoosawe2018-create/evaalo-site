import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import {
    getHeadHunterSendChannels,
    headHunterCandidatePosition,
    useHeadHunterContactSend,
} from '../../hooks/useHeadHunterContact.js';

/**
 * أزرار التواصل الفعلي (WhatsApp / LinkedIn) عبر التكاملات المربوطة.
 *
 * @param {object} props
 * @param {import('../../utils/headHunterNormalize.js').HeadHunterCandidate} props.candidate
 * @param {unknown} [props.contactStatus]
 * @param {(key: string) => string} props.t
 * @param {'form' | 'video'} [props.interviewType]
 */
export default function HeadHunterSendActions({
    candidate,
    contactStatus: contactStatusProp,
    t,
    interviewType = 'form',
}) {
    const [composer, setComposer] = useState(null);
    const [message, setMessage] = useState('');
    const [includeLink, setIncludeLink] = useState(true);
    const { currentLang } = useLanguage();

    const { phone, linkedinUrl, canWhatsApp, canLinkedIn } = useMemo(
        () => getHeadHunterSendChannels(contactStatusProp, candidate),
        [contactStatusProp, candidate],
    );

    const position = headHunterCandidatePosition(candidate);
    const { send, sending, feedback, resetFeedback } = useHeadHunterContactSend({ t, interviewType });

    if (!canWhatsApp && !canLinkedIn) return null;

    const openComposer = (channel) => {
        setComposer(channel);
        setMessage('');
        setIncludeLink(true);
        resetFeedback();
    };

    const handleSend = async () => {
        if (!composer) return;
        const recipient = composer === 'whatsapp' ? phone : linkedinUrl;
        const ok = await send({
            channel: composer,
            recipient,
            message,
            position: interviewType === 'video' ? position : undefined,
            sendInterviewLink: includeLink,
            language: currentLang,
        });
        if (ok) setComposer(null);
    };

    return (
        <div className="headhunter-send">
            <div className="headhunter-send__buttons">
                {canWhatsApp ? (
                    <button
                        type="button"
                        className="headhunter-send__btn headhunter-send__btn--wa"
                        onClick={() => openComposer('whatsapp')}
                    >
                        {t('aiHeadHunterSendWhatsApp')}
                    </button>
                ) : null}
                {canLinkedIn ? (
                    <button
                        type="button"
                        className="headhunter-send__btn headhunter-send__btn--li"
                        onClick={() => openComposer('linkedin')}
                    >
                        {t('aiHeadHunterSendLinkedIn')}
                    </button>
                ) : null}
            </div>

            {feedback ? (
                <p className={`headhunter-send__feedback${feedback.ok ? '' : ' headhunter-send__feedback--err'}`}>
                    {feedback.text}
                </p>
            ) : null}

            {composer ? (
                <div className="headhunter-send__composer">
                    <textarea
                        className="headhunter-send__textarea"
                        rows={3}
                        value={message}
                        placeholder={t('aiHeadHunterMessagePlaceholder')}
                        onChange={(e) => setMessage(e.target.value)}
                    />
                    <label className="headhunter-send__check">
                        <input
                            type="checkbox"
                            checked={includeLink}
                            onChange={(e) => setIncludeLink(e.target.checked)}
                        />
                        {interviewType === 'video'
                            ? t('aiHeadHunterIncludeVideoLink')
                            : t('aiHeadHunterIncludeLink')}
                    </label>
                    <div className="headhunter-send__composer-actions">
                        <button
                            type="button"
                            className="headhunter-send__btn headhunter-send__btn--ghost"
                            onClick={() => setComposer(null)}
                            disabled={sending}
                        >
                            {t('aiHeadHunterCancel')}
                        </button>
                        <button
                            type="button"
                            className="headhunter-send__btn headhunter-send__btn--primary"
                            onClick={handleSend}
                            disabled={sending || (!message.trim() && !includeLink)}
                        >
                            {sending ? t('aiHeadHunterSending') : t('aiHeadHunterSend')}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
