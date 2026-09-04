// ============================================
// File: components/PublicIntakeFields.jsx
// Purpose: The candidate-details step shared by the two public interview links
//          (voice and video): required contact fields, an optional CV upload
//          that auto-fills the rest, and an optional photo.
//
// The parent owns the state (see utils/publicIntakeForm.js) so it can validate
// and submit; this component only renders it and reports changes back.
// ============================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/apiBase.js';
import {
    CV_ACCEPT,
    CV_MAX_BYTES,
    PHOTO_ACCEPT,
    PHOTO_MAX_BYTES,
    dataUrlToFile,
    isSupportedCvFile,
    isSupportedPhotoFile,
    mergeParsedCvFields,
} from '../utils/publicIntakeForm.js';

/** Optional fields, in display order. `full` spans both grid columns. */
const OPTIONAL_FIELDS = [
    { key: 'position_applied_for', labelKey: 'publicScreening_position', phKey: 'publicScreening_positionPh' },
    { key: 'years_of_experience', labelKey: 'publicScreening_experience', phKey: 'publicScreening_experiencePh' },
    { key: 'highest_education_level', labelKey: 'publicScreening_education', phKey: 'publicScreening_educationPh' },
    { key: 'current_company', labelKey: 'publicScreening_currentCompany', phKey: 'publicScreening_currentCompanyPh' },
    { key: 'location', labelKey: 'publicScreening_location', phKey: 'publicScreening_locationPh' },
    { key: 'languages', labelKey: 'publicScreening_languages', phKey: 'publicScreening_languagesPh' },
    { key: 'skills', labelKey: 'publicScreening_skills', phKey: 'publicScreening_skillsPh', full: true },
];

/** Map a backend error code onto a message the candidate can act on. */
function cvErrorKey(code) {
    switch (code) {
        case 'UNSUPPORTED_TYPE':
            return 'publicScreening_cvUnsupported';
        case 'FILE_TOO_LARGE':
            return 'publicScreening_cvTooLarge';
        case 'RATE_LIMITED':
            return 'publicScreening_cvRateLimited';
        case 'EMPTY_CV':
            return 'publicScreening_cvNoText';
        default:
            return 'publicScreening_cvFailed';
    }
}

