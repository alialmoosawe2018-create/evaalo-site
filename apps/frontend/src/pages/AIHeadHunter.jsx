import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { onEvent, startEventsSocket } from '../services/eventsSocket';
import { headHunterApiErrorMessage } from '../utils/headHunterApiError.js';
import { useLanguage } from '../contexts/LanguageContext';
import SuggestSearchCriteriaButton from '../components/SuggestSearchCriteriaButton';
import { useOrganization } from '../contexts/OrganizationContext';
import { PERMISSIONS } from '../contexts/rbacRoles';
import PositionSuggestCombobox from '../components/PositionSuggestCombobox.jsx';
import { useHeadHunterPersistence } from '../hooks/useHeadHunterPersistence.js';
import { useHeadHunterSearchHistory } from '../hooks/useHeadHunterSearchHistory.js';
import { normalizeHeadHunterPayload } from '../utils/headHunterNormalize.js';
import HeadHunterResultsWorkspace from '../components/headhunter/HeadHunterResultsWorkspace.jsx';
import JobRoleFields from '../components/JobRoleFields.jsx';
import { mergeRoleResolution, roleResolutionCriteriaFields } from '../utils/jobCatalogRole.js';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { isArabicText } from '../utils/textScript.js';
import {
    OPTIONAL_FILTER_FIELDS,
    buildOptionalFiltersPayload,
    createInitialOptionalFilters,
    findEnabledOptionalFilterMissingValue,
} from '../utils/headHunterOptionalFilters.js';
import {
    buildOptionalFilterSuggestionOptions,
    optionalFilterUsesCombobox,
} from '../utils/optionalFilterSuggestionOptions.js';
import '../design-styles.css';

/** خيارات مقترحة للموقع — لا تزال متاحة الكتابة الحرة */
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

/** Search depth tier sent to n8n (controls Serp/enrich depth, not send cap) */
const MIN_CANDIDATE_COUNT_OPTIONS = [20, 40];

/**
 * تقدير مدة البحث من اختبارات tier 20/40 (streaming + توسيع المرحلة 2 لـ 40).
 * — أكثر من 20: عمق خفيف (~4 Serp / حتى 35 enrich) — أول ظهور خلال ~دقيقة، اكتمال ~٢–٤.
 * — أكثر من 40: عمق أكبر + توسيع تلقائي إن نقص العدد — اكتمال غالباً ~٦–١٢ دقيقة.
 */
const HEADHUNTER_SEARCH_ETA_BY_TIER = {
    20: { minutesMin: 2, minutesMax: 4 },
    40: { minutesMin: 4, minutesMax: 7 },
};

function getHeadHunterSearchEta(minCount) {
    return HEADHUNTER_SEARCH_ETA_BY_TIER[minCount] || HEADHUNTER_SEARCH_ETA_BY_TIER[20];
}

const POLL_INTERVAL_MS = 1000;
/** n8n قد يستغرق عدة دقائق قبل أول مرشح — ~10 دقائق كحد أقصى */
const POLL_MAX_ATTEMPTS = 600;

/**
 * AI Head Hunter — بحث إلى n8n وعرض نتائج كبطاقات + لوحة تفاصيل.
 */
