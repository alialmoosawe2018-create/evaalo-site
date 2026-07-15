import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { API_BASE_URL } from '../../config/apiBase.js';
import { fillI18nTemplate } from '../../utils/i18nTemplate.js';
import PositionSuggestCombobox from '../PositionSuggestCombobox.jsx';
import JobRoleFields from '../JobRoleFields.jsx';
import LanguageStyleSingleSelect from '../LanguageStyleSingleSelect.jsx';
import {
    buildAvailabilityOptions,
    buildEducationOptions,
    buildExperienceOptions,
    buildGenderOptions,
    buildGovernorateSuggestions,
    buildHearAboutOptions,
    buildLanguageLevelOptions,
    buildLanguageSuggestionOptions,
    buildSkillSuggestionOptions,
    languageLevelLabel,
    SALARY_CURRENCY_OPTIONS,
} from '../../utils/formSelectOptions.js';
import { resolveFormTranslationKey } from './formFieldI18n.js';
import { useFormConfig } from './useFormConfig.js';
import {
    buildInitialFormValues,
    fieldsForSection,
    validateDynamicField,
    validateDynamicSection,
} from './dynamicFormClientValidation.js';
import { applyRoleResolutionToState, roleResolutionCriteriaFields } from '../../utils/jobCatalogRole.js';
import { resolveJobRole } from '@evaalo/job-catalog';
import { localizeCatalogLabel } from '../../utils/localizeCatalogLabel.js';
import '../../styles.css';

function storageKeyForPub(pubToken) {
    return `evaalo_pub_form_${pubToken}`;
}

function submittedStorageKeyForPub(pubToken) {
    return `evaalo_pub_submitted_${pubToken}`;
}

function fieldLabel(t, field) {
    const key = resolveFormTranslationKey(field.labelKey);
    const label = t(key);
    return label === key ? field.id : label;
}

function sectionTitle(t, section) {
    const key = resolveFormTranslationKey(section.titleKey);
    const title = t(key);
    return title === key ? section.id : title;
}

function validationMessage(t, field, code) {
    const name = fieldLabel(t, field);
    if (code?.includes('required') || code?.includes('must be accepted')) {
        return fillI18nTemplate(t('formValidation_required'), { field: name });
    }
    if (code?.includes('at least')) {
        const min = field.validation?.minItems ?? field.validation?.minLength ?? '';
        return fillI18nTemplate(t('formValidation_minItems'), { field: name, min: String(min) });
    }
    if (code?.includes('invalid format')) {
        return fillI18nTemplate(t('formValidation_invalidFormat'), { field: name });
    }
    if (code?.includes('file')) {
        return fillI18nTemplate(t('formValidation_file'), { field: name });
    }
    return code || fillI18nTemplate(t('formValidation_required'), { field: name });
}

function DynamicFormFileUpload({
    field,
    file,
    preview,
    error,
    onChange,
    onClear,
    t,
    accept,
    hintKey,
    icon,
    accent = 'purple',
}) {
    const inputId = `dynamic-file-${field.id}`;
    const borderColor = accent === 'cyan' ? 'rgba(6, 182, 212, 0.4)' : 'rgba(91, 66, 246, 0.4)';
    const isImage = field.id === 'photo';

    return (
        <div className="form-group">
            <label htmlFor={inputId}>{fieldLabel(t, field)}</label>
            <div
                className="form-upload-dropzone"
                style={{
                    border: `2px dashed ${error ? '#EF4444' : borderColor}`,
                    borderRadius: '12px',
                    padding: '24px',
                    cursor: 'pointer',
                    position: 'relative',
                }}
                onClick={() => document.getElementById(inputId)?.click()}
            >
                {!preview ? (
                    <div style={{ textAlign: 'center' }}>
                        <div className="form-upload-empty-icon">{icon}</div>
                        <div className="form-upload-empty-title">{t('formUpload_click')}</div>
                        <div className="form-upload-empty-hint">{t(hintKey)}</div>
                    </div>
                ) : (
                    <div className="form-upload-preview">
                        {isImage && typeof preview === 'string' && preview.startsWith('data:') ? (
                            <img
                                src={preview}
                                alt=""
                                style={{
                                    width: '120px',
                                    height: '120px',
                                    borderRadius: '12px',
                                    objectFit: 'cover',
                                }}
                            />
                        ) : (
                            <div style={{ fontSize: '32px' }}>{icon}</div>
                        )}
                        <div style={{ flex: 1 }}>
                            <div className="form-upload-preview-title">{preview}</div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClear();
                                }}
                                style={{
                                    marginTop: '8px',
                                    padding: '6px 12px',
                                    background: '#EF4444',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                }}
                            >
                                {t('formUpload_remove')}
                            </button>
                        </div>
                    </div>
                )}
                <input
                    type="file"
                    id={inputId}
                    accept={accept}
                    onChange={onChange}
                    style={{ display: 'none' }}
                />
            </div>
            {error && <span className="error-message">{error}</span>}
            {!file && field.required && !error && (
                <span className="form-upload-empty-hint" style={{ display: 'block', marginTop: '6px' }}>
                    {t('formValidation_required').replace('{field}', fieldLabel(t, field))}
                </span>
            )}
        </div>
    );
}

