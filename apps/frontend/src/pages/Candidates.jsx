import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import {
    PdfCvLink,
    candidateAvatarImageProps,
    candidateCertificates,
    candidateCvFileName,
    candidateCvUrl,
    candidatePhotoUrl,
    GenderAvatar,
    inferGenderFromName,
    shouldUseGenderAvatar,
} from '../utils/candidateAssets';
import { apiClient } from '../services/apiClient';
import { getCached, setCached, hasCached } from '../utils/swrCache';
import { useAuth } from '../contexts/AuthContext';
import { getUserStorageKeySuffix, userScopedStorageKey } from '../utils/userStorageKey';
import PositionSuggestCombobox from '../components/PositionSuggestCombobox.jsx';
import HiringOutcomeCell from '../components/HiringOutcomeCell';
import { YEARS_OF_EXPERIENCE_OPTIONS } from '../constants/yearsOfExperienceOptions.js';
import { HIGHEST_EDUCATION_OPTIONS } from '../constants/educationLevelOptions.js';
import '../design-styles.css';
import { useLanguage } from '../contexts/LanguageContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { PERMISSIONS } from '../contexts/rbacRoles';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { onHorizontalDragScrollPointerDown } from '../utils/candidatesHorizontalDragScroll.js';
import CandidatesStoredLedgerPanel from '../components/CandidatesStoredLedgerPanel.jsx';
import MobilePinchPanViewport from '../components/MobilePinchPanViewport.jsx';
import { mergeIntoPool, candidateToChartEmp } from '../utils/chartCandidatePool.js';
import { localizeCatalogLabel } from '../utils/localizeCatalogLabel.js';
import { buildSampleCandidates } from '../utils/demoSampleData.js';
import { scriptTextProps } from '../utils/textScript.js';
import { resolveCandidateEvaluation, evaluationSourceLabelKey } from '../utils/candidateEvaluation.js';
import { stageRecommendationLabel } from '../utils/stageRecommendation.js';
import { resolveJobRole } from '@evaalo/job-catalog';

/** يبقى بعد مغادرة الصفحة — محتويات تبويب «قائمة قصيرة» (ليست مخطط /employees) */
const EMPLOYEES_PANEL_STORAGE_KEY = 'candidates-employees-panel-v1';

/** لوحة الموظفين المعروضة ضمن المرشحين — ترقية من القائمة القصيرة */
const ROSTER_EMPLOYEES_STORAGE_KEY = 'candidates-roster-employees-v1';

/** list | secondary (قائمة قصيرة) | employees — يُستعاد عند الرجوع لـ /candidates */
const CANDIDATES_PANEL_TAB_STORAGE_KEY = 'candidates-panel-tab-v1';

function readStoredCandidatesPanelTab() {
    try {
        if (typeof localStorage === 'undefined') return 'list';
        const raw = localStorage.getItem(userScopedStorageKey(CANDIDATES_PANEL_TAB_STORAGE_KEY));
        if (raw === 'list' || raw === 'secondary' || raw === 'employees') return raw;
    } catch (_) {
        /* ignore */
    }
    return 'list';
}

function readStoredRosterEmployeesRecords() {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(userScopedStorageKey(ROSTER_EMPLOYEES_STORAGE_KEY));
        if (raw == null || raw === '') return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function readStoredEmployeesPanelRecords() {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(userScopedStorageKey(EMPLOYEES_PANEL_STORAGE_KEY));
        if (raw == null || raw === '') return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Clear All أسفل لوحة الفلتر — نفس مقياس زر الثانوي */
const filterPanelActionBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.2,
    minHeight: 0,
};

function normalizeStoredGender(raw) {
    const x = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (!x) return '';
    if (x === 'male' || x === 'm' || x.startsWith('male')) return 'male';
    if (x === 'female' || x === 'f' || x.startsWith('female')) return 'female';
    return x;
}

function candidateMatchesGenderFilter(filterVal, candidateGender) {
    if (!filterVal || filterVal === 'all') return true;
    const f = String(filterVal).trim().toLowerCase();
    const gNorm = normalizeStoredGender(candidateGender);
    if (f === 'male' || f === 'female') {
        return gNorm === f;
    }
    const gRaw = String(candidateGender || '').toLowerCase();
    return gRaw.includes(f);
}

function parseExperienceYears(raw) {
    if (raw == null || raw === '') return null;
    const m = String(raw).trim().match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function candidateMatchesExperienceFilter(filterVal, candidateYears) {
    if (!filterVal) return true;
    const y = parseExperienceYears(candidateYears);
    const bucketChecks = {
        '0-1': () => y != null && y >= 0 && y < 2,
        '2-3': () => y != null && y >= 2 && y < 4,
        '4-5': () => y != null && y >= 4 && y < 6,
        '6-10': () => y != null && y >= 6 && y < 10,
        '10+': () => y != null && y >= 10,
    };
    if (Object.prototype.hasOwnProperty.call(bucketChecks, filterVal)) {
        return bucketChecks[filterVal]();
    }
    const hay = String(candidateYears || '').toLowerCase();
    return hay.includes(String(filterVal).toLowerCase());
}

function candidateMatchesEducationFilter(filterVal, candidateEdu) {
    if (!filterVal) return true;
    const opt = HIGHEST_EDUCATION_OPTIONS.find((o) => o.value === filterVal);
    if (opt) {
        const h = String(candidateEdu || '').toLowerCase();
        const needle = opt.label.toLowerCase();
        return h.includes(needle) || h.includes(opt.value);
    }
    const h = String(candidateEdu || '').toLowerCase();
    return h.includes(String(filterVal).toLowerCase());
}

function candidatePrimaryId(candidate) {
    if (!candidate) return null;
    const raw = candidate._id ?? candidate.id;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') {
        if (typeof raw.$oid === 'string') return raw.$oid;
        if (typeof raw.toHexString === 'function') {
            try {
                return raw.toHexString();
            } catch (_) {
                /* ignore */
            }
        }
        return null;
    }
    return raw;
}

/** رقم (عيّنة) مقابل سلسلة (Mongo)، إلخ */
function idsMatch(storedSelectedId, rowId) {
    if (storedSelectedId === rowId) return true;
    if (storedSelectedId == null || rowId == null) return false;
    return String(storedSelectedId) === String(rowId);
}

/** مفتاح واحد لمعرّف مخزَّن في الحالة (متسق مع candidatePrimaryId للصفوف). */
function selectionIdToKey(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') {
        if (typeof raw.$oid === 'string') return raw.$oid;
        if (typeof raw.toHexString === 'function') {
            try {
                return raw.toHexString();
            } catch (_) {
                /* ignore */
            }
        }
        return null;
    }
    return String(raw);
}

function isValidCandidateMongoId(id) {
    const s = String(id ?? '').trim();
    return /^[a-f\d]{24}$/i.test(s);
}

