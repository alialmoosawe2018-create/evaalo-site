import React, { useCallback, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { pdfAppearsTextBased } from '../../utils/pdfTextValidation.js';

const MIN_FILES = 2;
const MAX_BYTES = 5 * 1024 * 1024;

function isPdf(file) {
    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return mime === 'application/pdf' || name.endsWith('.pdf');
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * منطقة رفع سير ذاتية متعددة (PDF) — حد أدنى 2 ملفات، 5MB لكل ملف.
 */
export default function CvUploadZone({ files, onChange, disabled, onNotice }) {
    const { t } = useLanguage();
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    const [validating, setValidating] = useState(false);

    const validateAndMerge = useCallback(
        async (incoming) => {
            const next = [...files];
            let firstError = '';

            setValidating(true);
            try {
                for (const file of incoming) {
                    if (!isPdf(file)) {
                        firstError = firstError || t('cvComparisonErrPdfOnly');
                        continue;
                    }
                    if (file.size > MAX_BYTES) {
                        firstError = firstError || t('cvComparisonErrFileSize');
                        continue;
                    }
                    let textBased = true;
                    try {
                        textBased = await pdfAppearsTextBased(file);
                    } catch {
                        textBased = true;
                    }
                    if (!textBased) {
                        firstError = firstError || t('cvComparisonErrScannedPdf');
                        continue;
                    }

                    const dup = next.some((f) => f.name === file.name && f.size === file.size);
                    if (!dup) next.push(file);
                }

                onChange(next, '');
                if (firstError) {
                    onNotice?.(firstError);
                }
            } finally {
                setValidating(false);
            }
        },
        [files, onChange, onNotice, t]
    );

    const onInputChange = async (e) => {
        const list = e.target.files ? Array.from(e.target.files) : [];
        await validateAndMerge(list);
        e.target.value = '';
    };

    const onDrop = async (e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled || validating) return;
        const list = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        await validateAndMerge(list);
    };

    const removeFile = (index) => {
        const next = files.filter((_, i) => i !== index);
        onChange(next);
    };

    const zoneDisabled = disabled || validating;

    return (
        <div className="form-group head-hunter-design-field ai-cv-comparison-upload">
            <span className="form-label" id="cv-upload-label">
                {t('cvComparisonUploadLabel')}
            </span>

            <div
                className={[
                    'ai-cv-comparison-upload__dropzone',
                    dragOver ? 'ai-cv-comparison-upload__dropzone--over' : '',
                    zoneDisabled ? 'ai-cv-comparison-upload__dropzone--disabled' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                role="button"
                tabIndex={zoneDisabled ? -1 : 0}
                aria-labelledby="cv-upload-label"
                aria-busy={validating}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!zoneDisabled) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!zoneDisabled) inputRef.current?.click();
                    }
                }}
                onClick={() => {
                    if (!zoneDisabled) inputRef.current?.click();
                }}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    className="ai-cv-comparison-upload__input"
                    onChange={onInputChange}
                    disabled={zoneDisabled}
                    aria-hidden
                    tabIndex={-1}
                />
                <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden
                    className="ai-cv-comparison-upload__icon"
                >
                    <path
                        d="M12 16V4m0 0l-4 4m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                <span className="ai-cv-comparison-upload__cta">
                    {validating ? t('cvComparisonUploadValidating') : t('cvComparisonUploadCta')}
                </span>
                <span className="ai-cv-comparison-upload__meta">{t('cvComparisonUploadMeta')}</span>
            </div>

            {files.length > 0 ? (
                <ul className="ai-cv-comparison-upload__list" aria-label={t('cvComparisonUploadListAria')}>
                    {files.map((file, index) => (
                        <li key={`${file.name}-${file.size}-${index}`} className="ai-cv-comparison-upload__item">
                            <span className="ai-cv-comparison-upload__item-name" title={file.name}>
                                {file.name}
                            </span>
                            <span className="ai-cv-comparison-upload__item-size">{formatBytes(file.size)}</span>
                            <button
                                type="button"
                                className="ai-cv-comparison-upload__remove"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeFile(index);
                                }}
                                disabled={zoneDisabled}
                                aria-label={`${t('cvComparisonRemoveFile')} ${file.name}`}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

export { MIN_FILES as CV_COMPARISON_MIN_FILES };