export default function DynamicApplicationForm({ pubToken }) {
    const { t, currentLang } = useLanguage();
    const honeypotRef = useRef(null);
    const { loading, error, errorCode, config } = useFormConfig(pubToken);

    const formPageDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const genderOptions = useMemo(() => buildGenderOptions(t), [t, currentLang]);
    const educationOptions = useMemo(() => buildEducationOptions(t), [t, currentLang]);
    const experienceOptions = useMemo(() => buildExperienceOptions(t), [t, currentLang]);
    const availabilityOptions = useMemo(() => buildAvailabilityOptions(t), [t, currentLang]);
    const hearAboutOptions = useMemo(() => buildHearAboutOptions(t), [t, currentLang]);
    const languageLevelOptions = useMemo(() => buildLanguageLevelOptions(t), [t, currentLang]);
    const governorateSuggestions = useMemo(
        () => buildGovernorateSuggestions(currentLang),
        [currentLang],
    );
    const skillSuggestionOptions = useMemo(
        () => buildSkillSuggestionOptions(currentLang),
        [currentLang],
    );
    const languageSuggestionOptions = useMemo(
        () => buildLanguageSuggestionOptions(currentLang),
        [currentLang],
    );

    const [alreadySubmitted, setAlreadySubmitted] = useState(() => {
        try {
            return localStorage.getItem(submittedStorageKeyForPub(pubToken)) === '1';
        } catch {
            return false;
        }
    });
    const [submitSuccess, setSubmitSuccess] = useState(false);

    const formConfig = config?.form;
    const sections = formConfig?.sections ?? [];
    const allFields = formConfig?.fields ?? [];

    const [currentSection, setCurrentSection] = useState(0);
    const [formValues, setFormValues] = useState({});
    const [filesByFieldId, setFilesByFieldId] = useState({});
    const [filePreviews, setFilePreviews] = useState({});
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [skillInputValue, setSkillInputValue] = useState('');
    const [languageInputValue, setLanguageInputValue] = useState('');
    const [languageLevelDraft, setLanguageLevelDraft] = useState('');
    const [submitError, setSubmitError] = useState(null);

    useEffect(() => {
        if (!formConfig?.fields?.length) return;
        const initial = buildInitialFormValues(formConfig.fields);
        try {
            const saved = localStorage.getItem(storageKeyForPub(pubToken));
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.position_applied_for && !parsed.roleKey) {
                    const resolved = resolveJobRole(String(parsed.position_applied_for));
                    if (resolved.roleKey) {
                        parsed.roleKey = resolved.roleKey;
                        parsed.careerLevel = resolved.careerLevel ?? '';
                        parsed.managementTrack = resolved.managementTrack ?? '';
                        parsed.labelKey = resolved.labelKey ?? '';
                        parsed.roleMatchSource = resolved.matchSource ?? '';
                        parsed.position_applied_for =
                            resolved.displayTitle || parsed.position_applied_for;
                    }
                }
                setFormValues({ ...initial, ...parsed });
                if (Array.isArray(parsed.skills)) {
                    /* skills restored via formValues */
                }
                return;
            }
        } catch {
            /* ignore */
        }
        setFormValues(initial);
    }, [formConfig, pubToken]);

    useEffect(() => {
        if (!pubToken || !formValues || Object.keys(formValues).length === 0) return;
        try {
            const { agreeToTerms: _a, ...rest } = formValues;
            localStorage.setItem(storageKeyForPub(pubToken), JSON.stringify(rest));
        } catch {
            /* ignore */
        }
    }, [formValues, pubToken]);

    const progressPercent = sections.length
        ? Math.round(((currentSection + 1) / sections.length) * 100)
        : 0;

    const activeSection = sections[currentSection];
    const sectionFields = useMemo(
        () => (activeSection ? fieldsForSection(formConfig, activeSection.id) : []),
        [formConfig, activeSection]
    );

    const fieldById = useMemo(
        () => new Map(allFields.map((f) => [f.id, f])),
        [allFields]
    );

    const handleInputChange = (name, value) => {
        setFormValues((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[name];
                return next;
            });
        }
    };

    const handleRoleResolved = (resolution) => {
        setFormValues((prev) =>
            applyRoleResolutionToState(
                {
                    ...prev,
                    position_applied_for:
                        resolution?.displayTitle ?? prev.position_applied_for,
                },
                resolution
            )
        );
    };

    const handleFileChange = (field, e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const msg = validateDynamicField(field, null, file);
        if (msg) {
            setErrors((prev) => ({ ...prev, [field.id]: validationMessage(t, field, msg) }));
            return;
        }
        setFilesByFieldId((prev) => ({ ...prev, [field.id]: file }));
        if (field.id === 'photo') {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFilePreviews((prev) => ({ ...prev, [field.id]: reader.result }));
            };
            reader.readAsDataURL(file);
        } else {
            setFilePreviews((prev) => ({ ...prev, [field.id]: file.name }));
        }
        setErrors((prev) => {
            const next = { ...prev };
            delete next[field.id];
            return next;
        });
    };

    const clearFile = (fieldId) => {
        setFilesByFieldId((prev) => {
            const next = { ...prev };
            delete next[fieldId];
            return next;
        });
        setFilePreviews((prev) => {
            const next = { ...prev };
            delete next[fieldId];
            return next;
        });
        const input = document.getElementById(`dynamic-file-${fieldId}`);
        if (input) input.value = '';
    };

    const addSkill = () => {
        if (!skillInputValue.trim()) return;
        const skill = skillInputValue.trim();
        setFormValues((prev) => ({
            ...prev,
            skills: [...(prev.skills || []), skill],
        }));
        setSkillInputValue('');
        if (errors.skills) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.skills;
                return next;
            });
        }
    };

    const removeSkill = (index) => {
        setFormValues((prev) => ({
            ...prev,
            skills: (prev.skills || []).filter((_, i) => i !== index),
        }));
    };

    const addLanguage = () => {
        if (!languageInputValue.trim() || !languageLevelDraft) return;
        const entry = { name: languageInputValue.trim(), level: languageLevelDraft };
        setFormValues((prev) => ({
            ...prev,
            languages: [...(prev.languages || []), entry],
        }));
        setLanguageInputValue('');
        setLanguageLevelDraft('');
    };

    const removeLanguage = (index) => {
        setFormValues((prev) => ({
            ...prev,
            languages: (prev.languages || []).filter((_, i) => i !== index),
        }));
    };

    const validateCurrentSection = () => {
        const raw = validateDynamicSection(sectionFields, formValues, filesByFieldId);
        const mapped = {};
        for (const [fieldId, code] of Object.entries(raw)) {
            const field = fieldById.get(fieldId);
            mapped[fieldId] = field
                ? validationMessage(t, field, code)
                : code;
        }
        setErrors(mapped);
        return Object.keys(mapped).length === 0;
    };

    const handleNext = () => {
        if (!validateCurrentSection()) return;
        if (currentSection < sections.length - 1) {
            setCurrentSection((s) => s + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handlePrevious = () => {
        if (currentSection > 0) {
            setCurrentSection((s) => s - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitError(null);

        for (let i = 0; i < sections.length; i++) {
            const fields = fieldsForSection(formConfig, sections[i].id);
            const raw = validateDynamicSection(fields, formValues, filesByFieldId);
            if (Object.keys(raw).length > 0) {
                const mapped = {};
                for (const [fieldId, code] of Object.entries(raw)) {
                    const field = fieldById.get(fieldId);
                    mapped[fieldId] = field ? validationMessage(t, field, code) : code;
                }
                setErrors(mapped);
                setCurrentSection(i);
                return;
            }
        }

        const honeypotValue = honeypotRef.current?.value?.trim() || '';
        if (honeypotValue) {
            setSubmitSuccess(true);
            return;
        }

        setIsSubmitting(true);
        try {
            const body = new FormData();
            for (const field of allFields) {
                if (field.type === 'file') continue;
                const val = formValues[field.id];
                if (field.type === 'string_array' || field.type === 'language_array') {
                    body.append(field.id, JSON.stringify(val ?? []));
                } else if (field.type === 'boolean') {
                    body.append(field.id, val ? 'true' : 'false');
                } else {
                    body.append(field.id, val ?? '');
                }
            }
            if (filesByFieldId.cv) body.append('cv', filesByFieldId.cv);
            if (filesByFieldId.photo) body.append('photo', filesByFieldId.photo);
            body.append('website', honeypotRef.current?.value ?? '');
            body.append(
                'evaluationLanguage',
                currentLang === 'en' ? 'en' : 'ar'
            );
            for (const [key, value] of Object.entries(roleResolutionCriteriaFields(formValues))) {
                body.append(key, value);
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(
                `${API_BASE_URL}/api/public/campaigns/${encodeURIComponent(pubToken)}/apply`,
                { method: 'POST', body, signal: controller.signal }
            );
            clearTimeout(timeoutId);

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                let msg = result.error || result.message || t('formSubmit_error');
                if (result.code === 'APPLICATION_VALIDATION_FAILED' && Array.isArray(result.details)?.length) {
                    msg = result.details[0].message || msg;
                } else if (result.error === 'Email already exists') {
                    msg = t('formSubmit_emailExists');
                } else if (response.status === 410) {
                    msg = t('formConfig_closed');
                }
                throw new Error(msg);
            }

            localStorage.removeItem(storageKeyForPub(pubToken));
            try {
                localStorage.setItem(submittedStorageKeyForPub(pubToken), '1');
            } catch {
                /* ignore */
            }
            setAlreadySubmitted(true);
            setSubmitSuccess(true);
        } catch (err) {
            setSubmitError(err.message || t('formSubmit_error'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderField = (field) => {
        const hasError = errors[field.id];
        const commonInputProps = {
            id: field.id,
            name: field.id,
            className: hasError ? 'error' : '',
        };

        if (field.type === 'file') {
            const accept =
                field.id === 'cv'
                    ? '.pdf,application/pdf'
                    : 'image/jpeg,image/jpg,image/png,image/gif,image/webp';
            return (
                <DynamicFormFileUpload
                    key={field.id}
                    field={field}
                    file={filesByFieldId[field.id]}
                    preview={filePreviews[field.id]}
                    error={hasError}
                    t={t}
                    accept={accept}
                    icon={field.id === 'cv' ? '📄' : '📷'}
                    hintKey={field.id === 'cv' ? 'formUpload_cvHint' : 'formUpload_photoHint'}
                    accent={field.id === 'cv' ? 'cyan' : 'purple'}
                    onChange={(e) => handleFileChange(field, e)}
                    onClear={() => clearFile(field.id)}
                />
            );
        }

        if (field.type === 'boolean') {
            return (
                <div key={field.id} className="form-group">
                    <div className="checkbox-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={Boolean(formValues[field.id])}
                                onChange={(e) => handleInputChange(field.id, e.target.checked)}
                                required={field.required}
                            />
                            <span>{fieldLabel(t, field)} *</span>
                        </label>
                        {hasError && <span className="error-message">{hasError}</span>}
                    </div>
                </div>
            );
        }

        if (field.type === 'string_array' && field.id === 'skills') {
            return (
                <div key={field.id} className="form-group">
                    <label>{fieldLabel(t, field)}</label>
                    <div className="input-with-button">
                        <PositionSuggestCombobox
                            id="dynamic-skill-input"
                            name="skillInput"
                            value={skillInputValue}
                            onChange={(e) => setSkillInputValue(e.target.value)}
                            placeholder={t('formField_skills_ph')}
                            suggestionOptions={skillSuggestionOptions}
                            listboxId="dynamic-skill-suggestions"
                        />
                        <button type="button" className="btn btn-secondary" onClick={addSkill}>
                            {t('formAdd')}
                        </button>
                    </div>
                    <div className="tags-container">
                        {(formValues.skills || []).map((skill, index) => (
                            <span key={`${skill}-${index}`} className="tag">
                                {skill}
                                <button type="button" className="tag-remove" onClick={() => removeSkill(index)}>
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.type === 'language_array') {
            return (
                <div key={field.id} className="form-group">
                    <label>{fieldLabel(t, field)}</label>
                    <div className="input-with-button">
                        <PositionSuggestCombobox
                            id="dynamic-language-input"
                            name="languageInput"
                            value={languageInputValue}
                            onChange={(e) => setLanguageInputValue(e.target.value)}
                            placeholder={t('formField_languages_ph')}
                            suggestionOptions={languageSuggestionOptions}
                            listboxId="dynamic-language-suggestions"
                        />
                        <LanguageStyleSingleSelect
                            id="dynamic-language-level"
                            value={languageLevelDraft}
                            onChange={setLanguageLevelDraft}
                            options={languageLevelOptions}
                            placeholder={t('formField_languageLevel_ph')}
                            aria-label={t('formField_languageLevel_ph')}
                            listboxId="dynamic-language-level-menu"
                        />
                        <button type="button" className="btn btn-secondary" onClick={addLanguage}>
                            {t('formAdd')}
                        </button>
                    </div>
                    <div className="tags-container">
                        {(formValues.languages || []).map((lang, index) => (
                            <span key={`${lang.name}-${index}`} className="tag">
                                {lang.name} ({languageLevelLabel(t, lang.level)})
                                <button type="button" className="tag-remove" onClick={() => removeLanguage(index)}>
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.type === 'textarea') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <textarea
                        {...commonInputProps}
                        rows={6}
                        maxLength={field.validation?.maxLength ?? 10000}
                        value={formValues[field.id] ?? ''}
                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                        placeholder={t(`formField_${field.id}_ph`)}
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'location') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <PositionSuggestCombobox
                        {...commonInputProps}
                        value={formValues[field.id] ?? ''}
                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                        placeholder={t('formField_location_ph')}
                        suggestions={governorateSuggestions}
                        listboxId="dynamic-location-suggestions"
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'gender' || field.id === 'salaryCurrency') {
            const options = field.id === 'gender' ? genderOptions : SALARY_CURRENCY_OPTIONS;
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <LanguageStyleSingleSelect
                        id={field.id}
                        value={formValues[field.id] ?? ''}
                        onChange={(val) => handleInputChange(field.id, val)}
                        options={options}
                        placeholder={t(`formField_${field.id}_ph`)}
                        aria-label={fieldLabel(t, field)}
                        listboxId={`dynamic-${field.id}-menu`}
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'position_applied_for') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <JobRoleFields
                        roleKey={formValues.roleKey || ''}
                        careerLevel={formValues.careerLevel || ''}
                        researchDomain={formValues.researchDomain || ''}
                        position={formValues[field.id] ?? ''}
                        onRoleResolved={handleRoleResolved}
                        onStateChange={setFormValues}
                        roleInputId={field.id}
                        roleInputName={field.id}
                        levelInputId={`${field.id}-level`}
                        levelInputName="careerLevel"
                        rolePlaceholder={t('formField_position_applied_for_ph')}
                        levelPlaceholder={t('jobRole_level_placeholder')}
                        roleListboxId="dynamic-position-suggestions"
                        disabled={false}
                        roleRequired={field.required}
                        layout="stacked"
                        roleInputClassName={hasError ? 'error' : ''}
                        levelInputClassName={hasError ? 'error' : ''}
                        levelInputStyle={{ width: '100%', marginTop: '8px' }}
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'years_of_experience') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <PositionSuggestCombobox
                        {...commonInputProps}
                        value={formValues[field.id] ?? ''}
                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                        suggestionOptions={experienceOptions}
                        placeholder={t('formField_years_of_experience_ph')}
                        listboxId="dynamic-years-suggestions"
                        required={field.required}
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'highest_education_level') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <LanguageStyleSingleSelect
                        id={field.id}
                        value={formValues[field.id] ?? ''}
                        onChange={(val) => handleInputChange(field.id, val)}
                        options={educationOptions}
                        placeholder={t('formField_highest_education_level_ph')}
                        aria-label={fieldLabel(t, field)}
                        listboxId="dynamic-education-menu"
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'availability') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <LanguageStyleSingleSelect
                        id={field.id}
                        value={formValues[field.id] ?? ''}
                        onChange={(val) => handleInputChange(field.id, val)}
                        options={availabilityOptions}
                        placeholder={t('formField_availability_ph')}
                        aria-label={fieldLabel(t, field)}
                        listboxId="dynamic-availability-menu"
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        if (field.id === 'hearAboutUs') {
            return (
                <div key={field.id} className="form-group">
                    <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                    <LanguageStyleSingleSelect
                        id={field.id}
                        value={formValues[field.id] ?? ''}
                        onChange={(val) => handleInputChange(field.id, val)}
                        options={hearAboutOptions}
                        placeholder={t('formField_hearAboutUs_ph')}
                        aria-label={fieldLabel(t, field)}
                        listboxId="dynamic-hear-menu"
                    />
                    {hasError && <span className="error-message">{hasError}</span>}
                </div>
            );
        }

        const inputType =
            field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : field.type === 'url' ? 'url' : 'text';

        return (
            <div key={field.id} className="form-group">
                <label htmlFor={field.id}>{fieldLabel(t, field)}</label>
                <input
                    {...commonInputProps}
                    type={inputType}
                    value={formValues[field.id] ?? ''}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    placeholder={t(`formField_${field.id}_ph`)}
                    required={field.required}
                />
                {hasError && <span className="error-message">{hasError}</span>}
            </div>
        );
    };

    if (alreadySubmitted || submitSuccess) {
        return (
            <div className="form-page" dir={formPageDir} lang={currentLang}>
                <div className="container">
                    <div className="form-wrapper">
                        <header className="form-header">
                            <h1>
                                {config?.positionTitle
                                    ? localizeCatalogLabel(config.positionTitle, currentLang)
                                    : t('title')}
                            </h1>
                            <p className="subtitle" style={{ color: '#10B981', fontSize: '18px', lineHeight: 1.5 }}>
                                {t('formSubmit_success')}
                            </p>
                            {!submitSuccess ? (
                                <p className="subtitle" style={{ marginTop: '12px' }}>
                                    {t('formConfig_alreadySubmitted')}
                                </p>
                            ) : null}
                        </header>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="form-page" dir={formPageDir} lang={currentLang}>
                <div className="container">
                    <div className="form-wrapper">
                        <p>{t('formConfig_loading')}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        const message =
            errorCode === 'NOT_FOUND'
                ? t('formConfig_notFound')
                : errorCode === 'CAMPAIGN_CLOSED'
                  ? t('formConfig_closed')
                  : errorCode === 'NETWORK'
                    ? t('formConfig_network')
                    : t('formConfig_loadFailed');
        return (
            <div className="form-page" dir={formPageDir} lang={currentLang}>
                <div className="container">
                    <div className="form-wrapper">
                        <header className="form-header">
                            <h1>{t('title')}</h1>
                            <p className="subtitle" style={{ color: '#EF4444' }}>
                                {message}
                            </p>
                        </header>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="form-page" dir={formPageDir} lang={currentLang}>
            <div className="container">
                <div className="form-wrapper">
                    <header className="form-header">
                        <h1>
                            {config?.positionTitle
                                ? localizeCatalogLabel(config.positionTitle, currentLang)
                                : t('title')}
                        </h1>
                        <p className="subtitle">{t('subtitle')}</p>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                        <p className="progress-text">
                            <span>{progressPercent}</span>
                            <span> {t('complete')}</span>
                        </p>
                    </header>

                    <form id="applicationForm" onSubmit={handleSubmit} noValidate>
                        <input
                            ref={honeypotRef}
                            type="text"
                            name="website"
                            tabIndex={-1}
                            autoComplete="off"
                            aria-hidden="true"
                            defaultValue=""
                            style={{
                                position: 'absolute',
                                left: '-9999px',
                                width: '1px',
                                height: '1px',
                                opacity: 0,
                                pointerEvents: 'none',
                            }}
                        />

                        {activeSection && (
                            <div className="form-section">
                                <h2 className="section-title">{sectionTitle(t, activeSection)}</h2>
                                <div>{sectionFields.map((field) => renderField(field))}</div>
                            </div>
                        )}

                        {submitError && (
                            <p className="error-message" style={{ marginBottom: '12px' }}>
                                {submitError}
                            </p>
                        )}

                        <div className="form-navigation">
                            {currentSection > 0 && (
                                <button type="button" className="btn btn-secondary" onClick={handlePrevious}>
                                    {t('previous')}
                                </button>
                            )}
                            {currentSection < sections.length - 1 ? (
                                <button type="button" className="btn btn-primary" onClick={handleNext}>
                                    {t('next')}
                                </button>
                            ) : (
                                <button type="submit" className="btn btn-submit" disabled={isSubmitting}>
                                    {isSubmitting ? t('formSubmitting') : t('submit')}
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