const Candidates = () => {
    const navigate = useNavigate();
    const { t, currentLang } = useLanguage();
    const { user } = useAuth();
    const userKey = user?.id || user?.email || getUserStorageKeySuffix();
    const { hasPermission } = useOrganization();

    const sampleCandidates = useMemo(() => buildSampleCandidates(t), [t]);
    // Reserved for future More actions → Danger Zone (permanent delete)
    const canDeleteCandidates = hasPermission(PERMISSIONS.CANDIDATE_DELETE);
    void canDeleteCandidates;
    const canWriteCandidates = hasPermission(PERMISSIONS.CANDIDATE_WRITE);
    const [candidates, setCandidates] = useState(() => getCached(`candidates:list:${userKey}`) ?? []);
    const [loading, setLoading] = useState(() => !hasCached(`candidates:list:${userKey}`));
    const [error, setError] = useState(null);
    const [selectedCandidates, setSelectedCandidates] = useState([]);
    const [selectedEmployees, setSelectedEmployees] = useState([]);
    const [selectedRosterEmployees, setSelectedRosterEmployees] = useState([]);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [filters, setFilters] = useState({
        name: '',
        status: '',
        position: '',
        experience: '',
        education: '',
        gender: '',
    });
    const [selectedCandidateDetails, setSelectedCandidateDetails] = useState(null);
    const [showCandidateModal, setShowCandidateModal] = useState(false);
    /** قائمة المرشحين مقابل لوحة ثانوية داخل نفس الصفحة */
    const [candidatesPanel, setCandidatesPanel] = useState(readStoredCandidatesPanelTab);

    /** Reflect a recorded decision immediately, without refetching the whole board. */
    const applyHiringOutcome = useCallback((applicationId, hiringOutcome) => {
        setCandidates((prev) =>
            prev.map((c) => {
                const cid = c._id || c.id;
                return String(cid) === String(applicationId) ? { ...c, hiringOutcome } : c;
            })
        );
    }, []);
    /** لوحة Employees — تُحمَّل من localStorage وتحفظ تلقائياً */
    const [employeesPanelRecords, setEmployeesPanelRecords] = useState(readStoredEmployeesPanelRecords);
    const [rosterEmployeesRecords, setRosterEmployeesRecords] = useState(readStoredRosterEmployeesRecords);
    /** عند عرض SAMPLE فقط — معرفات أُخفيت محلياً بعد Clear from list */
    const [hiddenSampleIds, setHiddenSampleIds] = useState([]);
    const [clearModalOpen, setClearModalOpen] = useState(false);
    const [clearSubmitting, setClearSubmitting] = useState(false);
    const [clearError, setClearError] = useState('');
    const [photoUploading, setPhotoUploading] = useState(false);
    const [photoUploadError, setPhotoUploadError] = useState(null);
    const photoInputRef = useRef(null);

    const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
    const PHOTO_ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    const handleModalPhotoUpload = useCallback(async (file) => {
        if (!file || !selectedCandidateDetails) return;
        const candidateId = selectedCandidateDetails._id || selectedCandidateDetails.id;
        if (!candidateId) return;

        setPhotoUploadError(null);
        if (!PHOTO_ACCEPT_TYPES.includes(file.type)) {
            setPhotoUploadError(t('candidates_uploadPhotoInvalidType'));
            return;
        }
        if (file.size > PHOTO_MAX_BYTES) {
            setPhotoUploadError(t('candidates_uploadPhotoTooLarge'));
            return;
        }

        setPhotoUploading(true);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            const result = await apiClient.postForm(
                `/api/candidates/${encodeURIComponent(String(candidateId))}/photo`,
                formData
            );
            const updated = result.data;
            setSelectedCandidateDetails(updated);
            setCandidates((prev) =>
                prev.map((c) => {
                    const cid = c._id || c.id;
                    return String(cid) === String(candidateId) ? updated : c;
                })
            );
        } catch (err) {
            setPhotoUploadError(err?.message || t('candidates_uploadPhotoError'));
        } finally {
            setPhotoUploading(false);
            if (photoInputRef.current) photoInputRef.current.value = '';
        }
    }, [selectedCandidateDetails, t]);

    const candidatesStatusPickOptions = useMemo(
        () => [
            { value: 'pending', label: t('candidates_statusPickPending') },
            { value: 'accepted', label: t('candidates_statusPickAccepted') },
            { value: 'rejected', label: t('candidates_statusPickRejected') },
        ],
        [t]
    );

    const candidatesGenderPickOptions = useMemo(
        () => [
            { value: 'male', label: t('candidates_genderMale') },
            { value: 'female', label: t('candidates_genderFemale') },
        ],
        [t]
    );

    const candidatesExperienceFilterOptions = useMemo(
        () =>
            YEARS_OF_EXPERIENCE_OPTIONS.map((o) => ({
                value: o.value,
                label:
                    o.value === '0-1'
                        ? t('candidates_exp01')
                        : o.value === '2-3'
                          ? t('candidates_exp23')
                          : o.value === '4-5'
                            ? t('candidates_exp45')
                            : o.value === '6-10'
                              ? t('candidates_exp610')
                              : t('candidates_exp10p'),
            })),
        [t]
    );

    const candidatesEducationFilterOptions = useMemo(
        () =>
            HIGHEST_EDUCATION_OPTIONS.map((o) => ({
                value: o.value,
                label:
                    o.value === 'high-school'
                        ? t('candidates_eduHighSchool')
                        : o.value === 'diploma'
                          ? t('candidates_eduDiploma')
                          : o.value === 'bachelor'
                          ? t('candidates_eduBachelor')
                          : o.value === 'master'
                            ? t('candidates_eduMaster')
                            : o.value === 'phd'
                              ? t('candidates_eduPhd')
                              : t('candidates_eduOther'),
            })),
        [t]
    );

    const formatCandidateGenderLabel = useCallback((candidate) => {
        const raw = candidate?.gender ?? candidate?.Gender;
        if (raw == null || String(raw).trim() === '') return '—';
        const norm = normalizeStoredGender(raw);
        if (norm === 'male') return t('candidates_genderMale');
        if (norm === 'female') return t('candidates_genderFemale');
        return String(raw).trim();
    }, [t]);

    useEffect(() => {
        if (!showCandidateModal) {
            setPhotoUploadError(null);
            setPhotoUploading(false);
        }
    }, [showCandidateModal]);

    // Lock page scroll while the candidate modal is open, otherwise the page
    // behind it keeps scrolling once the panel reaches its end.
    useEffect(() => {
        if (!showCandidateModal) return undefined;
        const html = document.documentElement;
        const body = document.body;
        const prevHtml = html.style.overflow;
        const prevBody = body.style.overflow;
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        return () => {
            html.style.overflow = prevHtml;
            body.style.overflow = prevBody;
        };
    }, [showCandidateModal]);

    useEffect(() => {
        setCandidatesPanel(readStoredCandidatesPanelTab());
        setEmployeesPanelRecords(readStoredEmployeesPanelRecords());
        setRosterEmployeesRecords(readStoredRosterEmployeesRecords());
        setSelectedCandidates([]);
        setSelectedEmployees([]);
        setSelectedRosterEmployees([]);
        setHiddenSampleIds([]);
    }, [userKey]);

    // جلب البيانات من API
    const fetchCandidates = useCallback(async ({ background = false } = {}) => {
        const key = `candidates:list:${userKey}`;
        try {
            if (!background && !hasCached(key)) setLoading(true);
            setError(null);
            const result = await apiClient.get('/api/candidates?forView=candidates');

            if (result.success) {
                setCandidates(result.data || []);
                setCached(key, result.data || []);
            } else if (!background && !hasCached(key)) {
                setError(result.error || t('candidates_fetchError'));
            }
        } catch (err) {
            console.error('Error fetching candidates:', err);
            if (!background && !hasCached(key)) setError(err.message || t('candidates_fetchError'));
        } finally {
            if (!background) setLoading(false);
        }
    }, [t, userKey]);

    useEffect(() => {
        // Show any cached list for this user instantly, then revalidate in the
        // background (no loading flash). First-ever load has no cache → skeleton.
        const cached = getCached(`candidates:list:${userKey}`);
        if (cached) {
            setCandidates(cached);
            setLoading(false);
        }
        fetchCandidates({ background: !!cached });
    }, [fetchCandidates, userKey]);

    // Live: refresh the list in the background (no loading flash) when candidate
    // domain events arrive — evaluations completed, status changed, new applicant.
    useLiveRefresh(
        [
            'ScreeningEvaluationCompleted',
            'VoiceEvaluationCompleted',
            'VideoEvaluationCompleted',
            'CandidateStatusChanged',
            'CandidateApplied',
            'VideoSessionCompleted',
        ],
        () => fetchCandidates({ background: true }),
    );

    useEffect(() => {
        try {
            localStorage.setItem(
                userScopedStorageKey(EMPLOYEES_PANEL_STORAGE_KEY),
                JSON.stringify(employeesPanelRecords)
            );
        } catch (e) {
            console.warn('Employees panel: could not save to localStorage', e);
        }
    }, [employeesPanelRecords, userKey]);

    useEffect(() => {
        try {
            localStorage.setItem(
                userScopedStorageKey(ROSTER_EMPLOYEES_STORAGE_KEY),
                JSON.stringify(rosterEmployeesRecords)
            );
        } catch (e) {
            console.warn('Roster employees: could not save to localStorage', e);
        }
    }, [rosterEmployeesRecords, userKey]);

    useEffect(() => {
        try {
            localStorage.setItem(userScopedStorageKey(CANDIDATES_PANEL_TAB_STORAGE_KEY), candidatesPanel);
        } catch (e) {
            console.warn('Candidates panel tab: could not save to localStorage', e);
        }
    }, [candidatesPanel, userKey]);

    useEffect(() => {
        if (candidatesPanel === 'list') {
            setSelectedEmployees([]);
            setSelectedRosterEmployees([]);
        } else if (candidatesPanel === 'secondary') {
            setSelectedCandidates([]);
            setSelectedRosterEmployees([]);
        } else if (candidatesPanel === 'employees') {
            setSelectedCandidates([]);
            setSelectedEmployees([]);
        }
    }, [candidatesPanel]);

    useEffect(() => {
        setShowFilterMenu(false);
    }, [candidatesPanel]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showFilterMenu && !event.target.closest('.filter-menu-container')) {
                setShowFilterMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showFilterMenu]);

    /** منع النسخ من خلايا الجدول (التفاصيل والفلتر ما زالا قابلَي تحديد نصّيًا) */
    const preventTableCopy = useCallback((e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.candidates-data-table')) {
            e.preventDefault();
        }
    }, []);

    /** نفس معايير جدول المرشحين — للقائمة القصيرة ولوحة الموظفين */
    const candidatePassesTableFilters = useCallback((c) => {
            if (filters.name) {
                const needle = String(filters.name).trim().toLowerCase();
                const fullName = String(c.full_name || c.fullName || '').toLowerCase();
                if (!fullName.includes(needle)) return false;
            }
            if (filters.status) {
                const st = String(c.status || 'pending').toLowerCase();
                if (st !== String(filters.status).toLowerCase()) return false;
            }
            if (filters.position) {
                const filterVal = String(filters.position).trim().toLowerCase();
                const rawPos = String(c.position_applied_for || c.positionAppliedFor || '');
                const posText = rawPos.toLowerCase();
                // In roleOnly mode the combobox emits a roleKey (e.g. "hr_business_partner"),
                // while candidates store the display title (e.g. "HR Business Partner").
                // Resolve the stored title to its roleKey so both sides compare on the same key,
                // and keep a substring fallback for free-typed queries.
                const candidateRoleKey =
                    String(c.roleKey || c.appliedRoleKey || '').trim().toLowerCase() ||
                    (rawPos ? String(resolveJobRole(rawPos).roleKey || '').toLowerCase() : '');
                const matches =
                    (candidateRoleKey && candidateRoleKey === filterVal) ||
                    posText.includes(filterVal);
                if (!matches) return false;
            }
        if (
            filters.experience &&
            !candidateMatchesExperienceFilter(
                filters.experience,
                c.years_of_experience || c.yearsOfExperience
            )
        ) {
                return false;
            }
        if (
            filters.education &&
            !candidateMatchesEducationFilter(
                filters.education,
                c.highest_education_level || c.highestEducationLevel
            )
        ) {
                return false;
            }
            if (!candidateMatchesGenderFilter(filters.gender, c.gender)) {
                return false;
            }
            return true;
    }, [filters]);

    // استخدام البيانات من API أو البيانات الافتراضية + تطبيق الفلاتر
    const displayCandidates = useMemo(() => {
        const list = candidates.length > 0 ? candidates : sampleCandidates;
        const hiddenSet = new Set(hiddenSampleIds.map(String));
        return list.filter((c) => {
            const pid = candidatePrimaryId(c);
            if (candidates.length === 0 && pid != null && hiddenSet.has(String(pid))) {
                return false;
            }
            return candidatePassesTableFilters(c);
        });
    }, [candidates, hiddenSampleIds, candidatePassesTableFilters, sampleCandidates]);

    const visibleShortListRecords = useMemo(
        () => employeesPanelRecords.filter((c) => candidatePassesTableFilters(c)),
        [employeesPanelRecords, candidatePassesTableFilters]
    );

    const visibleRosterEmployeesRecords = useMemo(
        () => rosterEmployeesRecords.filter((c) => candidatePassesTableFilters(c)),
        [rosterEmployeesRecords, candidatePassesTableFilters]
    );

    /** المرشحون الكاملون (بدون فلتر الصفحة) — لزر الشارت وحل السجلات المحددة بعد تصفية العرض */
    const fullCandidateSource = useMemo(() => {
        const base = candidates.length > 0 ? candidates : sampleCandidates;
        if (candidates.length > 0) return base;
        const hiddenSet = new Set(hiddenSampleIds.map(String));
        return base.filter((c) => {
            const pid = candidatePrimaryId(c);
            return pid == null || !hiddenSet.has(String(pid));
        });
    }, [candidates, hiddenSampleIds, sampleCandidates]);

    /** مرشحون في قائمة المرشحين الرئيسية مُستبعدون لو وُجدوا في القائمة القصيرة أو لوحة الموظفين */
    const mainListExcludedIdSet = useMemo(() => {
        const s = new Set();
        for (const arr of [employeesPanelRecords, rosterEmployeesRecords]) {
            for (const c of arr) {
                const id = candidatePrimaryId(c);
                if (id != null) s.add(String(id));
            }
        }
        return s;
    }, [employeesPanelRecords, rosterEmployeesRecords]);

    /** مرشحون يظهرون في جدول Candidates بعد استبعاد المنقولين إلى القائمة القصيرة أو الموظفين */
    const visibleCandidates = useMemo(
        () =>
            displayCandidates.filter((c) => {
                const id = candidatePrimaryId(c);
                if (id == null) return true;
                return !mainListExcludedIdSet.has(String(id));
            }),
        [displayCandidates, mainListExcludedIdSet]
    );

    /* نفس .btn.btn-secondary + Clear/Close — خلفية زجاجية وحد سماوي (index.css) */
    const filterComboboxInputStyle = {
        width: '100%',
        padding: '8px 40px 8px 12px',
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '2px solid rgba(56, 189, 248, 0.4)',
        borderRadius: '12px',
        color: '#ffffff',
        fontSize: '13px',
        fontWeight: 500,
        outline: 'none',
        transition: 'var(--transition-base, 0.25s ease)',
        boxSizing: 'border-box',
        boxShadow: 'none',
    };
    const filterComboboxChevronStyle = { right: '12px', color: 'rgba(56, 189, 248, 0.85)' };
    const filterNameInputStyle = {
        ...filterComboboxInputStyle,
        padding: '8px 12px',
    };

    const formFields = useMemo(
        () => [
            { key: 'full_name', label: t('candidates_field_fullName'), type: 'text' },
            { key: 'email', label: t('candidates_field_email'), type: 'email' },
            { key: 'phone', label: t('candidates_field_phone'), type: 'tel' },
            { key: 'years_of_experience', label: t('candidates_field_yearsExp'), type: 'text' },
            { key: 'current_company', label: t('candidates_field_company'), type: 'text' },
            { key: 'highest_education_level', label: t('candidates_field_education'), type: 'text' },
            { key: 'skills', label: t('candidates_field_skills'), type: 'array' },
            { key: 'languages', label: t('candidates_field_languages'), type: 'array' },
            { key: 'coverLetter', label: t('candidates_field_coverLetter'), type: 'textarea' },
        ],
        [t]
    );

    const tableColSpan = 6 + formFields.length + 1;

    const candidateFieldLegacy = {
        full_name: 'fullName',
        position_applied_for: 'positionAppliedFor',
        years_of_experience: 'yearsOfExperience',
        current_company: 'currentCompany',
        highest_education_level: 'highestEducationLevel',
        company_applied_to: 'companyAppliedTo',
    };

    const formatListFieldItem = (item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object') {
            const name = String(item.name || item.label || item.skill || '').trim();
            const level = String(item.level || item.proficiency || '').trim();
            if (name && level) return `${name} (${level})`;
            return name || level;
        }
        return String(item).trim();
    };

    /** Join skills/languages without duplicate entries (case-insensitive). */
    const formatUniqueListField = (raw) => {
        let items = [];
        if (Array.isArray(raw)) {
            items = raw;
        } else if (typeof raw === 'string' && raw.trim()) {
            items = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        } else {
            return '';
        }
        const seen = new Set();
        const unique = [];
        for (const item of items) {
            const text = formatListFieldItem(item);
            if (!text) continue;
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(text);
        }
        return unique.join(', ');
    };

    const getFieldValue = (candidate, fieldKey) => {
        const legacyKey = candidateFieldLegacy[fieldKey];
        const raw =
            candidate[fieldKey] ??
            (legacyKey ? candidate[legacyKey] : undefined) ??
            candidate[fieldKey?.toLowerCase?.()];
        if (fieldKey === 'skills' || fieldKey === 'languages') {
            const display = formatUniqueListField(raw);
            return display || t('stageEval_notApplicable');
        }
        return raw || t('stageEval_notApplicable');
    };

    const getStatusBadge = (status) => {
        const statusConfig = {
            accepted: { text: t('candidates_statusPickAccepted'), class: 'status-accepted' },
            pending: { text: t('candidates_statusPickPending'), class: 'status-pending' },
            rejected: { text: t('candidates_statusPickRejected'), class: 'status-rejected' },
        };
        const config = statusConfig[status] || statusConfig.pending;
        return (
            <span className={`status-badge ${config.class}`}>
                {config.text}
            </span>
        );
    };

    const sendSecondInterview = (candidateId) => {
        // Logic to send second interview link
        console.log('Sending second interview to candidate:', candidateId);
        alert(t('candidates_secondInterviewAlert'));
    };

    const finalizeCandidateRemovalFromView = (removedIds) => {
        const idSet = new Set(removedIds.map((id) => String(id)));
        setEmployeesPanelRecords((prev) =>
            prev.filter((c) => {
                const pid = candidatePrimaryId(c);
                return pid == null || !idSet.has(String(pid));
            })
        );
        setRosterEmployeesRecords((prev) =>
            prev.filter((c) => {
                const pid = candidatePrimaryId(c);
                return pid == null || !idSet.has(String(pid));
            })
        );
        setSelectedCandidateDetails((prev) => {
            if (!prev) return null;
            const pid = candidatePrimaryId(prev);
            if (pid != null && idSet.has(String(pid))) {
                setShowCandidateModal(false);
                return null;
            }
            return prev;
        });
        setSelectedCandidates((prev) =>
            prev.filter((id) => !idSet.has(String(id)))
        );
        setSelectedEmployees((prev) =>
            prev.filter((id) => !idSet.has(String(id)))
        );
        setSelectedRosterEmployees((prev) =>
            prev.filter((id) => !idSet.has(String(id)))
        );
    };

    const executeClearSelectedCandidates = async () => {
        const ids = selectedCandidates
            .map((id) => String(id).trim())
            .filter(isValidCandidateMongoId);
        if (ids.length === 0) return { ok: true };

        if (candidates.length > 0) {
            try {
                const result = await apiClient.post('/api/candidates/bulk-hide', {
                    ids,
                    view: 'candidates',
                    hidden: true,
                });
                if (!result?.success) {
                    return {
                        ok: false,
                        error: result?.message || result?.error || t('candidates_networkError'),
                    };
                }
                const clearedOk = ids;
                const okSet = new Set(clearedOk.map(String));
                setCandidates((prev) =>
                    prev.filter((c) => {
                        const pid = candidatePrimaryId(c);
                        return pid == null || !okSet.has(String(pid));
                    })
                );
                finalizeCandidateRemovalFromView(clearedOk);
                return { ok: true };
            } catch (err) {
                return {
                    ok: false,
                    error: err?.message || t('candidates_networkError'),
                };
            }
        }

        setHiddenSampleIds((prev) => {
            const next = new Set(prev.map(String));
            for (const id of ids) next.add(String(id));
            return Array.from(next);
        });
        finalizeCandidateRemovalFromView(ids);
        return { ok: true };
    };

    const handleConfirmClear = async () => {
        setClearSubmitting(true);
        setClearError('');
        try {
            const result = await executeClearSelectedCandidates();
            if (result.ok) {
                setClearModalOpen(false);
                setClearError('');
            } else {
                setClearError(result.error || t('candidates_networkError'));
            }
        } finally {
            setClearSubmitting(false);
        }
    };

    const openClearModal = () => {
        if (selectedCandidates.length === 0) return;
        setClearError('');
        setClearModalOpen(true);
    };

    /** إزالة من لوحة Employees فقط — لا حذف من الخادم */
    const handleRemoveSelectedFromEmployeesPanel = () => {
        const ids = selectedEmployees;
        if (ids.length === 0) return;
        const idSet = new Set(ids.map(selectionIdToKey).filter(Boolean));
        setEmployeesPanelRecords((prev) =>
            prev.filter((c) => {
                const pid = candidatePrimaryId(c);
                return pid == null || !idSet.has(String(pid));
            })
        );
        setSelectedCandidateDetails((prev) => {
            if (!prev) return null;
            const pid = candidatePrimaryId(prev);
            if (pid != null && idSet.has(String(pid))) {
                setShowCandidateModal(false);
                return null;
            }
            return prev;
        });
        setSelectedEmployees([]);
    };

    const handleMoveShortlistSelectionToRoster = () => {
        if (selectedEmployees.length === 0) return;
        const idSet = new Set(selectedEmployees.map(selectionIdToKey).filter(Boolean));
        const resolved = employeesPanelRecords.filter(
            (c) =>
                candidatePrimaryId(c) != null && idSet.has(String(candidatePrimaryId(c)))
        );
        if (resolved.length === 0) {
            setSelectedEmployees([]);
            return;
        }
        setRosterEmployeesRecords((prev) => {
            const seen = new Set(
                prev
                    .map((c) => candidatePrimaryId(c))
                    .filter((pid) => pid != null)
                    .map((pid) => String(pid))
            );
            const next = [...prev];
            for (const c of resolved) {
                const pid = candidatePrimaryId(c);
                if (pid == null || seen.has(String(pid))) continue;
                seen.add(String(pid));
                next.push(c);
            }
            return next;
        });
        setEmployeesPanelRecords((prev) =>
            prev.filter((c) => {
                const pid = candidatePrimaryId(c);
                return pid == null || !idSet.has(String(pid));
            })
        );
        setSelectedCandidateDetails((prev) => {
            if (!prev) return null;
            const pid = candidatePrimaryId(prev);
            if (pid != null && idSet.has(String(pid))) {
                setShowCandidateModal(false);
                return null;
            }
            return prev;
        });
        setSelectedEmployees([]);
        setCandidatesPanel('employees');
    };

    const handleRemoveSelectedFromRosterPanel = () => {
        const ids = selectedRosterEmployees;
        if (ids.length === 0) return;
        const idSet = new Set(ids.map(selectionIdToKey).filter(Boolean));
        setRosterEmployeesRecords((prev) =>
            prev.filter((c) => {
                const pid = candidatePrimaryId(c);
                return pid == null || !idSet.has(String(pid));
            })
        );
        setSelectedCandidateDetails((prev) => {
            if (!prev) return null;
            const pid = candidatePrimaryId(prev);
            if (pid != null && idSet.has(String(pid))) {
                setShowCandidateModal(false);
                return null;
            }
            return prev;
        });
        setSelectedRosterEmployees([]);
    };

    const handleAddSelectedRosterToChart = () => {
        const ids = selectedRosterEmployees;
        if (ids.length === 0) return;
        const idSet = new Set(ids.map(selectionIdToKey).filter(Boolean));
        const entries = [];
        for (const c of rosterEmployeesRecords) {
            const pid = candidatePrimaryId(c);
            if (pid == null || !idSet.has(String(pid))) continue;
            const emp = candidateToChartEmp(c);
            if (emp) entries.push(emp);
        }
        if (entries.length > 0) {
            mergeIntoPool(entries);
            setSelectedRosterEmployees([]);
        }
    };

    return (
        <>
            <style>{`
                /* عمودي فقط على الخارج؛ أفقي فقط على الداخل — شريط جانبي واحد */
                .candidates-scroll-outer {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(56, 189, 248, 0.55) rgba(15, 23, 42, 0.35);
                }
                .candidates-scroll-outer::-webkit-scrollbar {
                    width: 10px;
                }
                .candidates-scroll-outer::-webkit-scrollbar:horizontal {
                    display: none;
                    height: 0;
                }
                .candidates-scroll-outer::-webkit-scrollbar-track {
                    background: rgba(15, 23, 42, 0.45);
                    border-radius: 10px;
                }
                .candidates-scroll-outer::-webkit-scrollbar-thumb {
                    background: linear-gradient(
                        180deg,
                        rgba(56, 189, 248, 0.5) 0%,
                        rgba(34, 211, 238, 0.6) 100%
                    );
                    border-radius: 10px;
                    border: 2px solid rgba(15, 23, 42, 0.5);
                }
                .candidates-scroll-outer::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(
                        180deg,
                        rgba(56, 189, 248, 0.75) 0%,
                        rgba(34, 211, 238, 0.85) 100%
                    );
                }
                .candidates-scroll-inner {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(56, 189, 248, 0.55) rgba(15, 23, 42, 0.35);
                }
                .candidates-scroll-inner::-webkit-scrollbar {
                    height: 10px;
                }
                .candidates-scroll-inner::-webkit-scrollbar:vertical {
                    display: none;
                    width: 0;
                }
                .candidates-scroll-inner::-webkit-scrollbar-track {
                    background: rgba(15, 23, 42, 0.45);
                    border-radius: 10px;
                }
                .candidates-scroll-inner::-webkit-scrollbar-thumb {
                    background: linear-gradient(
                        90deg,
                        rgba(56, 189, 248, 0.5) 0%,
                        rgba(34, 211, 238, 0.6) 100%
                    );
                    border-radius: 10px;
                    border: 2px solid rgba(15, 23, 42, 0.5);
                }
                .candidates-scroll-inner::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(
                        90deg,
                        rgba(56, 189, 248, 0.75) 0%,
                        rgba(34, 211, 238, 0.85) 100%
                    );
                }
                .candidates-page-full-width {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .candidates-page-full-width .container {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .candidates-full-width-card {
                    margin-top: 0 !important;
                    padding-top: 0 !important;
                    margin-bottom: 0 !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .candidates-full-width-card .dashboard-card-header {
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
                }
                .candidates-page-full-width .candidate-avatar-ring,
                .candidates-candidate-modal-panel .candidate-avatar-ring {
                    isolation: isolate;
                }
                .candidates-candidate-modal-panel .candidate-avatar-ring[role="button"]:hover .candidate-avatar-upload-hint {
                    opacity: 1;
                }
                /* شريط انزلاق المودال — نفس طابع الكونتينر (زجاج + حدّ سماوي) */
                .candidates-candidate-modal-panel {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(56, 189, 248, 0.55) rgba(15, 23, 42, 0.35);
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar {
                    width: 10px;
                    height: 10px;
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar-track {
                    background: rgba(15, 23, 42, 0.4);
                    border-radius: 12px;
                    margin: 8px 4px;
                    border: 1px solid rgba(56, 189, 248, 0.12);
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar-thumb {
                    background: linear-gradient(180deg, rgba(56, 189, 248, 0.55) 0%, rgba(34, 211, 238, 0.65) 100%);
                    border-radius: 12px;
                    border: 2px solid rgba(15, 23, 42, 0.6);
                    box-shadow: 0 0 10px rgba(56, 189, 248, 0.35), inset 0 0 4px rgba(255, 255, 255, 0.12);
                    transition: background 0.2s ease, box-shadow 0.2s ease;
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(180deg, rgba(56, 189, 248, 0.85) 0%, rgba(34, 211, 238, 0.95) 100%);
                    box-shadow: 0 0 14px rgba(56, 189, 248, 0.55), inset 0 0 4px rgba(255, 255, 255, 0.2);
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar-thumb:active {
                    background: linear-gradient(180deg, rgba(34, 211, 238, 1) 0%, rgba(56, 189, 248, 1) 100%);
                }
                .candidates-candidate-modal-panel::-webkit-scrollbar-corner {
                    background: transparent;
                }
                /* حقول الفلتر — نفس مظهر زر الثانوي (Clear All / Close) */
                .filter-menu-container .color-dropdown-menu .form-input::placeholder {
                    color: rgba(255, 255, 255, 0.55);
                    font-weight: 500;
                }
                /* جدول المرشحين — افتراضي بسيط؛ عند hover تأثير زجاجي بلا حدود للخلايا */
                .candidates-data-table {
                    border-collapse: collapse;
                    width: 100%;
                    min-width: 100%;
                    font-size: 12px;
                }
                .candidates-data-table thead tr {
                    background: linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
                    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
                }
                .candidates-data-table thead th {
                    padding: 10px 12px;
                    font-size: 11px;
                    font-weight: 700;
                    color: #fff;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                    text-align: left;
                    background: transparent;
                    border: none;
                    vertical-align: middle;
                }
                .candidates-data-table thead th:first-child {
                    text-align: center;
                    width: 50px;
                }
                .candidates-data-table tbody td.candidates-table-cell {
                    padding: 10px 12px;
                    vertical-align: middle;
                    color: #fff;
                    background: transparent;
                    border: none;
                    border-radius: 0;
                    backdrop-filter: none;
                    -webkit-backdrop-filter: none;
                    box-shadow: none;
                    transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, backdrop-filter 0.2s ease;
                }
                .candidates-data-table tbody td.candidates-table-cell:first-child {
                    text-align: center;
                }
                /* Long skills lists / cover letters otherwise stretch the row to
                   several times the height of its neighbours. Full text stays
                   available in the candidate modal and the cell tooltip. */
                .candidates-cell-clamp {
                    display: -webkit-box;
                    -webkit-box-orient: vertical;
                    -webkit-line-clamp: 3;
                    line-clamp: 3;
                    overflow: hidden;
                }
                .candidates-data-table tbody td.candidates-table-cv {
                    text-align: center;
                    padding: 10px 8px;
                    vertical-align: middle;
                }
                .candidates-data-table tbody tr.is-selected td.candidates-table-cell {
                    background: transparent;
                    border: none;
                    border-radius: 0;
                    box-shadow: none;
                    backdrop-filter: none;
                    -webkit-backdrop-filter: none;
                }
                /* hover: dark slate + light indigo — في design-styles.css */
                /* منع تحديد/نسخ نص الجدول؛ يُستثنى الفلتر ومودال التفاصيل */
                .candidates-page-full-width .candidates-data-table,
                .candidates-page-full-width .candidates-data-table * {
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    user-select: none;
                    -webkit-touch-callout: none;
                }
                .candidates-page-full-width .filter-menu-container,
                .candidates-page-full-width .filter-menu-container * {
                    -webkit-user-select: text;
                    -moz-user-select: text;
                    user-select: text;
                    -webkit-touch-callout: default;
                }
                .candidates-candidate-modal-panel,
                .candidates-candidate-modal-panel * {
                    -webkit-user-select: text;
                    -moz-user-select: text;
                    user-select: text;
                }
            `}</style>
            <div
                className="dashboard-page candidates-page-full-width"
                onCopy={preventTableCopy}
                onCut={preventTableCopy}
            >
                <div className="design-background">
                    <div className="design-orb-1" />
                    <div className="design-orb-2" />
                    <div className="design-orb-3" />
                </div>

                <MobilePinchPanViewport className="mobile-pinch-pan-viewport--candidates">
                <div className="container" style={{ 
                    width: '100%', 
                    margin: '0', 
                    padding: '0',
                    position: 'relative', 
                    zIndex: 1,
                    height: '100%',
                    marginTop: '0',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {/* Candidates Table */}
                    <div className="dashboard-card dashboard-card--page-active candidates-full-width-card" style={{ 
                        width: '100%', 
                        height: '100%',
                        overflow: 'hidden',
                        margin: '0',
                        marginTop: '0',
                        borderRadius: '0',
                        borderLeft: 'none',
                        borderRight: 'none',
                        borderTop: 'none',
                        borderBottom: 'none',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <div
                            className="dashboard-card-header candidates-page-card-header"
                            style={{
                            marginTop: '0', 
                            paddingTop: '8px', 
                            paddingLeft: '20px', 
                            paddingRight: '20px',
                            paddingBottom: '8px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                            width: '100%',
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <div className="candidates-header-nav" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <button 
                                    type="button"
                                    className="btn btn-secondary candidates-header-back"
                                    onClick={() => navigate(-1)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '10px 16px'
                                    }}
                                >
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <span className="btn-text">{t('candidates_back')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary candidates-header-tab"
                                    onClick={() => setCandidatesPanel('list')}
                                    aria-pressed={candidatesPanel === 'list'}
                                    style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '12px 20px',
                                    fontSize: '18px',
                                    fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'rgba(34, 211, 238, 0.8)' }} aria-hidden>
                                        <path d="M16 21V19C16 17.9391 15.5786 16.9217 14.8284 16.1716C14.0783 15.4214 13.0609 15 12 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88M13 7C13 9.20914 11.2091 11 9 11C6.79086 11 5 9.20914 5 7C5 4.79086 6.79086 3 9 3C11.2091 3 13 4.79086 13 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <span className="btn-text" style={{ fontSize: '18px', fontWeight: 600 }}>{t('candidates_tabCandidates')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary candidates-header-tab"
                                    onClick={() => setCandidatesPanel('secondary')}
                                    aria-pressed={candidatesPanel === 'secondary'}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px 20px',
                                        fontSize: '18px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <svg
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        style={{ color: 'rgba(34, 211, 238, 0.8)' }}
                                        aria-hidden
                                    >
                                        <path
                                            d="M6 3h12a2 2 0 012 2v17l-8-4-8 4V5a2 2 0 012-2z"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            fill="none"
                                        />
                                    </svg>
                                    <span className="btn-text" style={{ fontSize: '18px', fontWeight: 600 }}>{t('candidates_tabEmployees')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary candidates-header-tab"
                                    onClick={() => setCandidatesPanel('employees')}
                                    aria-pressed={candidatesPanel === 'employees'}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px 20px',
                                        fontSize: '18px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <svg
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        style={{ color: 'rgba(34, 211, 238, 0.8)' }}
                                        aria-hidden
                                    >
                                        <rect
                                            x="2"
                                            y="7"
                                            width="20"
                                            height="14"
                                            rx="2"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        />
                                        <path
                                            d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <span className="btn-text" style={{ fontSize: '18px', fontWeight: 600 }}>
                                        {t('candidates_tabRosterEmployees')}
                                    </span>
                                </button>
                                </div>
                            {(candidatesPanel === 'list' ||
                                candidatesPanel === 'secondary' ||
                                candidatesPanel === 'employees') && (
                            <div className="header-actions candidates-header-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center', marginLeft: 'auto' }}>
                                {candidatesPanel === 'list' && selectedCandidates.length > 0 && (
                                    <button 
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            const resolved = selectedCandidates
                                                .map((id) =>
                                                    fullCandidateSource.find((c) =>
                                                        idsMatch(id, candidatePrimaryId(c))
                                                    )
                                                )
                                                .filter(Boolean);
                                            setEmployeesPanelRecords((prev) => {
                                                const seen = new Set(
                                                    prev
                                                        .map((c) => candidatePrimaryId(c))
                                                        .filter((id) => id != null)
                                                        .map((id) => String(id))
                                                );
                                                const next = [...prev];
                                                for (const c of resolved) {
                                                    const pid = candidatePrimaryId(c);
                                                    if (pid == null) continue;
                                                    const key = String(pid);
                                                    if (seen.has(key)) continue;
                                                    seen.add(key);
                                                    next.push(c);
                                                }
                                                return next;
                                            });
                                            setSelectedCandidates([]);
                                            setCandidatesPanel('secondary');
                                        }}
                                        style={{
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}
                                        title={t('candidates_moveToEmployeesTitle')}
                                    >
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                            aria-hidden
                                        >
                                            <path
                                                d="M5 12h14M13 6l6 6-6 6"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                        <span className="btn-text">
                                            {t('candidates_moveToEmployees')}
                                        </span>
                                    </button>
                                )}
                                {candidatesPanel === 'list' && selectedCandidates.length > 0 && canWriteCandidates && (
                                    <button 
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={openClearModal}
                                        title={t('candidates_clearFromView')}
                                        style={{ 
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M2.5 5H4.16667H17.5M6.66667 5V3.33333C6.66667 2.89131 6.84226 2.46738 7.15482 2.15482C7.46738 1.84226 7.89131 1.66667 8.33333 1.66667H11.6667C12.1087 1.66667 12.5326 1.84226 12.8452 2.15482C13.1577 2.46738 13.3333 2.89131 13.3333 3.33333V5M15.8333 5V16.6667C15.8333 17.1087 15.6577 17.5326 15.3452 17.8452C15.0326 18.1577 14.6087 18.3333 14.1667 18.3333H5.83333C5.39131 18.3333 4.96738 18.1577 4.65482 17.8452C4.34226 17.5326 4.16667 17.1087 4.16667 16.6667V5H15.8333Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M8.33333 9.16667V14.1667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M11.6667 9.16667V14.1667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                        <span className="btn-text">{t('candidates_clearFromView')}</span>
                                    </button>
                                )}
                                {candidatesPanel === 'secondary' &&
                                    selectedEmployees.length > 0 &&
                                    (
                                        <>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={handleMoveShortlistSelectionToRoster}
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}
                                                title={t('candidates_promoteToRosterTitle')}
                                            >
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden
                                                >
                                                    <path
                                                        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100-8 4 4 0 000 8zM16 7h6M19 4v6"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                                <span className="btn-text">{t('candidates_promoteToRoster')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={handleRemoveSelectedFromEmployeesPanel}
                                                title={t('candidates_removeFromPanelTitle')}
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}
                                            >
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden
                                                >
                                                    <path
                                                        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                                <span className="btn-text">{t('candidates_remove')}</span>
                                            </button>
                                        </>
                                )}
                                {candidatesPanel === 'employees' &&
                                    selectedRosterEmployees.length > 0 && (
                                        <>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={handleAddSelectedRosterToChart}
                                                title={t('candidates_addToChartTitle')}
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}
                                            >
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden
                                                >
                                                    <rect
                                                        x="8"
                                                        y="2"
                                                        width="8"
                                                        height="4"
                                                        rx="1.25"
                                                        stroke="currentColor"
                                                        strokeWidth="1.65"
                                                    />
                                                    <path
                                                        d="M12 6v2M6.25 10h11.5"
                                                        stroke="currentColor"
                                                        strokeWidth="1.65"
                                                        strokeLinecap="round"
                                                    />
                                                    <path
                                                        d="M6.25 10v1.5M17.75 10v1.5"
                                                        stroke="currentColor"
                                                        strokeWidth="1.65"
                                                        strokeLinecap="round"
                                                    />
                                                    <rect
                                                        x="3.5"
                                                        y="13"
                                                        width="6"
                                                        height="5.75"
                                                        rx="1.25"
                                                        stroke="currentColor"
                                                        strokeWidth="1.65"
                                                    />
                                                    <rect
                                                        x="14.5"
                                                        y="13"
                                                        width="6"
                                                        height="5.75"
                                                        rx="1.25"
                                                        stroke="currentColor"
                                                        strokeWidth="1.65"
                                                    />
                                                    <circle
                                                        cx="18.85"
                                                        cy="4.95"
                                                        r="2.95"
                                                        stroke="currentColor"
                                                        strokeWidth="1.5"
                                                    />
                                                    <path
                                                        d="M18.85 3.05v3.8M17 4.95h3.7"
                                                        stroke="currentColor"
                                                        strokeWidth="1.35"
                                                        strokeLinecap="round"
                                                    />
                                                </svg>
                                                <span className="btn-text">{t('candidates_addToChart')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={handleRemoveSelectedFromRosterPanel}
                                                title={t('candidates_removeFromRosterTitle')}
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                }}
                                            >
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden
                                                >
                                                    <path
                                                        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                                <span className="btn-text">{t('candidates_remove')}</span>
                                            </button>
                                        </>
                                )}
                                {(candidatesPanel === 'list' ||
                                    candidatesPanel === 'secondary' ||
                                    candidatesPanel === 'employees') && (
                                <div className="filter-menu-container" style={{ position: 'relative', flexShrink: 0 }}>
                                    <button 
                                        type="button"
                                        className={`btn btn-secondary candidates-toolbar-filter-btn${showFilterMenu ? ' candidates-toolbar-filter-btn--open' : ''}`}
                                        onClick={() => setShowFilterMenu(!showFilterMenu)}
                                        aria-expanded={showFilterMenu}
                                        aria-label={t('candidates_filter')}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M2.5 5H17.5M5 10H15M7.5 15H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                        </svg>
                                        <span className="btn-text">{t('candidates_filter')}</span>
                                        {Object.values(filters).some((f) => f !== '') && (
                                            <span className="candidates-toolbar-filter-dot" aria-hidden />
                                        )}
                                    </button>
                                    {showFilterMenu && (
                                        <div className="color-dropdown-menu open">
                                            <div style={{ marginBottom: '16px' }}>
                                                <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, margin: 0 }}>
                                                    {t('candidates_filterTitle')}
                                                </h3>
                            </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelName')}
                                                </label>
                                                <input
                                                    id="candidates-filter-name"
                                                    name="name"
                                                    type="search"
                                                    value={filters.name}
                                                    onChange={(e) => setFilters({ ...filters, name: e.target.value })}
                                                    placeholder={t('candidates_placeholderSearchName')}
                                                    className="form-input"
                                                    style={filterNameInputStyle}
                                                    autoComplete="off"
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelStatus')}
                                                </label>
                                                <PositionSuggestCombobox
                                                    id="candidates-filter-status"
                                                    name="status"
                                                    value={filters.status}
                                                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                                                    suggestionOptions={candidatesStatusPickOptions}
                                                    placeholder={t('candidates_placeholderSelectStatus')}
                                                    listboxId="candidates-filter-status-suggestions"
                                                    className="form-input"
                                                    inputStyle={filterComboboxInputStyle}
                                                    chevronStyle={filterComboboxChevronStyle}
                                                />
                        </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelPosition')}
                                                </label>
                                                <PositionSuggestCombobox
                                                    id="candidates-filter-position"
                                                    name="position"
                                                    catalogMode="roleOnly"
                                                    value={filters.position}
                                                    onChange={(e) => setFilters({ ...filters, position: e.target.value })}
                                                    placeholder={t('candidates_placeholderSelectPosition')}
                                                    listboxId="candidates-filter-position-suggestions"
                                                    className="form-input"
                                                    inputStyle={filterComboboxInputStyle}
                                                    chevronStyle={filterComboboxChevronStyle}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelExperience')}
                                                </label>
                                                <PositionSuggestCombobox
                                                    id="candidates-filter-experience"
                                                    name="experience"
                                                    value={filters.experience}
                                                    onChange={(e) => setFilters({ ...filters, experience: e.target.value })}
                                                    suggestionOptions={candidatesExperienceFilterOptions}
                                                    placeholder={t('candidates_placeholderSelectExperience')}
                                                    listboxId="candidates-filter-experience-suggestions"
                                                    className="form-input"
                                                    inputStyle={filterComboboxInputStyle}
                                                    chevronStyle={filterComboboxChevronStyle}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelEducation')}
                                                </label>
                                                <PositionSuggestCombobox
                                                    id="candidates-filter-education"
                                                    name="education"
                                                    value={filters.education}
                                                    onChange={(e) => setFilters({ ...filters, education: e.target.value })}
                                                    suggestionOptions={candidatesEducationFilterOptions}
                                                    placeholder={t('candidates_placeholderSelectEducation')}
                                                    listboxId="candidates-filter-education-suggestions"
                                                    className="form-input"
                                                    inputStyle={filterComboboxInputStyle}
                                                    chevronStyle={filterComboboxChevronStyle}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                                <label className="form-label" style={{ display: 'block', color: '#CBD5E1', fontSize: '13px', marginBottom: '8px', fontWeight: 500 }}>
                                                    {t('candidates_labelGender')}
                                                </label>
                                                <PositionSuggestCombobox
                                                    id="candidates-filter-gender"
                                                    name="gender"
                                                    value={filters.gender}
                                                    onChange={(e) => setFilters({ ...filters, gender: e.target.value })}
                                                    suggestionOptions={candidatesGenderPickOptions}
                                                    placeholder={t('candidates_placeholderSelectGender')}
                                                    listboxId="candidates-filter-gender-suggestions"
                                                    className="form-input"
                                                    inputStyle={filterComboboxInputStyle}
                                                    chevronStyle={filterComboboxChevronStyle}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    onClick={() => {
                                                        setFilters({
                                                            name: '',
                                                            status: '',
                                                            position: '',
                                                            experience: '',
                                                            education: '',
                                                            gender: '',
                                                        });
                                                    }}
                                                    style={filterPanelActionBtnStyle}
                                                >
                                                    <span className="btn-text" style={{ fontSize: '13px', fontWeight: 500 }}>{t('candidates_clearAll')}</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                            )}
                        </div>
                        {candidatesPanel === 'list' ? (
                        <div
                            className="dashboard-card-body candidates-scroll-outer"
                            style={{
                            padding: '0', 
                                overflowX: 'hidden',
                            overflowY: 'auto',
                            scrollBehavior: 'smooth',
                            WebkitOverflowScrolling: 'touch',
                            flex: 1,
                            height: '100%',
                            minHeight: 0,
                            }}
                        >
                            <div
                                className="candidates-scroll-inner h-scroll-pan"
                                style={{
                                    overflowX: 'auto',
                                    overflowY: 'hidden',
                                    minWidth: 0,
                                    cursor: 'grab',
                                    WebkitOverflowScrolling: 'touch',
                                }}
                                onPointerDown={onHorizontalDragScrollPointerDown}
                            >
                            <table
                                className="candidates-data-table"
                                style={{
                                width: '100%',
                                minWidth: '100%',
                                }}
                            >
                                <thead>
                                    <tr>
                                        <th>
                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedCandidates.length === visibleCandidates.length &&
                                                    visibleCandidates.length > 0
                                                }
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedCandidates(
                                                            visibleCandidates
                                                                .map((c) => candidatePrimaryId(c))
                                                                .filter((id) => id != null)
                                                        );
                                                    } else {
                                                        setSelectedCandidates([]);
                                                    }
                                                }}
                                                style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    cursor: 'pointer',
                                                }}
                                                className="candidates-row-checkbox"
                                            />
                                        </th>
                                        <th style={{ minWidth: '280px', width: '280px' }}>{t('candidates_colName')}</th>
                                        <th style={{ minWidth: '200px', width: '200px' }}>{t('candidates_colPosition')}</th>
                                        <th style={{ width: '100px', minWidth: '96px', whiteSpace: 'nowrap' }}>{t('candidates_colGender')}</th>
                                        <th style={{ minWidth: '260px', width: '260px' }}>{t('candidates_colContact')}</th>
                                        <th style={{ textAlign: 'center', width: '80px', minWidth: '72px' }}>{t('candidates_colCv')}</th>
                                        {formFields.map(field => (
                                            <th key={field.key} style={{
                                                minWidth: field.type === 'textarea' ? '260px' : field.type === 'array' ? '200px' : '170px',
                                                width: field.type === 'textarea' ? '260px' : field.type === 'array' ? '200px' : '170px'
                                            }}>
                                                {field.label}
                                            </th>
                                        ))}
                                        <th style={{ minWidth: '220px', width: '220px' }}>{t('candidates_colAiEval')}</th>
                                        <th style={{ minWidth: '150px', width: '150px' }}>{t('candidates_colOutcome')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        Array.from({ length: 6 }).map((_, i) => (
                                            <tr key={`candidate-skeleton-${i}`} aria-hidden="true">
                                                <td colSpan={tableColSpan} style={{ padding: '14px 16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                                        <span className="ev-skeleton ev-skeleton--circle" style={{ width: 44, height: 44, flexShrink: 0 }} />
                                                        <span className="ev-skeleton" style={{ height: 12, width: 150 }} />
                                                        <span className="ev-skeleton" style={{ height: 12, width: 190, marginInlineStart: 'auto' }} />
                                                        <span className="ev-skeleton" style={{ height: 12, width: 70 }} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    ) : error ? (
                                        <tr>
                                            <td colSpan={tableColSpan} style={{ textAlign: 'center', padding: '40px', color: '#EF4444' }}>
                                                {fillI18nTemplate(t('candidates_errorWithDetail'), { detail: error })}
                                            </td>
                                        </tr>
                                    ) : visibleCandidates.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableColSpan} style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                                {displayCandidates.length === 0
                                                    ? t('candidates_emptyNone')
                                                    : t('candidates_emptyMoved')}
                                            </td>
                                        </tr>
                                    ) : (
                                        visibleCandidates.map((candidate, candIdx) => {
                                            const rowPrimaryId = candidatePrimaryId(candidate);
                                            const isSelected =
                                                rowPrimaryId != null &&
                                                selectedCandidates.some((sid) =>
                                                    idsMatch(sid, rowPrimaryId)
                                                );
                                            const photoUrl = candidatePhotoUrl(candidate);
                                            const cvUrl = candidateCvUrl(candidate);
                                            const candEval = resolveCandidateEvaluation(candidate);
                                            
                                            return (
                                            <tr 
                                                key={
                                                    rowPrimaryId != null
                                                        ? String(rowPrimaryId)
                                                        : `cand-row-${candIdx}`
                                                } 
                                                className={isSelected ? 'is-selected' : undefined}
                                                style={{
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                transition: 'all 0.2s ease',
                                                    cursor: 'pointer',
                                                }}
                                                title={t('candidates_rowDetailsTitle')}
                                                onDoubleClick={(e) => {
                                                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                                                        return;
                                                    }
                                                    setSelectedCandidateDetails(candidate);
                                                    setShowCandidateModal(true);
                                                }}
                                            >
                                                {/* Checkbox */}
                                                <td className="candidates-table-cell">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            if (rowPrimaryId == null) return;
                                                            if (e.target.checked) {
                                                                setSelectedCandidates((prev) =>
                                                                    prev.some((sid) =>
                                                                        idsMatch(sid, rowPrimaryId)
                                                                    )
                                                                        ? prev
                                                                        : [...prev, rowPrimaryId]
                                                                );
                                                            } else {
                                                                setSelectedCandidates((prev) =>
                                                                    prev.filter(
                                                                        (sid) =>
                                                                            !idsMatch(sid, rowPrimaryId)
                                                                    )
                                                                );
                                                            }
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="candidates-row-checkbox"
                                                        style={{
                                                            width: '18px',
                                                            height: '18px',
                                                            cursor: 'pointer',
                                                        }}
                                                    />
                                                </td>
                                            {/* Name */}
                                            <td className="candidates-table-cell" style={{ minWidth: '280px', width: '280px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    {/* Profile Photo */}
                                                    <div
                                                        className="candidate-avatar-ring"
                                                        style={{
                                                        width: '54px',
                                                        height: '54px',
                                                        borderRadius: '50%',
                                                        overflow: 'hidden',
                                                        flexShrink: 0,
                                                        border: '2px solid rgba(34, 211, 238, 0.35)',
                                                        background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        boxShadow: '0 2px 8px rgba(6, 182, 212, 0.2)'
                                                    }}
                                                    >
                                                        {photoUrl ? (
                                                            <img 
                                                                alt={((candidate.full_name || candidate.fullName) || '').trim() || t('candidates_avatarAlt')} 
                                                                className="candidate-avatar-photo"
                                                                decoding="async"
                                                                loading="lazy"
                                                                draggable={false}
                                                                {...candidateAvatarImageProps(photoUrl, 54)}
                                                                style={{ 
                                                                    width: '100%', 
                                                                    height: '100%', 
                                                                    objectFit: 'cover' 
                                                                }}
                                                                onError={(e) => {
                                                                    e.target.style.display = 'none';
                                                                    const fall = e.target.nextElementSibling;
                                                                    if (fall) fall.style.display = 'flex';
                                                                }}
                                                            />
                                                        ) : null}
                                                        {shouldUseGenderAvatar(candidate, photoUrl) ? (
                                                            <GenderAvatar
                                                                gender={inferGenderFromName(candidate)}
                                                                size={54}
                                                            />
                                                        ) : (
                                                            <div style={{
                                                                display: photoUrl ? 'none' : 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                width: '100%',
                                                                height: '100%',
                                                                fontSize: '20px',
                                                                fontWeight: 600,
                                                                color: '#fff'
                                                            }}>
                                                                {(((candidate.full_name || candidate.fullName)?.[0] || candidate.email?.[0] || candidate.candidate?.[0] || '?')).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="candidates-cell-primary" style={{ 
                                                        marginBottom: '2px', 
                                                        fontSize: '13px',
                                                        whiteSpace: 'normal',
                                                        wordWrap: 'break-word',
                                                        lineHeight: '1.4',
                                                        flex: 1,
                                                        minWidth: 0
                                                    }}>
                                                    {((candidate.full_name || candidate.fullName) || '').trim()
                                                        ? (candidate.full_name || candidate.fullName).trim()
                                                        : candidate.candidate || candidate.email?.split('@')[0] || t('stageEval_notApplicable')}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Position */}
                                            <td className="candidates-table-cell" style={{ minWidth: '200px', width: '200px', verticalAlign: 'middle' }}>
                                                {(() => {
                                                    const raw = (candidate.position_applied_for || candidate.positionAppliedFor || '').trim();
                                                    const positionLabel = raw
                                                        ? localizeCatalogLabel(raw, currentLang)
                                                        : t('stageEval_notApplicable');
                                                    return (
                                                        <span
                                                            {...scriptTextProps(positionLabel)}
                                                            className="candidates-cell-secondary"
                                                            style={{
                                                                fontSize: '12px',
                                                                fontWeight: 500,
                                                                lineHeight: 1.45,
                                                                whiteSpace: 'normal',
                                                                wordBreak: 'break-word',
                                                                display: 'block',
                                                                textAlign: 'left',
                                                            }}
                                                        >
                                                            {positionLabel}
                                                        </span>
                                                    );
                                                })()}
                                            </td>

                                            {/* Gender */}
                                            <td className="candidates-table-cell" style={{ whiteSpace: 'nowrap' }}>
                                                <span className="candidates-cell-secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
                                                    {formatCandidateGenderLabel(candidate)}
                                                </span>
                                            </td>
                                            
                                            {/* Contact */}
                                            <td className="candidates-table-cell" style={{ minWidth: '260px', verticalAlign: 'top' }}>
                                                <div className="candidates-cell-secondary" style={{ fontSize: '11px', marginBottom: '4px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                                    {candidate.email}
                                                </div>
                                                <div className="candidates-cell-muted" style={{ fontSize: '10px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                                    {candidate.phone}
                                                </div>
                                            </td>

                                            <td
                                                className="candidates-table-cell candidates-table-cv"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', minHeight: '48px' }}>
                                                    {cvUrl ? (
                                                        <PdfCvLink href={cvUrl} fileName={candidateCvFileName(candidate)} size={44} />
                                                    ) : (
                                                        <span className="candidates-cell-muted" style={{ fontSize: '11px' }}>—</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Form Fields */}
                                            {formFields.map(field => {
                                                const cellValue = getFieldValue(candidate, field.key);
                                                return (
                                                <td
                                                    key={field.key}
                                                    className="candidates-table-cell"
                                                    style={{ verticalAlign: 'top', minWidth: field.type === 'textarea' ? '260px' : field.type === 'array' ? '200px' : '170px' }}
                                                >
                                                    <div
                                                        className="candidates-cell-secondary candidates-cell-clamp"
                                                        title={typeof cellValue === 'string' ? cellValue : undefined}
                                                        style={{
                                                            fontSize: '11px',
                                                            lineHeight: '1.45',
                                                            whiteSpace: 'normal',
                                                            wordBreak: 'break-word',
                                                            overflowWrap: 'anywhere',
                                                        }}
                                                    >
                                                        {cellValue}
                                                    </div>
                                                </td>
                                                );
                                            })}

                                            {/* AI Evaluation */}
                                            <td className="candidates-table-cell" style={{ minWidth: '220px', verticalAlign: 'top' }}>
                                                {candEval ? (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <span style={{
                                                            fontSize: '16px',
                                                            fontWeight: 700,
                                                            background: candEval.score >= 80 
                                                                ? 'linear-gradient(135deg, #10B981, #059669)'
                                                                : candEval.score >= 60
                                                                ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                                                                : 'linear-gradient(135deg, #EF4444, #DC2626)',
                                                            WebkitBackgroundClip: 'text',
                                                            WebkitTextFillColor: 'transparent',
                                                            backgroundClip: 'text'
                                                        }}>
                                                            {candEval.score}%
                                                        </span>
                                                        <span style={{
                                                            fontSize: '9px',
                                                            fontWeight: 600,
                                                            color: '#38BDF8',
                                                            background: 'rgba(56, 189, 248, 0.12)',
                                                            border: '1px solid rgba(56, 189, 248, 0.28)',
                                                            borderRadius: '6px',
                                                            padding: '1px 6px',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {t(evaluationSourceLabelKey(candEval.source))}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#94A3B8', fontSize: '12px' }}>{t('candidates_aiPending')}</span>
                                                )}
                                            </td>
                                            {/* What the employer actually did. Recording it is what turns a
                                                pile of AI verdicts into data you can check the AI against —
                                                nothing else in the product carries that signal. */}
                                            <td className="candidates-table-cell" style={{ minWidth: '150px' }}>
                                                <HiringOutcomeCell
                                                    applicationId={candidatePrimaryId(candidate)}
                                                    outcome={candidate.hiringOutcome}
                                                    onRecorded={(saved) => applyHiringOutcome(candidatePrimaryId(candidate), saved)}
                                                    t={t}
                                                />
                                            </td>
                                        </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                        ) : candidatesPanel === 'secondary' ? (
                            <CandidatesStoredLedgerPanel
                                t={t}
                                formFields={formFields}
                                getFieldValue={getFieldValue}
                                formatCandidateGenderLabel={formatCandidateGenderLabel}
                                candidatePrimaryId={candidatePrimaryId}
                                idsMatch={idsMatch}
                                records={visibleShortListRecords}
                                selectedIds={selectedEmployees}
                                setSelectedIds={setSelectedEmployees}
                                variant="cyan"
                                emptyTitle={t('candidates_employeesEmptyTitle')}
                                emptyDescription={fillI18nTemplate(t('candidates_employeesEmptyBody'), {
                                    move: t('candidates_moveToEmployees'),
                                })}
                                emptyPrimaryLabel={t('candidates_goToCandidates')}
                                onEmptyPrimary={() => setCandidatesPanel('list')}
                                onDetailsOpen={(candidate) => {
                                    setSelectedCandidateDetails(candidate);
                                    setShowCandidateModal(true);
                                }}
                            />
                        ) : (
                            <CandidatesStoredLedgerPanel
                                t={t}
                                formFields={formFields}
                                getFieldValue={getFieldValue}
                                formatCandidateGenderLabel={formatCandidateGenderLabel}
                                candidatePrimaryId={candidatePrimaryId}
                                idsMatch={idsMatch}
                                records={visibleRosterEmployeesRecords}
                                selectedIds={selectedRosterEmployees}
                                setSelectedIds={setSelectedRosterEmployees}
                                variant="emerald"
                                emptyTitle={t('candidates_rosterEmptyTitle')}
                                emptyDescription={fillI18nTemplate(t('candidates_rosterEmptyBody'), {
                                    move: t('candidates_promoteToRoster'),
                                })}
                                emptyPrimaryLabel={t('candidates_goToShortList')}
                                onEmptyPrimary={() => setCandidatesPanel('secondary')}
                                onDetailsOpen={(candidate) => {
                                    setSelectedCandidateDetails(candidate);
                                    setShowCandidateModal(true);
                                }}
                            />
                        )}
                    </div>
                </div>
            </MobilePinchPanViewport>

            {/* Candidate Details Modal */}
            {showCandidateModal && selectedCandidateDetails && (() => {
                const modalPhotoUrl = candidatePhotoUrl(selectedCandidateDetails);
                const modalCvUrl = candidateCvUrl(selectedCandidateDetails);
                const modalCertificates = candidateCertificates(selectedCandidateDetails);
                const modalEval = resolveCandidateEvaluation(selectedCandidateDetails);
                const modalYearsRaw =
                    selectedCandidateDetails.years_of_experience ||
                    selectedCandidateDetails.yearsOfExperience;
                const modalYearsDisplay = modalYearsRaw
                    ? fillI18nTemplate(t('candidates_modalYearsWithSuffix'), {
                          value: String(modalYearsRaw),
                      })
                    : t('stageEval_notApplicable');
                const modalCanUploadPhoto = !modalPhotoUrl && canWriteCandidates;
                return (
                <div 
                    className="candidates-candidate-modal-overlay"
                    onClick={() => {
                        setShowCandidateModal(false);
                        setSelectedCandidateDetails(null);
                    }}
                >
                    <div 
                        className="candidates-candidate-modal-panel"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close — نفس ni-header-btn-close */}
                        <button
                            type="button"
                            className="candidates-modal-close-btn"
                            aria-label={t('candidates_modalClose')}
                            onClick={() => {
                                setShowCandidateModal(false);
                                setSelectedCandidateDetails(null);
                            }}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>

                        {/* Header */}
                        <div className="candidates-modal-header">
                            {/* Profile Photo */}
                            <div style={{ flexShrink: 0 }}>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/gif,image/webp"
                                    hidden
                                    aria-hidden
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleModalPhotoUpload(file);
                                    }}
                                />
                                <div
                                    className="candidate-avatar-ring"
                                    role={modalCanUploadPhoto ? 'button' : undefined}
                                    tabIndex={modalCanUploadPhoto ? 0 : undefined}
                                    aria-label={modalCanUploadPhoto ? t('candidates_uploadPhotoHint') : undefined}
                                    onClick={() => {
                                        if (modalCanUploadPhoto && !photoUploading) {
                                            photoInputRef.current?.click();
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (!modalCanUploadPhoto || photoUploading) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            photoInputRef.current?.click();
                                        }
                                    }}
                                    style={{
                                        width: '108px',
                                        height: '108px',
                                        borderRadius: '50%',
                                        overflow: 'hidden',
                                        flexShrink: 0,
                                        border: '3px solid rgba(34, 211, 238, 0.4)',
                                        background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 4px 16px rgba(6, 182, 212, 0.3)',
                                        position: 'relative',
                                        cursor: modalCanUploadPhoto && !photoUploading ? 'pointer' : 'default',
                                    }}
                                >
                                    {modalPhotoUrl ? (
                                        <img 
                                            alt={((selectedCandidateDetails.full_name || selectedCandidateDetails.fullName) || '').trim() || t('candidates_avatarAlt')} 
                                            className="candidate-avatar-photo"
                                            decoding="async"
                                            fetchpriority="high"
                                            draggable={false}
                                            {...candidateAvatarImageProps(modalPhotoUrl, 108)}
                                            style={{ 
                                                width: '100%', 
                                                height: '100%', 
                                                objectFit: 'cover' 
                                            }}
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                                const fall = e.target.nextElementSibling;
                                                if (fall) fall.style.display = 'flex';
                                            }}
                                        />
                                    ) : null}
                                    {shouldUseGenderAvatar(selectedCandidateDetails, modalPhotoUrl) ? (
                                        <GenderAvatar
                                            gender={inferGenderFromName(selectedCandidateDetails)}
                                            size={108}
                                        />
                                    ) : (
                                        <div style={{
                                            display: modalPhotoUrl ? 'none' : 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '100%',
                                            height: '100%',
                                            fontSize: '40px',
                                            fontWeight: 700,
                                            color: '#fff'
                                        }}>
                                            {(((selectedCandidateDetails.full_name || selectedCandidateDetails.fullName)?.[0] || selectedCandidateDetails.email?.[0] || selectedCandidateDetails.candidate?.[0] || '?')).toUpperCase()}
                                        </div>
                                    )}
                                    {modalCanUploadPhoto && !photoUploading && (
                                        <div
                                            className="candidate-avatar-upload-hint"
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '4px',
                                                background: 'rgba(15, 23, 42, 0.55)',
                                                opacity: 0,
                                                transition: 'opacity 0.2s ease',
                                                color: '#e2e8f0',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                textAlign: 'center',
                                                padding: '8px',
                                                pointerEvents: 'none',
                                            }}
                                        >
                                            <span style={{ fontSize: '22px', lineHeight: 1 }} aria-hidden>📷</span>
                                            <span>{t('candidates_uploadPhotoHint')}</span>
                                        </div>
                                    )}
                                    {photoUploading && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                background: 'rgba(15, 23, 42, 0.7)',
                                                color: '#22d3ee',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                            }}
                                        >
                                            {t('candidates_uploadPhotoLoading')}
                                        </div>
                                    )}
                                </div>
                                {photoUploadError && (
                                    <p style={{ margin: '8px 0 0', maxWidth: '108px', fontSize: '11px', color: '#f87171', textAlign: 'center', lineHeight: 1.35 }}>
                                        {photoUploadError}
                                    </p>
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <h2 className="candidates-modal-candidate-name">
                                    {((selectedCandidateDetails.full_name || selectedCandidateDetails.fullName) || '').trim()
                                        ? (selectedCandidateDetails.full_name || selectedCandidateDetails.fullName).trim()
                                        : selectedCandidateDetails.candidate || selectedCandidateDetails.email?.split('@')[0] || t('stageEval_notApplicable')}
                                </h2>
                                <p className="candidates-modal-candidate-role">
                                    {selectedCandidateDetails.position_applied_for || selectedCandidateDetails.positionAppliedFor || t('stageEval_notApplicable')}
                                </p>
                            </div>
                        </div>

                        {/* Details Grid */}
                        <div className="candidates-modal-details-grid">
                            {/* Contact Info */}
                            <div className="candidates-modal-detail-card">
                                <h3 className="candidates-modal-section-title">
                                    {t('candidates_sectionContact')}
                                </h3>
                                <div className="candidates-modal-body-text">
                                    <div><strong>{t('candidates_modalEmail')}</strong> {selectedCandidateDetails.email || t('stageEval_notApplicable')}</div>
                                    <div><strong>{t('candidates_modalPhone')}</strong> {selectedCandidateDetails.phone || t('stageEval_notApplicable')}</div>
                                    {modalCvUrl ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                                            <strong>{t('candidates_modalCv')}</strong>
                                            <PdfCvLink href={modalCvUrl} fileName={candidateCvFileName(selectedCandidateDetails)} size={40} />
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {/* Professional Info */}
                            <div className="candidates-modal-detail-card">
                                <h3 className="candidates-modal-section-title">
                                    {t('candidates_sectionProfessional')}
                                </h3>
                                <div className="candidates-modal-body-text">
                                    <div><strong>{t('candidates_labelExperience')}:</strong> {modalYearsDisplay}</div>
                                    <div><strong>{t('candidates_labelEducation')}:</strong> {selectedCandidateDetails.highest_education_level || selectedCandidateDetails.highestEducationLevel || t('stageEval_notApplicable')}</div>
                                    <div><strong>{t('candidates_field_company')}:</strong> {selectedCandidateDetails.current_company || selectedCandidateDetails.currentCompany || t('stageEval_notApplicable')}</div>
                                    {selectedCandidateDetails.skills && selectedCandidateDetails.skills.length > 0 ? (
                                        <div style={{ marginTop: '4px' }}>
                                            <strong>{t('candidates_field_skills')}:</strong>{' '}
                                            {formatUniqueListField(selectedCandidateDetails.skills) || t('stageEval_notApplicable')}
                                        </div>
                                    ) : null}
                            </div>
                                    </div>

                            {/* AI Evaluation */}
                            {modalEval && (
                                <div className="candidates-modal-detail-card candidates-modal-detail-card--wide">
                                    <h3 className="candidates-modal-section-title">
                                        {t('candidates_sectionAiEval')}
                                        <span style={{
                                            marginInlineStart: '8px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            color: '#38BDF8',
                                            background: 'rgba(56, 189, 248, 0.12)',
                                            border: '1px solid rgba(56, 189, 248, 0.28)',
                                            borderRadius: '6px',
                                            padding: '2px 8px'
                                        }}>
                                            {t(evaluationSourceLabelKey(modalEval.source))}
                                        </span>
                                    </h3>
                                    {modalEval.insufficient && (
                                        <div
                                            role="status"
                                            style={{
                                                margin: '0 0 14px',
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                lineHeight: 1.5,
                                                color: '#F59E0B',
                                                background: 'rgba(245, 158, 11, 0.10)',
                                                border: '1px solid rgba(245, 158, 11, 0.30)',
                                            }}
                                        >
                                            {t('candidates_evalInsufficientData')}
                                        </div>
                                    )}
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{
                                            fontSize: '32px',
                                            fontWeight: 700,
                                            background: modalEval.score >= 80 
                                                ? 'linear-gradient(135deg, #10B981, #059669)'
                                                : modalEval.score >= 60
                                                ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                                                : 'linear-gradient(135deg, #EF4444, #DC2626)',
                                            WebkitBackgroundClip: 'text',
                                            WebkitTextFillColor: 'transparent',
                                            backgroundClip: 'text',
                                            marginBottom: '8px'
                                        }}>
                                            {modalEval.score}%
                        </div>
                                        <div className="candidates-modal-body-text">
                                            {modalEval.communication != null && (
                                                <div><strong>{t('candidates_aiCommunication')}</strong> {modalEval.communication}%</div>
                                            )}
                                            {modalEval.technical != null && (
                                                <div><strong>{t('candidates_aiTechnical')}</strong> {modalEval.technical}%</div>
                                            )}
                                            {modalEval.problemSolving != null && (
                                                <div><strong>{t('candidates_aiProblemSolving')}</strong> {modalEval.problemSolving}%</div>
                                            )}
                                            {modalEval.confidence != null && (
                                                <div><strong>{t('candidates_aiConfidence')}</strong> {modalEval.confidence}%</div>
                                            )}
                                            {modalEval.recommendation ? (
                                                <div><strong>{t('candidates_aiRecommendation')}</strong> {stageRecommendationLabel(modalEval.recommendation, t, modalEval.source)}</div>
                                            ) : null}
                    </div>
                </div>
                                    {modalEval.feedback && (
                                        <div className="candidates-modal-feedback-box">
                                            <div className="candidates-modal-feedback-label">
                                                {t('candidates_feedbackLabel')}
            </div>
                                            <div className="candidates-modal-body-text">
                                                {modalEval.feedback}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Cover Letter */}
                            {selectedCandidateDetails.coverLetter && (
                                <div className="candidates-modal-detail-card candidates-modal-detail-card--wide">
                                    <h3 className="candidates-modal-section-title">
                                        {t('candidates_coverLetterHeading')}
                                    </h3>
                                    <div
                                        className="candidates-modal-body-text candidates-modal-scroll-box"
                                        style={{ whiteSpace: 'pre-wrap' }}
                                    >
                                        {selectedCandidateDetails.coverLetter}
                                    </div>
                                </div>
                            )}

                            {/* Certificates */}
                            {modalCertificates.length > 0 && (
                                <div className="candidates-modal-detail-card candidates-modal-detail-card--wide">
                                    <h3 className="candidates-modal-section-title">
                                        {t('candidates_certificatesHeading')}
                                    </h3>
                                    <ul className="candidates-modal-certificate-list">
                                        {modalCertificates.map((file) => (
                                            <li key={file.filename} className="candidates-modal-certificate-item">
                                                <span aria-hidden style={{ fontSize: '18px', lineHeight: 1 }}>
                                                    {file.mimeType === 'application/pdf' ? '📄' : '🖼️'}
                                                </span>
                                                <a
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="candidates-modal-certificate-link"
                                                    title={file.originalName || file.filename}
                                                >
                                                    {file.originalName || file.filename}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Status Badge */}
                        <div className="candidates-modal-status-row">
                            {getStatusBadge(selectedCandidateDetails.status || 'pending')}
                        </div>
                    </div>
                </div>
                );
            })()}

            {clearModalOpen ? (
                <div
                    className="ai-compare-modal-overlay candidates-clear-from-view-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="candidates-clear-from-view-title"
                    onClick={() => (clearSubmitting ? null : setClearModalOpen(false))}
                >
                    <div className="candidates-clear-from-view-modal" onClick={(e) => e.stopPropagation()}>
                        <h3 id="candidates-clear-from-view-title" className="screening-campaign-delete-modal__title">
                            {t('candidates_clearFromViewTitle')}
                        </h3>
                        <p className="screening-campaign-delete-modal__text">
                            {t('candidates_clearFromViewConfirm')}
                        </p>
                        {clearError ? (
                            <p className="screening-campaign-delete-modal__text" role="alert" style={{ color: '#fca5a5' }}>
                                {clearError}
                            </p>
                        ) : null}
                        <div className="candidates-clear-from-view-modal__actions">
                            <button
                                type="button"
                                className="btn btn-secondary candidates-clear-from-view-modal__cancel"
                                onClick={() => setClearModalOpen(false)}
                                disabled={clearSubmitting}
                            >
                                {t('candidates_clearFromViewCancel')}
                            </button>
                            <button
                                type="button"
                                className="btn workflow-btn-primary candidates-clear-from-view-modal__confirm"
                                onClick={handleConfirmClear}
                                disabled={clearSubmitting}
                            >
                                {clearSubmitting
                                    ? t('candidates_clearFromViewClearing')
                                    : t('candidates_clearFromViewConfirmBtn')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            </div>
        </>
    );
};

export default Candidates;




