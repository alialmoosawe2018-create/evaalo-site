import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import { headHunterApiErrorMessage } from '../utils/headHunterApiError.js';
import { useLanguage } from '../contexts/LanguageContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { PERMISSIONS } from '../contexts/rbacRoles';
import PositionSuggestCombobox from '../components/PositionSuggestCombobox.jsx';
import JobRoleFields from '../components/JobRoleFields.jsx';
import CvUploadZone, { CV_COMPARISON_MIN_FILES } from '../components/cvcomparison/CvUploadZone.jsx';
import CvComparisonResultsWorkspace from '../components/cvcomparison/CvComparisonResultsWorkspace.jsx';
import ScreeningAiCompareNeedTwoNotice from '../components/screening/ScreeningAiCompareNeedTwoNotice.jsx';
import { mergeRoleResolution, roleResolutionCriteriaFields } from '../utils/jobCatalogRole.js';
import {
    CV_COMPARISON_OPTIONAL_FILTER_FIELDS,
    buildOptionalFiltersPayload,
    createInitialOptionalFilters,
    findEnabledOptionalFilterMissingValue,
} from '../utils/headHunterOptionalFilters.js';
import {
    buildOptionalFilterSuggestionOptions,
    optionalFilterUsesCombobox,
} from '../utils/optionalFilterSuggestionOptions.js';
import '../design-styles.css';

const HEADHUNTER_LOCATION_OPTIONS = [
    'Baghdad, Iraq',
    'Basra, Iraq',
    'Erbil, Iraq',
    'Mosul, Iraq',
    'Najaf, Iraq',
    'Karbala, Iraq',
    'Sulaymaniyah, Iraq',
    'Duhok, Iraq',
    'Kirkuk, Iraq',
    'Ramadi, Iraq',
    'Nasiriyah, Iraq',
    'Amarah, Iraq',
    'Diwaniyah, Iraq',
    'Kut, Iraq',
    'Hillah, Iraq',
    'Remote — Iraq',
    'Dubai, UAE',
    'Abu Dhabi, UAE',
    'Riyadh, Saudi Arabia',
    'Doha, Qatar',
    'Kuwait City, Kuwait',
];

// Localized suggestion options: stored value stays English (sent to n8n),
// while the label is localized via the combobox location-label catalog.
const HEADHUNTER_LOCATION_SUGGESTION_OPTIONS = HEADHUNTER_LOCATION_OPTIONS.map((v) => ({
    value: v,
    labelKey: v,
}));

const YEARS_VALUE_KEYS = [
    { value: '0-1', key: 'aiHeadHunterYears0to1' },
    { value: '1-3', key: 'aiHeadHunterYears1to3' },
    { value: '3-5', key: 'aiHeadHunterYears3to5' },
    { value: '5-10', key: 'aiHeadHunterYears5to10' },
    { value: '10-plus', key: 'aiHeadHunterYears10Plus' },
];

const AGE_RANGE_VALUES = ['18-24', '25-34', '35-44', '45-54', '55-plus'];

const POLL_INTERVAL_MS = 2800;
const POLL_MAX_ATTEMPTS = 22;

/**
 * AI CV Comparison — معايير مثل Head Hunter + رفع سير ذاتية → n8n مع comparisonId.
 */
