import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import './screening-notice-modal.css';

/**
 * مودال تنبيه داخل التطبيق (نفس تصميم Reception Agent).
 *
 * @param {{
 *   open: boolean;
 *   onDismiss: () => void;
 *   t: (key: string) => string;
 *   title?: string;
 *   description?: string;
 *   titleKey?: string;
 *   descriptionKey?: string;
 *   okKey?: string;
 * }} props
 */
export default function ScreeningAiCompareNeedTwoNotice({
    open,
    onDismiss,
    t,
    title,
    description,
    titleKey = 'aiCompareTop_modalTitle',
    descriptionKey = 'aiCompareTop_needTwo',
    okKey = 'aiCompareTop_noticeOk',
}) {
    const { currentLang } = useLanguage();
    const isRtl = currentLang !== 'en';

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') onDismiss();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onDismiss]);

    if (!open) return null;

    return createPortal(
        <div
            className="screening-notice-modal"
            dir={isRtl ? 'rtl' : 'ltr'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="screening-notice-modal-title"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onDismiss();
            }}
        >
            <div className="screening-notice-modal__ambient" aria-hidden>
                <span className="screening-notice-modal__orb screening-notice-modal__orb--a" />
                <span className="screening-notice-modal__orb screening-notice-modal__orb--b" />
            </div>

            <div className="screening-notice-modal__card">
                <div className="screening-notice-modal__card-header">
                    <h2 id="screening-notice-modal-title" className="screening-notice-modal__title">
                        {title ?? t(titleKey)}
                    </h2>
                </div>

                <div className="screening-notice-modal__card-body">
                    <div className="screening-notice-modal__icon" aria-hidden>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                            <path
                                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                    <p className="screening-notice-modal__desc">{description ?? t(descriptionKey)}</p>
                    <div className="screening-notice-modal__actions">
                        <button
                            type="button"
                            className="screening-notice-modal__btn screening-notice-modal__btn--primary"
                            onClick={onDismiss}
                        >
                            {t(okKey)}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