const PublicIntakeFields = ({ idPrefix, value, onChange, disabled = false, t }) => {
    const { details, cvFile, photoFile } = value;
    const [parsing, setParsing] = useState(false);
    const [cvNote, setCvNote] = useState(null); // { kind: 'ok' | 'error', text }
    const [photoError, setPhotoError] = useState(null);
    const cvInputRef = useRef(null);
    const photoInputRef = useRef(null);

    // One preview URL per picked file, revoked when it is replaced or unmounted.
    const photoUrl = useMemo(
        () => (photoFile ? URL.createObjectURL(photoFile) : ''),
        [photoFile]
    );
    useEffect(() => {
        if (!photoUrl) return undefined;
        return () => URL.revokeObjectURL(photoUrl);
    }, [photoUrl]);

    const setField = (key, next) => {
        onChange({ ...value, details: { ...details, [key]: next } });
    };

    const handleCvPick = async (event) => {
        const file = event.target.files?.[0];
        // Let the same file be picked again after an error.
        if (event.target) event.target.value = '';
        if (!file) return;

        if (!isSupportedCvFile(file)) {
            setCvNote({ kind: 'error', text: t('publicScreening_cvUnsupported') });
            return;
        }
        if (file.size > CV_MAX_BYTES) {
            setCvNote({ kind: 'error', text: t('publicScreening_cvTooLarge') });
            return;
        }

        setParsing(true);
        setCvNote(null);
        // Attach the file straight away: even if parsing fails the recruiter
        // should still receive the CV the candidate chose to send.
        let nextValue = { ...value, cvFile: file };
        onChange(nextValue);

        try {
            const body = new FormData();
            body.append('cv', file);
            const res = await fetch(`${API_BASE_URL}/api/cv/public-parse`, {
                method: 'POST',
                body,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) {
                setCvNote({ kind: 'error', text: t(cvErrorKey(data?.error)) });
                return;
            }
            const { next, filled } = mergeParsedCvFields(details, data.fields);
            // A photo already chosen by hand outranks one pulled from the file.
            const extracted = data.photo ? dataUrlToFile(data.photo) : null;
            nextValue = {
                ...nextValue,
                details: next,
                photoFile: photoFile || extracted,
            };
            onChange(nextValue);
            setCvNote({
                kind: filled > 0 ? 'ok' : 'error',
                text: filled > 0 ? t('publicScreening_cvFilled') : t('publicScreening_cvNothingFound'),
            });
        } catch (_) {
            setCvNote({ kind: 'error', text: t('publicScreening_cvFailed') });
        } finally {
            setParsing(false);
        }
    };

    const handlePhotoPick = (event) => {
        const file = event.target.files?.[0];
        if (event.target) event.target.value = '';
        if (!file) return;
        if (!isSupportedPhotoFile(file)) {
            setPhotoError(t('publicScreening_photoUnsupported'));
            return;
        }
        if (file.size > PHOTO_MAX_BYTES) {
            setPhotoError(t('publicScreening_photoTooLarge'));
            return;
        }
        setPhotoError(null);
        onChange({ ...value, photoFile: file });
    };

    return (
        <>
            {/* ── رفع السيرة الذاتية (اختياري) — يملأ الحقول تلقائياً ── */}
            <div className="psc-upload">
                <div className="psc-upload__head">
                    <h3 className="psc-upload__title">{t('publicScreening_cvTitle')}</h3>
                    <p className="psc-upload__hint">{t('publicScreening_cvHint')}</p>
                </div>
                <input
                    ref={cvInputRef}
                    id={`${idPrefix}-cv`}
                    type="file"
                    accept={CV_ACCEPT}
                    className="psc-upload__input"
                    onChange={handleCvPick}
                    disabled={disabled || parsing}
                />
                <div className="psc-upload__row">
                    <button
                        type="button"
                        className="psc-upload__btn"
                        onClick={() => cvInputRef.current?.click()}
                        disabled={disabled || parsing}
                    >
                        {parsing
                            ? t('publicScreening_cvParsing')
                            : cvFile
                              ? t('publicScreening_cvChange')
                              : t('publicScreening_cvChoose')}
                    </button>
                    {cvFile ? (
                        <span className="psc-upload__file" title={cvFile.name}>
                            {cvFile.name}
                        </span>
                    ) : (
                        <span className="psc-upload__formats">{t('publicScreening_cvFormats')}</span>
                    )}
                    {cvFile ? (
                        <button
                            type="button"
                            className="psc-upload__remove"
                            onClick={() => {
                                setCvNote(null);
                                onChange({ ...value, cvFile: null });
                            }}
                            disabled={disabled || parsing}
                        >
                            {t('publicScreening_cvRemove')}
                        </button>
                    ) : null}
                </div>
                {cvNote ? (
                    <p
                        className={`psc-upload__note psc-upload__note--${cvNote.kind}`}
                        role={cvNote.kind === 'error' ? 'alert' : 'status'}
                    >
                        {cvNote.text}
                    </p>
                ) : null}
            </div>

            {/* ── الحقول المطلوبة ── */}
            <div className="psc-fields">
                <div className="form-group psc-field psc-field--full">
                    <label htmlFor={`${idPrefix}-name`}>{t('publicScreening_fullName')}</label>
                    <input
                        id={`${idPrefix}-name`}
                        type="text"
                        name="full_name"
                        value={details.full_name}
                        onChange={(e) => setField('full_name', e.target.value)}
                        placeholder={t('publicScreening_fullNamePh')}
                        autoComplete="name"
                        disabled={disabled}
                        required
                    />
                </div>
                <div className="form-group psc-field">
                    <label htmlFor={`${idPrefix}-email`}>{t('publicScreening_email')}</label>
                    <input
                        id={`${idPrefix}-email`}
                        type="email"
                        name="email"
                        value={details.email}
                        onChange={(e) => setField('email', e.target.value)}
                        placeholder={t('publicScreening_emailPh')}
                        autoComplete="email"
                        dir="ltr"
                        disabled={disabled}
                        required
                    />
                </div>
                <div className="form-group psc-field">
                    <label htmlFor={`${idPrefix}-phone`}>{t('publicScreening_phone')}</label>
                    <input
                        id={`${idPrefix}-phone`}
                        type="tel"
                        name="phone"
                        value={details.phone}
                        onChange={(e) => setField('phone', e.target.value)}
                        placeholder={t('publicScreening_phonePh')}
                        autoComplete="tel"
                        dir="ltr"
                        disabled={disabled}
                        required
                    />
                </div>
            </div>

            {/* ── حقول اختيارية: لا تمنع بدء المقابلة ── */}
            <h2 className="psc-form__heading psc-form__heading--sub">
                {t('publicScreening_sectionOptional')}
            </h2>
            <p className="psc-form__subhint">{t('publicScreening_optionalHint')}</p>

            <div className="psc-fields">
                {OPTIONAL_FIELDS.map((field) => (
                    <div
                        key={field.key}
                        className={`form-group psc-field${field.full ? ' psc-field--full' : ''}`}
                    >
                        <label htmlFor={`${idPrefix}-${field.key}`}>{t(field.labelKey)}</label>
                        <input
                            id={`${idPrefix}-${field.key}`}
                            type="text"
                            name={field.key}
                            value={details[field.key]}
                            onChange={(e) => setField(field.key, e.target.value)}
                            placeholder={t(field.phKey)}
                            disabled={disabled}
                        />
                    </div>
                ))}

                {/* ── الصورة (اختيارية) — تُستخرج من DOCX أو تُرفع يدوياً ── */}
                <div className="form-group psc-field psc-field--full">
                    <label htmlFor={`${idPrefix}-photo`}>{t('publicScreening_photoTitle')}</label>
                    <div className="psc-photo">
                        {photoUrl ? (
                            <img
                                className="psc-photo__preview"
                                src={photoUrl}
                                alt={t('publicScreening_photoAlt')}
                            />
                        ) : (
                            <span className="psc-photo__placeholder" aria-hidden>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
                                    <path
                                        d="M4.8 20a7.2 7.2 0 0114.4 0"
                                        stroke="currentColor"
                                        strokeWidth="1.7"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </span>
                        )}
                        <div className="psc-photo__actions">
                            <input
                                ref={photoInputRef}
                                id={`${idPrefix}-photo`}
                                type="file"
                                accept={PHOTO_ACCEPT}
                                className="psc-upload__input"
                                onChange={handlePhotoPick}
                                disabled={disabled}
                            />
                            <button
                                type="button"
                                className="psc-upload__btn"
                                onClick={() => photoInputRef.current?.click()}
                                disabled={disabled}
                            >
                                {t('publicScreening_photoChoose')}
                            </button>
                            {photoFile ? (
                                <button
                                    type="button"
                                    className="psc-upload__remove"
                                    onClick={() => {
                                        setPhotoError(null);
                                        onChange({ ...value, photoFile: null });
                                    }}
                                    disabled={disabled}
                                >
                                    {t('publicScreening_photoRemove')}
                                </button>
                            ) : null}
                            <span className="psc-upload__formats">{t('publicScreening_photoHint')}</span>
                        </div>
                    </div>
                    {photoError ? (
                        <p className="psc-upload__note psc-upload__note--error" role="alert">
                            {photoError}
                        </p>
                    ) : null}
                </div>
            </div>
        </>
    );
};

export default PublicIntakeFields;