export default function AIHeadHunter() {
    const { t, currentLang } = useLanguage();
    const { hasPermission } = useOrganization();
    const canSearchHeadHunter = hasPermission(PERMISSIONS.HEADHUNTER_SEARCH);
    const hh = useHeadHunterPersistence();
    const { upsertBySearchId: upsertCampaignBySearchId } = useHeadHunterSearchHistory();
    const pollTimerRef = useRef(null);
    const activeSearchIdRef = useRef(null);
    const resultsCardRef = useRef(null);
    /** يبقي زر البحث بحالة التحميل/المؤثرات حتى ينتهي استطلاع النتيجة وليس فقط حتى انتهاء طلب الويب هوك */
    const [awaitingPollResult, setAwaitingPollResult] = useState(false);

    const [position, setPosition] = useState('');
    const [roleCatalog, setRoleCatalog] = useState({});
    const [location, setLocation] = useState('');
    const [yearsExperience, setYearsExperience] = useState('');
    const [ageRange, setAgeRange] = useState('');
    const [query, setQuery] = useState('');
    const [minCandidateCount, setMinCandidateCount] = useState(20);
    const [optionalFilters, setOptionalFilters] = useState(createInitialOptionalFilters);
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState({ type: '', text: '' });
    const [searchId, setSearchId] = useState(null);

    const [n8nInbound, setN8nInbound] = useState({
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
                setAwaitingPollResult(false);
            }
        },
        [],
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

    /**
     * Sourcing runs against LinkedIn profiles, which are overwhelmingly written in
     * English — Arabic free text narrows the match pool. Picking from the suggestion
     * lists stores the English value, so only hand-typed Arabic trips this.
     */
    const hasArabicSearchInput = useMemo(() => {
        const typed = [position, location, query];
        for (const { key } of OPTIONAL_FILTER_FIELDS) {
            const row = optionalFilters[key];
            if (row?.enabled) typed.push(row.value);
        }
        return typed.some(isArabicText);
    }, [position, location, query, optionalFilters]);

    const optionalFilterSuggestionOptions = useMemo(
        () => buildOptionalFilterSuggestionOptions(t, currentLang),
        [t, currentLang]
    );

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    /** يوقف الـ polling فقط (بدون تغيير حالة واجهة زر البحث) لاستخدامه قبل بدء دورة polling جديدة */
    const clearPollTimerOnly = useCallback(() => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const stopPollForNewResult = useCallback(() => {
        clearPollTimerOnly();
        setAwaitingPollResult(false);
    }, [clearPollTimerOnly]);

    const fetchLastN8nResult = useCallback(
        async (id, { quiet = false } = {}) => {
            if (!id) return { success: false };
            if (!quiet) {
                setN8nInbound((prev) => ({ ...prev, loading: true, error: '' }));
            }
            try {
                const data = await apiClient.get(
                    `/api/head-hunter/last-result?searchId=${encodeURIComponent(id)}`
                );
                const next = {
                    loading: false,
                    error: '',
                    hasData: Boolean(data?.hasData),
                    status: data?.status ?? null,
                    receivedAt: data?.receivedAt ?? null,
                    payload: data?.payload ?? null,
                };
                setN8nInbound(next);
                return {
                    success: true,
                    ...next,
                };
            } catch (err) {
                const msg = headHunterApiErrorMessage(err, t, { fallbackKey: 'aiHeadHunterErrLoadN8n' });
                if (!quiet) {
                    setN8nInbound((prev) => ({ ...prev, loading: false, error: msg }));
                }
                return { success: false, error: msg };
            }
        },
        [t]
    );

    const syncCampaignHistory = useCallback(
        (criteria, res) => {
            if (!res?.receivedAt || !criteria?.searchId) return;
            const entry = {
                position: criteria.position,
                location: criteria.location,
                ...(criteria.yearsExperience ? { yearsExperience: criteria.yearsExperience } : {}),
                ...(criteria.ageRange ? { ageRange: criteria.ageRange } : {}),
                ...(criteria.query ? { query: criteria.query } : {}),
                ...(criteria.minCandidateCount ? { minCandidateCount: criteria.minCandidateCount } : {}),
                ...buildOptionalFiltersPayload(criteria.optionalFilters ?? {}),
                searchId: criteria.searchId,
                receivedAt: res.receivedAt,
                payload: res.payload ?? null,
            };
            upsertCampaignBySearchId(entry);
        },
        [upsertCampaignBySearchId]
    );

    const startPollForNewResult = useCallback(
        (id, criteria) => {
            clearPollTimerOnly();
            activeSearchIdRef.current = id;
            let attempts = 0;
            let lastSyncedCount = 0;

            const pollOnce = async () => {
                if (activeSearchIdRef.current !== id) {
                    stopPollForNewResult();
                    return;
                }
                attempts += 1;
                const res = await fetchLastN8nResult(id, { quiet: true });
                if (!res.success) {
                    if (attempts >= POLL_MAX_ATTEMPTS) stopPollForNewResult();
                    return;
                }

                if (res.status === 'failed') {
                    setN8nInbound((prev) => ({
                        ...prev,
                        error: res.errorMessage || t('aiHeadHunterResultsEmpty'),
                    }));
                    stopPollForNewResult();
                    return;
                }

                /** عرض تدريجي: أول مرشح يكفي لإيقاف الانتظار وعرض النتائج */
                if (res.hasData) {
                    setAwaitingPollResult(false);
                    const nCandidates = normalizeHeadHunterPayload(res.payload).candidates.length;
                    if (nCandidates > lastSyncedCount) {
                        syncCampaignHistory(criteria, res);
                        lastSyncedCount = nCandidates;
                    }
                    if (res.status === 'completed' || attempts >= POLL_MAX_ATTEMPTS) {
                        clearPollTimerOnly();
                    }
                    return;
                }

                if (res.status === 'completed' && !res.hasData) {
                    setN8nInbound((prev) => ({
                        ...prev,
                        error: res.errorMessage || t('aiHeadHunterResultsEmpty'),
                    }));
                    stopPollForNewResult();
                    return;
                }

                if (attempts >= POLL_MAX_ATTEMPTS) {
                    setN8nInbound((prev) => ({
                        ...prev,
                        error: prev.error || t('aiHeadHunterResultsEmpty'),
                    }));
                    stopPollForNewResult();
                }
            };

            void pollOnce();
            pollTimerRef.current = window.setInterval(() => {
                void pollOnce();
            }, POLL_INTERVAL_MS);
            setAwaitingPollResult(true);
        },
        [clearPollTimerOnly, fetchLastN8nResult, syncCampaignHistory, stopPollForNewResult, t]
    );

    // Live: finish instantly + stop the tail poll when the search reaches a terminal
    // state. Progressive streaming still uses the poll; this just accelerates the end.
    useEffect(() => {
        startEventsSocket();
        return onEvent('HeadHunterSearchCompleted', (evt) => {
            const id = activeSearchIdRef.current;
            if (id && evt?.payload?.searchId === id) {
                void fetchLastN8nResult(id);
                stopPollForNewResult();
            }
        });
    }, [fetchLastN8nResult, stopPollForNewResult]);

    /** بطاقة النتائج: لا تُعرض إلا بعد بدء بحث لهذا المستخدم */
    const showHeadHunterResultsCard =
        Boolean(searchId) &&
        (Boolean(n8nInbound.hasData) ||
            Boolean(n8nInbound.error && String(n8nInbound.error).trim()) ||
            n8nInbound.status === 'failed' ||
            awaitingPollResult);

    const submitBusy = loading || awaitingPollResult;

    // مؤشّر «خطوات عمل الوكيل» في مساحة النتائج يظهر أثناء `loading`، لكن تقدّم البحث
    // الحيّ يُتتبَّع بـ`awaitingPollResult` (الاستطلاع صامت لا يرفع loading). ندمج
    // الإشارتين حتى تظهر الخطوات طوال انتظار نتيجة n8n، لا أن تُعرض النتائج مباشرة.
    const n8nInboundView = useMemo(
        () => ({ ...n8nInbound, loading: n8nInbound.loading || awaitingPollResult }),
        [n8nInbound, awaitingPollResult]
    );

    const searchContext = useMemo(
        () => ({ position, location, yearsExperience, ageRange, query }),
        [position, location, yearsExperience, ageRange, query],
    );

    useEffect(() => {
        if (!searchId || !awaitingPollResult) return;
        requestAnimationFrame(() => {
            resultsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }, [searchId, awaitingPollResult]);

    const handleRoleResolved = useCallback((resolution) => {
        setRoleCatalog((prev) => mergeRoleResolution(prev, resolution));
        if (resolution?.displayTitle) {
            setPosition(resolution.displayTitle);
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFeedback({ type: '', text: '' });
        const pos = position.trim();
        const loc = location.trim();
        if (!String(roleCatalog.roleKey || pos).trim() || !loc) {
            setFeedback({ type: 'error', text: t('aiHeadHunterErrPositionLocation') });
            return;
        }
        const optionalFilterError = findEnabledOptionalFilterMissingValue(optionalFilters, t);
        if (optionalFilterError) {
            setFeedback({ type: 'error', text: optionalFilterError });
            return;
        }
        const optionalFiltersPayload = buildOptionalFiltersPayload(optionalFilters);
        setLoading(true);
        stopPollForNewResult();
        setSearchId(null);
        setN8nInbound({
            loading: false,
            error: '',
            hasData: false,
            status: null,
            receivedAt: null,
            payload: null,
        });

        try {
            const displayPosition = position.trim() || pos;
            const payload = {
                position: displayPosition,
                location: loc,
                ...roleResolutionCriteriaFields(roleCatalog),
                ...(yearsExperience ? { yearsOfExperience: yearsExperience } : {}),
                ...(ageRange ? { ageRange } : {}),
                ...(query.trim() ? { query: query.trim() } : {}),
                minCandidateCount,
                ...optionalFiltersPayload,
            };
            const data = await apiClient.post('/api/head-hunter/search', payload);
            if (data?.ok && data?.searchId) {
                setFeedback({ type: '', text: '' });
                const criteria = {
                    searchId: data.searchId,
                    position: displayPosition,
                    location: loc,
                    ...roleResolutionCriteriaFields(roleCatalog),
                    ...(yearsExperience ? { yearsExperience } : {}),
                    ...(ageRange ? { ageRange } : {}),
                    ...(query.trim() ? { query: query.trim() } : {}),
                    minCandidateCount,
                    optionalFilters,
                };
                setSearchId(data.searchId);
                startPollForNewResult(data.searchId, criteria);
            } else {
                setFeedback({ type: 'error', text: data?.message || t('aiHeadHunterErrGeneric') });
            }
        } catch (err) {
            const msg = headHunterApiErrorMessage(err, t, { fallbackKey: 'aiHeadHunterErrSend' });
            setFeedback({ type: 'error', text: msg });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="dashboard-page dashboard-page--evaalo-visual ai-head-hunter-page dashboard-page--full-viewport-shell"
            style={{ color: '#ffffff', position: 'relative' }}
        >
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
                            <h2 className="dashboard-card-title">{t('dashboardSvc_headhunter')}</h2>
                            <div className="header-actions">
                                <Link
                                    to="/ai-head-hunter/search-history"
                                    className="btn btn-secondary candidates-toolbar-filter-btn"
                                    style={{ textDecoration: 'none' }}
                                    title={t('aiHeadHunterSearchHistoryButton')}
                                    aria-label={t('aiHeadHunterSearchHistoryButton')}
                                >
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden
                                    >
                                        <path
                                            d="M3 12a9 9 0 1 0 3.2-6.96"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                        />
                                        <path
                                            d="M3 4v5h5"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                        <path
                                            d="M12 7v5l4 2"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <span className="btn-text">{t('aiHeadHunterSearchHistoryButton')}</span>
                                </Link>
                            </div>
                        </div>
                        <div
                            className="dashboard-card-body dashboard-card-body--headhunter-search"
                            role="region"
                            aria-label={t('aiHeadHunterSearchCriteriaRegion')}
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
                                            <label htmlFor="headhunter-position" className="form-label">
                                                {t('aiHeadHunterPosition')}
                                            </label>
                                            <JobRoleFields
                                                roleKey={roleCatalog.roleKey || ''}
                                                careerLevel={roleCatalog.careerLevel || ''}
                                                researchDomain={roleCatalog.researchDomain || ''}
                                                position={position}
                                                onRoleResolved={handleRoleResolved}
                                                onStateChange={setRoleCatalog}
                                                roleInputId="headhunter-position"
                                                roleInputName="position"
                                                levelInputId="headhunter-job-level"
                                                levelInputName="careerLevel"
                                                rolePlaceholder={t('aiHeadHunterPositionPh')}
                                                levelPlaceholder={t('jobRole_level_placeholder')}
                                                roleListboxId="headhunter-position-suggestions"
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
                                            <label htmlFor="headhunter-location" className="form-label">
                                                {t('aiHeadHunterLocation')}
                                            </label>
                                            <PositionSuggestCombobox
                                                id="headhunter-location"
                                                name="location"
                                                className="form-input"
                                                value={location}
                                                onChange={(e) => setLocation(e.target.value)}
                                                placeholder={t('aiHeadHunterLocationPh')}
                                                autoComplete="address-level1"
                                                disabled={submitBusy}
                                                suggestionOptions={HEADHUNTER_LOCATION_SUGGESTION_OPTIONS}
                                                listboxId="headhunter-location-suggestions"
                                                wrapperClassName="head-hunter-suggest-field"
                                                showResolutionHint={false}
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
                                            <label htmlFor="headhunter-years-experience" className="form-label">
                                                {t('aiHeadHunterYearsLabel')}
                                                <span className="head-hunter-label-muted--design">
                                                    {' '}
                                                    {t('aiHeadHunterOptional')}
                                                </span>
                                            </label>
                                            <PositionSuggestCombobox
                                                id="headhunter-years-experience"
                                                name="yearsOfExperience"
                                                className="form-input"
                                                value={yearsExperience}
                                                onChange={(e) => setYearsExperience(e.target.value)}
                                                placeholder={t('aiHeadHunterYearsPh')}
                                                disabled={submitBusy}
                                                suggestionOptions={yearsExperienceChoices}
                                                listboxId="headhunter-years-experience-listbox"
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
                                            <label htmlFor="headhunter-age-range" className="form-label">
                                                {t('aiHeadHunterAgeLabel')}
                                                <span className="head-hunter-label-muted--design">
                                                    {' '}
                                                    {t('aiHeadHunterOptional')}
                                                </span>
                                            </label>
                                            <PositionSuggestCombobox
                                                id="headhunter-age-range"
                                                name="ageRange"
                                                className="form-input"
                                                value={ageRange}
                                                onChange={(e) => setAgeRange(e.target.value)}
                                                placeholder={t('aiHeadHunterAgePh')}
                                                disabled={submitBusy}
                                                suggestionOptions={ageRangeChoices}
                                                listboxId="headhunter-age-range-listbox"
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
                                        <label htmlFor="headhunter-query" className="form-label">
                                            {t('aiHeadHunterNotes')}{' '}
                                            <span className="head-hunter-label-muted--design">
                                                {t('aiHeadHunterOptional')}
                                            </span>
                                        </label>
                                        <textarea
                                            id="headhunter-query"
                                            className="form-input"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder={t('aiHeadHunterNotesPh')}
                                            rows={4}
                                            disabled={submitBusy}
                                        />
                                    </div>

                                    <div
                                        className="form-group head-hunter-design-field head-hunter-checkbox-field"
                                        role="group"
                                        aria-label={t('aiHeadHunterAdditionalFilters')}
                                    >
                                        <span className="form-label" id="headhunter-additional-filters-label">
                                            {t('aiHeadHunterAdditionalFilters')}
                                        </span>
                                        <SuggestSearchCriteriaButton
                                            endpoint="/api/head-hunter/suggest-criteria"
                                            position={position}
                                            location={location}
                                            onApply={(criteria) =>
                                                setOptionalFilters((prev) => {
                                                    const next = { ...prev };
                                                    for (const [key, value] of Object.entries(criteria)) {
                                                        if (next[key] && typeof value === 'string' && value.trim()) {
                                                            next[key] = { enabled: true, value: value.trim() };
                                                        }
                                                    }
                                                    return next;
                                                })
                                            }
                                        />
                                        <div
                                            className="head-hunter-optional-filters"
                                            aria-labelledby="headhunter-additional-filters-label"
                                        >
                                            {OPTIONAL_FILTER_FIELDS.map(({ key, labelKey, placeholderKey }) => {
                                                const row = optionalFilters[key];
                                                const inputId = `headhunter-filter-${key}`;
                                                return (
                                                    <div
                                                        key={key}
                                                        className={[
                                                            'head-hunter-optional-filter-expand',
                                                            row.enabled
                                                                ? 'head-hunter-optional-filter-expand--open'
                                                                : '',
                                                            row.enabled && row.value.trim()
                                                                ? 'head-hunter-optional-filter-expand--filled'
                                                                : '',
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                    >
                                                        <div className="head-hunter-optional-filter-expand__toggle">
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
                                                                <span className="form-label head-hunter-optional-filter-expand__title">
                                                                    {t(labelKey)}
                                                                </span>
                                                            </label>
                                                        </div>
                                                        {row.enabled ? (
                                                            <div className="head-hunter-optional-filter-expand__body">
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

                                    <div
                                        className="form-group head-hunter-design-field head-hunter-checkbox-field head-hunter-options-field"
                                        role="group"
                                        aria-label={t('aiHeadHunterSearchOptionsAria')}
                                    >
                                        <span className="form-label" id="headhunter-options-label">
                                            {t('aiHeadHunterOptions')}
                                        </span>
                                        <span
                                            className="head-hunter-options-sublabel"
                                            id="headhunter-min-count-label"
                                        >
                                            {t('aiHeadHunterMinCandidateCount')}
                                        </span>
                                        <div
                                            className="head-hunter-checkbox-group head-hunter-checkbox-group--pair"
                                            role="radiogroup"
                                            aria-labelledby="headhunter-min-count-label"
                                        >
                                            {MIN_CANDIDATE_COUNT_OPTIONS.map((n) => (
                                                <label key={n} className="checkbox-label">
                                                    <input
                                                        type="radio"
                                                        name="headhunter-min-candidate-count"
                                                        checked={minCandidateCount === n}
                                                        onChange={() => setMinCandidateCount(n)}
                                                        disabled={submitBusy}
                                                    />
                                                    <span className="checkmark" aria-hidden="true" />
                                                    <span>
                                                        {fillI18nTemplate(t('aiHeadHunterMoreThanCandidates'), {
                                                            n,
                                                        })}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {hasArabicSearchInput ? (
                                        <p
                                            role="status"
                                            aria-live="polite"
                                            className="head-hunter-feedback head-hunter-feedback--warn"
                                        >
                                            <svg
                                                className="head-hunter-feedback__icon"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                aria-hidden="true"
                                            >
                                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                                                <path
                                                    d="M12 8v5"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                />
                                                <circle cx="12" cy="16.25" r="1.15" fill="currentColor" />
                                            </svg>
                                            <span>{t('aiHeadHunterArabicInputWarning')}</span>
                                        </p>
                                    ) : null}

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
                                            disabled={submitBusy || !canSearchHeadHunter}
                                            title={!canSearchHeadHunter ? t('rbacPermissionDenied') : undefined}
                                        >
                                            {submitBusy ? (
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
                                                        <span className="ni-generate-ad-loading__text">
                                                            {t('aiHeadHunterSearching')}
                                                        </span>
                                                        <span
                                                            className="ni-generate-ad-loading__dots"
                                                            aria-hidden="true"
                                                        >
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
                                                    <span className="btn-text">{t('aiHeadHunterSearch')}</span>
                                                </span>
                                            )}
                                        </button>
                                        {submitBusy ? (
                                            <p
                                                className="head-hunter-eta"
                                                role="status"
                                                aria-live="polite"
                                            >
                                                {fillI18nTemplate(t('aiHeadHunterSearchEta'), {
                                                    min: getHeadHunterSearchEta(minCandidateCount).minutesMin,
                                                    max: getHeadHunterSearchEta(minCandidateCount).minutesMax,
                                                })}
                                                {minCandidateCount >= 40
                                                    ? ` ${t('aiHeadHunterSearchEtaHint40')}`
                                                    : ` ${t('aiHeadHunterSearchEtaHint20')}`}
                                            </p>
                                        ) : null}
                                    </div>
                                </form>
                        </div>
                    </div>

                    {showHeadHunterResultsCard ? (
                        <div
                            ref={resultsCardRef}
                            className="dashboard-card dashboard-card--page-active platform-features-card dashboard-card--headhunter-results"
                        >
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">{t('aiHeadHunterResultsRegion')}</h2>
                            </div>
                            <div
                                className="dashboard-card-body dashboard-card-body--headhunter-results"
                                role="region"
                                aria-label={t('aiHeadHunterResultsRegion')}
                            >
                                <div className="headhunter-discovery">
                                    <div className="headhunter-discovery__main">
                                        <HeadHunterResultsWorkspace
                                            hh={hh}
                                            n8nInbound={n8nInboundView}
                                            searchContext={searchContext}
                                            t={t}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
