import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import './screening-notice-modal.css';

/**
 * مودال تأكيد داخل التطبيق — نفس أسلوب Reception Agent / Compare Top Candidates.
 * يُعرض عبر portal على document.body لتجنب قصّه داخل الحاويات.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onDismiss
 * @param {() => void} [props.onConfirm]
 * @param {string} props.title
 * @param {string} props.description
 * @param {string} [props.cancelLabel]
 * @param {string} [props.confirmLabel]
 * @param {boolean} [props.confirming]
 * @param {'primary' | 'success'} [props.confirmVariant]
 * @param {'warning' | 'lock' | 'none'} [props.icon]
 */
export default function ScreeningConfirmModal({
    open,
    onDismiss,
    onConfirm,
    title,
    description,
    cancelLabel = 'Cancel',
    confirmLabel = 'Confirm',
    confirming = false,
    confirmVariant = 'primary',
    icon = 'warning',
}) {
    const { currentLang } = useLanguage();
    const isRtl = currentLang !== 'en';

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape' && !confirming) onDismiss();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onDismiss, confirming]);

    if (!open) return null;

    const confirmClass =
        'screening-notice-modal__btn ' +
        (confirmVariant === 'success'
            ? 'screening-notice-modal__btn--success'
            : 'screening-notice-modal__btn--primary');

    return createPortal(
        <div
            className="screening-notice-modal"
            dir={isRtl ? 'rtl' : 'ltr'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="screening-confirm-modal-title"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !confirming) onDismiss();
            }}
        >
            <div className="screening-notice-modal__ambient" aria-hidden>
                <span className="screening-notice-modal__orb screening-notice-modal__orb--a" />
                <span className="screening-notice-modal__orb screening-notice-modal__orb--b" />
            </div>

            <div className="screening-notice-modal__card">
                <div className="screening-notice-modal__card-header">
                    <h2 id="screening-confirm-modal-title" className="screening-notice-modal__title">
                        {title}
                    </h2>
                </div>

                <div className="screening-notice-modal__card-body">
                    {icon !== 'none' ? (
                        <div
                            className={
                                'screening-notice-modal__icon' +
                                (icon === 'lock' ? ' screening-notice-modal__icon--lock' : '')
                            }
                            aria-hidden
                        >
                            {icon === 'lock' ? (
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M7 11V7a5 5 0 0110 0v4M5 11h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            ) : (
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                        </div>
                    ) : null}
                    <p className="screening-notice-modal__desc">{description}</p>
                    <div className="screening-notice-modal__actions screening-notice-modal__actions--dual">
                        <button
                            type="button"
                            className="screening-notice-modal__btn screening-notice-modal__btn--secondary"
                            onClick={onDismiss}
                            disabled={confirming}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            className={confirmClass}
                            onClick={onConfirm}
                            disabled={confirming}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