export default function AICvComparison() {
    const { t, currentLang } = useLanguage();
    const { hasPermission } = useOrganization();
    const canCompare = hasPermission(PERMISSIONS.CV_COMPARISON_COMPARE);
    const pollTimerRef = useRef(null);
    const activeComparisonIdRef = useRef(null);
    const [awaitingPollResult, setAwaitingPollResult] = useState(false);

    const [position, setPosition] = useState('');
    const [roleCatalog, setRoleCatalog] = useState({});
    const [location, setLocation] = useState('');
    const [yearsExperience, setYearsExperience] = useState('');
    const [ageRange, setAgeRange] = useState('');
    const [query, setQuery] = useState('');
    const [optionalFilters, setOptionalFilters] = useState(() =>
        createInitialOptionalFilters(CV_COMPARISON_OPTIONAL_FILTER_FIELDS)
    );
    const [cvFiles, setCvFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState({ type: '', text: '' });
    const [comparisonId, setComparisonId] = useState(null);
    const [validationNotice, setValidationNotice] = useState({ open: false, description: '' });

    const [resultState, setResultState] = useState({
        loading: false,
        error: '',
        hasData: false,
        status: null,
        receivedAt: null,
        payload: null,
    });

    useEffect(
        () => () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        },
        []
    );

    const yearsExperienceChoices = useMemo(
        () => YEARS_VALUE_KEYS.map(({ value, key }) => ({ value, label: t(key) })),
        [t]
    );

    const ageRangeChoices = useMemo(
        () =>
            AGE_RANGE_VALUES.map((value) => ({
                value,
                label: value.replace('-plus', '+').replace('-', '–'),
            })),
        []
    );

    const optionalFilterSuggestionOptions = useMemo(
        () => buildOptionalFilterSuggestionOptions(t, currentLang),
        [t, currentLang]
    );

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const clearPollTimerOnly = useCallback(() => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const stopPoll = useCallback(() => {
        clearPollTimerOnly();
        setAwaitingPollResult(false);
    }, [clearPollTimerOnly]);

    const fetchComparisonResult = useCallback(
        async (id, { quiet = false } = {}) => {
            if (!id) return { success: false };
            if (!quiet) {
                setResultState((prev) => ({ ...prev, loading: true, error: '' }));
            }
            try {
                const data = await apiClient.get(
                    `/api/cv-comparison/last-result?comparisonId=${encodeURIComponent(id)}`
                );
                const next = {
                    loading: false,
                    error: '',
                    hasData: Boolean(data?.hasData),
                    status: data?.status ?? null,
                    receivedAt: data?.receivedAt ?? null,
                    payload: data?.payload ?? null,
                };
                setResultState(next);
                return {
                    success: true,
                    ...next,
                };
            } catch (err) {
                const msg = headHunterApiErrorMessage(err, t, { fallbackKey: 'cvComparisonErrLoad' });
                if (!quiet) {
                    setResultState((prev) => ({ ...prev, loading: false, error: msg }));
                }
                return { success: false, error: msg };
            }
        },
        [t]
    );

    const showValidationNotice = useCallback((description) => {
        setValidationNotice({ open: true, description });
    }, []);

    const startPollForComparison = useCallback(
        (id) => {
            clearPollTimerOnly();
            activeComparisonIdRef.current = id;
            let attempts = 0;

            pollTimerRef.current = window.setInterval(async () => {
                if (activeComparisonIdRef.current !== id) {
                    stopPoll();
                    return;
                }
                attempts += 1;
                const res = await fetchComparisonResult(id, { quiet: true });
                if (!res.success) {
                    if (attempts >= POLL_MAX_ATTEMPTS) stopPoll();
                    return;
                }

                if (res.status === 'completed' && res.hasData) {
                    stopPoll();
                    return;
                }
                if (res.status === 'failed') {
                    showValidationNotice(t('cvComparisonErrScannedPdf'));
                    setResultState((prev) => ({
                        ...prev,
                        loading: false,
                        error: '',
                        status: 'failed',
                    }));
                    stopPoll();
                    return;
                }

                if (attempts >= POLL_MAX_ATTEMPTS) {
                    stopPoll();
                }
            }, POLL_INTERVAL_MS);
            setAwaitingPollResult(true);
        },
        [clearPollTimerOnly, fetchComparisonResult, showValidationNotice, stopPoll, t]
    );

    const handleCvFilesChange = (next) => {
        setCvFiles(next);
    };

    const submitBusy = loading || awaitingPollResult;

    const handleRoleResolved = useCallback((resolution) => {
        setRoleCatalog((prev) => mergeRoleResolution(prev, resolution));
        if (resolution?.displayTitle) {
            setPosition(resolution.displayTitle);
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFeedback({ type: '', text: '' });
        if (cvFiles.length < CV_COMPARISON_MIN_FILES) {
            showValidationNotice(t('cvComparisonErrMinFiles'));
            return;
        }
        if (!canCompare) {
            showValidationNotice(t('rbacPermissionDenied'));
            return;
        }
        const pos = position.trim();
        const loc = location.trim();
        if (!String(roleCatalog.roleKey || pos).trim() || !loc) {
            showValidationNotice(t('aiHeadHunterErrPositionLocation'));
            return;
        }
        const optionalFilterError = findEnabledOptionalFilterMissingValue(
            optionalFilters,
            t,
            CV_COMPARISON_OPTIONAL_FILTER_FIELDS
        );
        if (optionalFilterError) {
            showValidationNotice(optionalFilterError);
            return;
        }
        const optionalFiltersPayload = buildOptionalFiltersPayload(
            optionalFilters,
            CV_COMPARISON_OPTIONAL_FILTER_FIELDS
        );

        setLoading(true);
        stopPoll();
        setComparisonId(null);
        setResultState({
            loading: false,
            error: '',
            hasData: false,
            status: null,
            receivedAt: null,
            payload: null,
        });

        try {
            const displayPosition = position.trim() || pos;
            const criteria = {
                position: displayPosition,
                location: loc,
                // UI locale drives the AI output language: an Arabic UI must yield an Arabic
                // analysis even when the job title and the CVs themselves are English.
                language: currentLang,
                ...roleResolutionCriteriaFields(roleCatalog),
                ...(yearsExperience ? { yearsOfExperience: yearsExperience } : {}),
                ...(ageRange ? { ageRange } : {}),
                ...(query.trim() ? { query: query.trim() } : {}),
                ...optionalFiltersPayload,
            };

            const formData = new FormData();
            formData.append('criteria', JSON.stringify(criteria));
            for (const file of cvFiles) {
                formData.append('cvs', file, file.name);
            }

            const data = await apiClient.postForm('/api/cv-comparison/compare', formData);
            if (data?.ok && data?.comparisonId) {
                setFeedback({ type: '', text: '' });
                setComparisonId(data.comparisonId);
                startPollForComparison(data.comparisonId);
            } else {
                setFeedback({
                    type: 'error',
                    text: data?.message || t('cvComparisonErrGeneric'),
                });
            }
        } catch (err) {
            const msg = headHunterApiErrorMessage(err, t, { fallbackKey: 'cvComparisonErrSend' });
            setFeedback({ type: 'error', text: msg });
        } finally {
            setLoading(false);
        }
    };

    const showResultsCard =
        Boolean(comparisonId) &&
        (Boolean(resultState.hasData) ||
            Boolean(resultState.error) ||
            awaitingPollResult);

    const compareButtonContent = submitBusy ? (
        <span className="head-hunter-submit-btn__content head-hunter-submit-btn__content--loading">
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
            <span className="ni-generate-ad-loading" aria-live="polite">
                <span className="ni-generate-ad-loading__text">{t('cvComparisonComparing')}</span>
                <span className="ni-generate-ad-loading__dots" aria-hidden="true">
                    <span className="ni-generate-ad-loading__dot" />
                    <span className="ni-generate-ad-loading__dot" />
                    <span className="ni-generate-ad-loading__dot" />
                </span>
            </span>
        </span>
    ) : (
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
            <span className="btn-text">{t('cvComparisonCompare')}</span>
        </span>
    );

    return (
        <div className="dashboard-page dashboard-page--evaalo-visual ai-head-hunter-page ai-cv-comparison-page dashboard-page--full-viewport-shell">
            <div className="design-background design-background--evaalo-visual">
                <div className="design-orb-1" />
                <div className="design-orb-2" />
                <div className="design-orb-3" />
            </div>
            <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
            <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

            <div className="container dashboard-visual-container">
                <div className="dashboard-grid">
                    <div className="dashboard-card dashboard-card--page-active platform-features-card">
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">{t('cvComparisonTitle')}</h2>
                        </div>
                        <div
                            className="dashboard-card-body dashboard-card-body--headhunter-search"
                            role="region"
                            aria-label={t('cvComparisonCriteriaRegion')}
                        >
                            <form onSubmit={handleSubmit}>
                                <div className="head-hunter-form__row2">
                                    <div
                                        className={[
                                            'form-group head-hunter-design-field',
                                            position.trim() ? 'head-hunter-shell--filled' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <label htmlFor="cvcomp-position" className="form-label">
                                            {t('aiHeadHunterPosition')}
                                        </label>
                                        <JobRoleFields
                                            roleKey={roleCatalog.roleKey || ''}
                                            careerLevel={roleCatalog.careerLevel || ''}
                                            researchDomain={roleCatalog.researchDomain || ''}
                                            position={position}
                                            onRoleResolved={handleRoleResolved}
                                            onStateChange={setRoleCatalog}
                                            roleInputId="cvcomp-position"
                                            roleInputName="position"
                                            levelInputId="cvcomp-job-level"
                                            levelInputName="careerLevel"
                                            rolePlaceholder={t('aiHeadHunterPositionPh')}
                                            levelPlaceholder={t('jobRole_level_placeholder')}
                                            roleListboxId="cvcomp-position-suggestions"
                                            disabled={submitBusy}
                                            roleRequired
                                            layout="stacked"
                                            roleInputClassName="form-input"
                                            roleWrapperClassName="head-hunter-suggest-field"
                                            levelWrapperClassName="head-hunter-suggest-field"
                                        />
                                    </div>
                                    <div
                                        className={[
                                            'form-group head-hunter-design-field',
                                            location.trim() ? 'head-hunter-shell--filled' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <label htmlFor="cvcomp-location" className="form-label">
                                            {t('aiHeadHunterLocation')}
                                        </label>
                                        <PositionSuggestCombobox
                                            id="cvcomp-location"
                                            name="location"
                                            className="form-input"
                                            value={location}
                                            onChange={(e) => setLocation(e.target.value)}
                                            placeholder={t('aiHeadHunterLocationPh')}
                                            autoComplete="address-level1"
                                            disabled={submitBusy}
                                            suggestionOptions={HEADHUNTER_LOCATION_SUGGESTION_OPTIONS}
                                            listboxId="cvcomp-location-suggestions"
                                            wrapperClassName="head-hunter-suggest-field"
                                        />
                                    </div>
                                </div>

                                <div className="head-hunter-form__row2">
                                    <div
                                        className={[
                                            'form-group head-hunter-design-field',
                                            yearsExperience ? 'head-hunter-shell--filled' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <label htmlFor="cvcomp-years" className="form-label">
                                            {t('aiHeadHunterYearsLabel')}
                                            <span className="head-hunter-label-muted--design">
                                                {' '}
                                                {t('aiHeadHunterOptional')}
                                            </span>
                                        </label>
                                        <PositionSuggestCombobox
                                            id="cvcomp-years"
                                            name="yearsOfExperience"
                                            className="form-input"
                                            value={yearsExperience}
                                            onChange={(e) => setYearsExperience(e.target.value)}
                                            placeholder={t('aiHeadHunterYearsPh')}
                                            disabled={submitBusy}
                                            suggestionOptions={yearsExperienceChoices}
                                            listboxId="cvcomp-years-listbox"
                                            wrapperClassName="head-hunter-suggest-field"
                                        />
                                    </div>
                                    <div
                                        className={[
                                            'form-group head-hunter-design-field',
                                            ageRange ? 'head-hunter-shell--filled' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <label htmlFor="cvcomp-age" className="form-label">
                                            {t('aiHeadHunterAgeLabel')}
                                            <span className="head-hunter-label-muted--design">
                                                {' '}
                                                {t('aiHeadHunterOptional')}
                                            </span>
                                        </label>
                                        <PositionSuggestCombobox
                                            id="cvcomp-age"
                                            name="ageRange"
                                            className="form-input"
                                            value={ageRange}
                                            onChange={(e) => setAgeRange(e.target.value)}
                                            placeholder={t('aiHeadHunterAgePh')}
                                            disabled={submitBusy}
                                            suggestionOptions={ageRangeChoices}
                                            listboxId="cvcomp-age-listbox"
                                            wrapperClassName="head-hunter-suggest-field"
                                        />
                                    </div>
                                </div>

                                <div
                                    className={[
                                        'form-group head-hunter-design-field',
                                        query.trim() ? 'head-hunter-shell--filled' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <label htmlFor="cvcomp-query" className="form-label">
                                        {t('aiHeadHunterNotes')}{' '}
                                        <span className="head-hunter-label-muted--design">
                                            {t('aiHeadHunterOptional')}
                                        </span>
                                    </label>
                                    <textarea
                                        id="cvcomp-query"
                                        className="form-input"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder={t('aiHeadHunterNotesPh')}
                                        rows={4}
                                        disabled={submitBusy}
                                    />
                                </div>

                                <div
                                    className="cv-comp-additional-filters"
                                    role="group"
                                    aria-label={t('aiHeadHunterAdditionalFilters')}
                                >
                                    <span className="form-label cv-comp-additional-filters__heading" id="cvcomp-additional-filters-label">
                                        {t('aiHeadHunterAdditionalFilters')}
                                    </span>
                                    <div
                                        className="cv-comp-optional-filters"
                                        aria-labelledby="cvcomp-additional-filters-label"
                                    >
                                        {CV_COMPARISON_OPTIONAL_FILTER_FIELDS.map(({ key, labelKey, placeholderKey }) => {
                                            const row = optionalFilters[key];
                                            const inputId = `cvcomp-filter-${key}`;
                                            return (
                                                <div
                                                    key={key}
                                                    className={[
                                                        'cv-comp-optional-filter-expand',
                                                        row.enabled ? 'cv-comp-optional-filter-expand--open' : '',
                                                        row.enabled && row.value.trim()
                                                            ? 'cv-comp-optional-filter-expand--filled'
                                                            : '',
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                >
                                                    <div className="cv-comp-optional-filter-expand__toggle">
                                                        <label className="checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={row.enabled}
                                                                onChange={(e) =>
                                                                    setOptionalFilters((prev) => ({
                                                                        ...prev,
                                                                        [key]: {
                                                                            enabled: e.target.checked,
                                                                            value: e.target.checked
                                                                                ? prev[key].value
                                                                                : '',
                                                                        },
                                                                    }))
                                                                }
                                                                disabled={submitBusy}
                                                            />
                                                            <span className="checkmark" aria-hidden="true" />
                                                            <span className="form-label cv-comp-optional-filter-expand__title">
                                                                {t(labelKey)}
                                                            </span>
                                                        </label>
                                                    </div>
                                                    {row.enabled ? (
                                                        <div className="cv-comp-optional-filter-expand__body">
                                                            {optionalFilterUsesCombobox(key) ? (
                                                                <PositionSuggestCombobox
                                                                    id={inputId}
                                                                    name={key}
                                                                    className="form-input"
                                                                    value={row.value}
                                                                    onChange={(e) =>
                                                                        setOptionalFilters((prev) => ({
                                                                            ...prev,
                                                                            [key]: {
                                                                                ...prev[key],
                                                                                value: e.target.value,
                                                                            },
                                                                        }))
                                                                    }
                                                                    placeholder={t(placeholderKey)}
                                                                    disabled={submitBusy}
                                                                    autoComplete="off"
                                                                    suggestionOptions={
                                                                        optionalFilterSuggestionOptions[key]
                                                                    }
                                                                    listboxId={`${inputId}-listbox`}
                                                                    wrapperClassName="head-hunter-suggest-field"
                                                                />
                                                            ) : (
                                                                <input
                                                                    id={inputId}
                                                                    type="text"
                                                                    className="form-input"
                                                                    value={row.value}
                                                                    onChange={(e) =>
                                                                        setOptionalFilters((prev) => ({
                                                                            ...prev,
                                                                            [key]: {
                                                                                ...prev[key],
                                                                                value: e.target.value,
                                                                            },
                                                                        }))
                                                                    }
                                                                    placeholder={t(placeholderKey)}
                                                                    aria-label={t(labelKey)}
                                                                    disabled={submitBusy}
                                                                    autoComplete="off"
                                                                />
                                                            )}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <CvUploadZone
                                    files={cvFiles}
                                    onChange={handleCvFilesChange}
                                    onNotice={showValidationNotice}
                                    disabled={submitBusy}
                                />

                                {feedback.text ? (
                                    <p
                                        role="status"
                                        className={`head-hunter-feedback ${
                                            feedback.type === 'ok'
                                                ? 'head-hunter-feedback--ok'
                                                : 'head-hunter-feedback--err'
                                        }`}
                                    >
                                        {feedback.text}
                                    </p>
                                ) : null}

                                <div className="head-hunter-actions">
                                    <button
                                        type="submit"
                                        className="workflow-btn-primary head-hunter-submit-btn"
                                        disabled={submitBusy}
                                    >
                                        {compareButtonContent}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    {showResultsCard ? (
                        <div className="dashboard-card dashboard-card--page-active platform-features-card dashboard-card--headhunter-results">
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">{t('cvComparisonResultsRegion')}</h2>
                            </div>
                            <div
                                className="dashboard-card-body dashboard-card-body--headhunter-results"
                                role="region"
                                aria-label={t('cvComparisonResultsRegion')}
                            >
                                <CvComparisonResultsWorkspace
                                    payload={resultState.payload}
                                    receivedAt={resultState.receivedAt}
                                    loading={awaitingPollResult && !resultState.hasData}
                                    error={resultState.error}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <ScreeningAiCompareNeedTwoNotice
                open={validationNotice.open}
                onDismiss={() => setValidationNotice({ open: false, description: '' })}
                t={t}
                titleKey="cvComparisonTitle"
                description={validationNotice.description}
            />
        </div>
    );
}
