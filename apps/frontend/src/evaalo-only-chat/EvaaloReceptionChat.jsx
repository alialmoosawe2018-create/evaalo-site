import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import apiClient, { ApiError } from '../services/apiClient';
import './evaalo-only-chat.css';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function pickRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function normalizeMimeType(mimeType) {
    return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read_failed'));
        reader.readAsDataURL(file);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read_failed'));
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBase64(dataUrl) {
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Text-only marketing reception chat (opens from Demo page).
 * @param {{ open: boolean; onClose: () => void }} props
 */
export default function EvaaloReceptionChat({ open, onClose }) {
    const { t, currentLang } = useLanguage();
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [recording, setRecording] = useState(false);
    const [pendingAttachment, setPendingAttachment] = useState(null);
    const listRef = useRef(null);
    const imageInputRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioChunksRef = useRef([]);

    const apiLanguage = currentLang === 'en' ? 'en' : 'ar';

    const stopMediaStream = useCallback(() => {
        const stream = mediaStreamRef.current;
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
    }, []);

    const clearPendingAttachment = useCallback(() => {
        setPendingAttachment(null);
    }, []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) return;
        setMessages([{ role: 'assistant', content: t('marketingChatIntro') }]);
        setDraft('');
        setError(null);
        setPendingAttachment(null);
        setRecording(false);
        stopMediaStream();
    }, [open, t, currentLang, stopMediaStream]);

    useEffect(() => {
        return () => {
            stopMediaStream();
            if (mediaRecorderRef.current?.state === 'recording') {
                try {
                    mediaRecorderRef.current.stop();
                } catch {
                    /* ignore */
                }
            }
        };
    }, [stopMediaStream]);

    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, loading, pendingAttachment]);

    const handleImagePick = useCallback(
        async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (!IMAGE_MIMES.has(file.type)) {
                setError(t('marketingChatImageTypeError'));
                return;
            }
            if (file.size > MAX_IMAGE_BYTES) {
                setError(t('marketingChatImageTooLarge'));
                return;
            }
            try {
                const dataUrl = await fileToDataUrl(file);
                setPendingAttachment({
                    type: 'image',
                    mimeType: normalizeMimeType(file.type),
                    preview: dataUrl,
                    base64: dataUrlToBase64(dataUrl),
                });
                setError(null);
            } catch {
                setError(t('marketingChatError'));
            }
        },
        [t]
    );

    const stopRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
        }
        setRecording(false);
    }, []);

    const startRecording = useCallback(async () => {
        if (recording || loading) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            setError(t('marketingChatMicUnavailable'));
            return;
        }
        try {
            const mimeType = pickRecorderMimeType();
            if (!mimeType) {
                setError(t('marketingChatMicUnavailable'));
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            audioChunksRef.current = [];
            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (e) => {
                if (e.data?.size) audioChunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                stopMediaStream();
                const blob = new Blob(audioChunksRef.current, { type: mimeType });
                audioChunksRef.current = [];
                if (!blob.size) return;
                if (blob.size > MAX_AUDIO_BYTES) {
                    setError(t('marketingChatAudioTooLarge'));
                    return;
                }
                try {
                    const dataUrl = await blobToDataUrl(blob);
                    setPendingAttachment({
                        type: 'audio',
                        mimeType: normalizeMimeType(blob.type || mimeType),
                        preview: dataUrl,
                        base64: dataUrlToBase64(dataUrl),
                    });
                    setError(null);
                } catch {
                    setError(t('marketingChatError'));
                }
            };
            recorder.start();
            setRecording(true);
            setError(null);
        } catch {
            stopMediaStream();
            setError(t('marketingChatMicDenied'));
        }
    }, [loading, recording, stopMediaStream, t]);

    const handleSend = useCallback(async () => {
        const text = draft.trim();
        const attachment = pendingAttachment;
        if ((!text && !attachment) || loading) return;

        const userMsg = {
            role: 'user',
            content: text,
            ...(attachment?.type === 'image' ? { imagePreview: attachment.preview } : {}),
            ...(attachment?.type === 'audio' ? { audioPreview: attachment.preview } : {}),
        };
        const nextHistory = [...messages, userMsg];
        const apiMessages = nextHistory.map(({ role, content, imagePreview, audioPreview }) => ({
            role,
            content:
                content ||
                (imagePreview
                    ? t('marketingChatImageSentLabel')
                    : audioPreview
                      ? t('marketingChatVoiceSentLabel')
                      : ''),
        }));

        setMessages(nextHistory);
        setDraft('');
        setPendingAttachment(null);
        setError(null);
        setLoading(true);

        try {
            const payload = {
                messages: apiMessages,
                language: apiLanguage,
            };
            if (attachment) {
                payload.attachment = {
                    type: attachment.type,
                    mimeType: attachment.mimeType,
                    base64: attachment.base64,
                };
            }

            const data = await apiClient.post('/api/marketing-chat', payload);
            const reply = data?.reply;
            if (typeof reply !== 'string' || !reply.length) {
                throw new Error('empty_reply');
            }
            setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
        } catch (e) {
            const msg =
                e instanceof ApiError
                    ? e.message || t('marketingChatError')
                    : t('marketingChatError');
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [draft, loading, messages, pendingAttachment, apiLanguage, t]);

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const canSend = Boolean(draft.trim() || pendingAttachment) && !loading && !recording;

    if (!open || typeof document === 'undefined') return null;

    return createPortal(
        <>
            <div
                className="evaalo-only-chat__backdrop"
                role="presentation"
                aria-hidden={false}
                onClick={onClose}
            />
            <div
                className="evaalo-only-chat__panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="evaalo-marketing-chat-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="evaalo-only-chat__header">
                    <div className="evaalo-only-chat__header-slot" aria-hidden="true" />
                    <h2 id="evaalo-marketing-chat-title" className="evaalo-only-chat__title">
                        {t('marketingChatTitle')}
                    </h2>
                    <div className="evaalo-only-chat__header-slot evaalo-only-chat__header-slot--end">
                        <button
                            type="button"
                            className="evaalo-only-chat__nav-btn"
                            onClick={onClose}
                            aria-label={t('marketingChatClose')}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="evaalo-only-chat__messages" ref={listRef}>
                    {messages.map((m, i) => (
                        <div
                            key={`m-${i}-${m.content?.slice(0, 24)}`}
                            className={[
                                'evaalo-only-chat__bubble',
                                `evaalo-only-chat__bubble--${m.role}`,
                                m.audioPreview ? 'evaalo-only-chat__bubble--voice' : '',
                                m.imagePreview ? 'evaalo-only-chat__bubble--image' : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            {m.imagePreview ? (
                                <img
                                    className="evaalo-only-chat__bubble-image"
                                    src={m.imagePreview}
                                    alt=""
                                    aria-hidden
                                />
                            ) : null}
                            {m.audioPreview ? (
                                <audio className="evaalo-only-chat__bubble-audio" controls preload="metadata" src={m.audioPreview}>
                                    <track kind="captions" />
                                </audio>
                            ) : null}
                            {m.content ? <span className="evaalo-only-chat__bubble-text">{m.content}</span> : null}
                        </div>
                    ))}
                </div>

                {pendingAttachment ? (
                    <div className="evaalo-only-chat__pending">
                        {pendingAttachment.type === 'image' ? (
                            <img
                                className="evaalo-only-chat__pending-image"
                                src={pendingAttachment.preview}
                                alt=""
                                aria-hidden
                            />
                        ) : (
                            <audio className="evaalo-only-chat__pending-audio" controls preload="metadata" src={pendingAttachment.preview}>
                                <track kind="captions" />
                            </audio>
                        )}
                        <button
                            type="button"
                            className="evaalo-only-chat__pending-remove"
                            onClick={clearPendingAttachment}
                            aria-label={t('marketingChatRemoveAttachment')}
                        >
                            ×
                        </button>
                    </div>
                ) : null}

                {error ? <div className="evaalo-only-chat__error">{error}</div> : null}
                {loading ? <div className="evaalo-only-chat__typing">{t('marketingChatThinking')}</div> : null}

                <div className="evaalo-only-chat__toolbar">
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="evaalo-only-chat__file-input"
                        onChange={handleImagePick}
                        aria-hidden
                        tabIndex={-1}
                    />
                    <button
                        type="button"
                        className="evaalo-only-chat__tool-btn"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={loading || recording}
                        aria-label={t('marketingChatAttachImage')}
                        title={t('marketingChatAttachImage')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <circle cx="8.5" cy="10" r="1.75" />
                            <path d="M3 15l4.5-4 3.5 2.5 3-3.5L21 15" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className={`evaalo-only-chat__tool-btn${recording ? ' evaalo-only-chat__tool-btn--recording' : ''}`}
                        onClick={recording ? stopRecording : startRecording}
                        disabled={loading}
                        aria-label={recording ? t('marketingChatStopRecording') : t('marketingChatRecordVoice')}
                        title={recording ? t('marketingChatStopRecording') : t('marketingChatRecordVoice')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                            <rect x="9" y="3" width="6" height="12" rx="3" />
                            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="evaalo-only-chat__form">
                    <textarea
                        className="evaalo-only-chat__input"
                        rows={2}
                        placeholder={t('marketingChatPlaceholder')}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={loading || recording}
                        aria-label={t('marketingChatPlaceholder')}
                    />
                    <button
                        type="button"
                        className="evaalo-only-chat__send"
                        onClick={handleSend}
                        disabled={!canSend}
                    >
                        {t('marketingChatSend')}
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
}
