import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import { computeCompareTopCredits } from '../../utils/compareTopCreditCost.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * مودال إدخال إيميلات المستلمين قبل إطلاق "مقارنة أفضل المرشحين".
 *
 * @param {{
 *   open: boolean,
 *   submitting?: boolean,
 *   onClose: () => void,
 *   onSubmit: (emails: string[]) => void,
 *   compareCandidateCount?: number,
 * }} props
 */
export default function AiCompareTopEmailModal({
    open,
    submitting = false,
    onClose,
    onSubmit,
    compareCandidateCount = 0,
}) {
    const { t } = useLanguage();
    const [rows, setRows] = useState(['']);
    const [error, setError] = useState('');

    const validCount = useMemo(() => {
        const unique = [...new Set(rows.map((r) => (r || '').trim()).filter(Boolean))];
        return unique.filter((e) => EMAIL_RE.test(e)).length;
    }, [rows]);

    const cost = useMemo(
        () => computeCompareTopCredits(validCount, compareCandidateCount),
        [validCount, compareCandidateCount],
    );

    useEffect(() => {
        if (open) {
            setRows(['']);
            setError('');
        }
    }, [open]);

    if (!open) return null;

    const updateRow = (index, value) => {
        setRows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
        if (error) setError('');
    };

    const addRow = () => setRows((prev) => [...prev, '']);

    const removeRow = (index) =>
        setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

    const handleSubmit = () => {
        const emails = [...new Set(rows.map((r) => (r || '').trim()).filter(Boolean))];
        const valid = emails.filter((e) => EMAIL_RE.test(e));
        if (valid.length === 0) {
            setError(t('aiCompareTop_invalidEmail'));
            return;
        }
        onSubmit(valid);
    };

    return (
        <div
            className="ai-compare-modal-overlay ai-compare-top-email-overlay"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !submitting) onClose();
            }}
        >
            <div className="ai-compare-modal ai-compare-top-email-modal" onClick={(e) => e.stopPropagation()}>
                <div className="ai-compare-modal__header">
                    <div className="ai-compare-modal__header-side" aria-hidden="true" />
                    <h3 className="ai-compare-modal__title">{t('aiCompareTop_modalTitle')}</h3>
                    <div className="ai-compare-modal__header-side ai-compare-modal__header-side--end">
                        <button
                            type="button"
                            className="ai-compare-modal__close"
                            onClick={onClose}
                            disabled={submitting}
                            aria-label={t('aiCompareTop_cancel')}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path
                                    d="M18 6L6 18M6 6l12 12"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </button>
                    </div>
                </div>

                <p className="ai-compare-modal__desc">{t('aiCompareTop_modalDesc')}</p>

                <div className="ai-compare-modal__rows">
                    {rows.map((value, index) => (
                        <div className="ai-compare-modal__row" key={index}>
                            <input
                                type="email"
                                className="ai-compare-modal__input"
                                placeholder={t('aiCompareTop_emailPlaceholder')}
                                value={value}
                                onChange={(e) => updateRow(index, e.target.value)}
                                disabled={submitting}
                            />
                            {rows.length > 1 ? (
                                <button
                                    type="button"
                                    className="ai-compare-modal__remove"
                                    onClick={() => removeRow(index)}
                                    disabled={submitting}
                                    aria-label={t('aiCompareTop_removeEmail')}
                                >
                                    ×
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    className="ai-compare-modal__add"
                    onClick={addRow}
                    disabled={submitting}
                >
                    + {t('aiCompareTop_addEmail')}
                </button>

                <div className="ai-compare-modal__cost-hint">
                    {fillI18nTemplate(t('aiCompareTop_costHint'), {
                        emailCredits: cost.emailCredits,
                        emailCount: cost.emailCount,
                        candidateCredits: cost.candidateCredits,
                        candidateCount: cost.candidateCount,
                        n: cost.totalCredits,
                    })}
                </div>

                {error ? <div className="ai-compare-modal__error">{error}</div> : null}

                <div className="ai-compare-modal__actions">
                    <button
                        type="button"
                        className="btn btn-secondary ai-compare-modal__cancel"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        {t('aiCompareTop_cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn workflow-btn-primary head-hunter-submit-btn ai-compare-modal__submit"
                        onClick={handleSubmit}
                        disabled={submitting}
                    >
                        <span className="head-hunter-submit-btn__content">
                            <svg
                                className="head-hunter-submit-btn__ai-spark"
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden
                            >
                                <path
                                    fill="currentColor"
                                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                                />
                            </svg>
                            <span className="btn-text">
                                {submitting ? t('aiCompareTop_submitting') : t('aiCompareTop_submit')}
                            </span>
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
