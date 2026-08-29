import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    candidateAvatarImageProps,
    candidatePhotoUrl,
    GenderAvatar,
    inferGenderFromName,
    shouldUseGenderAvatar,
} from '../utils/candidateAssets';
import '../design-styles.css';
import apiClient, { ApiError } from '../services/apiClient';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { hasMeaningfulStageEvaluation, normalizeStageEvalStringList } from '../utils/stageRecommendation.js';
import { scriptTextProps } from '../utils/textScript.js';
import ScreeningCampaignList from '../components/screening/ScreeningCampaignList.jsx';
import StageRefreshButton from '../components/screening/StageRefreshButton.jsx';
import ScreeningAiComparePanel from '../components/screening/ScreeningAiComparePanel.jsx';
import StageEvalBackButton from '../components/screening/StageEvalBackButton.jsx';
import AiCompareTopEmailModal from '../components/screening/AiCompareTopEmailModal.jsx';
import { countEligibleCompareCandidates } from '../utils/compareTopCreditCost.js';
import ScreeningAiCompareNeedTwoNotice from '../components/screening/ScreeningAiCompareNeedTwoNotice.jsx';
import MobilePinchPanViewport from '../components/MobilePinchPanViewport.jsx';
import StageEvalShareButton from '../components/screening/StageEvalShareButton.jsx';
import { useStageEvalDeepLink } from '../hooks/useStageEvalDeepLink.js';
import { useStageCampaignHide } from '../hooks/useStageCampaignHide.js';
import {
    buildScreeningCampaignGroups,
    collectCampaignIdsFromCandidates,
    findCampaignGroup,
    splitVideoCandidates,
} from '../utils/videoCampaigns.js';
import {
    buildShareCompanyLine,
    resolveShareAdvertisingCompany,
} from '../utils/shareInterviewLink.js';
import {
    fetchCampaignMetaByIds,
    fetchStageBoardCandidates,
    readStageBoardSnapshot,
    writeStageBoardSnapshot,
} from '../utils/stageBoard.js';
import { absoluteAppUrl } from '../config/apiBase.js';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { onEvent } from '../services/eventsSocket';
import { buildCandidateInterviewQuery, resolveSharePersonId, resolveShareApplicationId } from '../utils/interviewShareLink.js';
import { localizeCatalogLabel } from '../utils/localizeCatalogLabel.js';
import {
    buildBlueprintCompetencyRows,
    buildFinalRoleFitDetail,
    buildRoleUnderstandingDetail,
    buildVideoFinalHrText,
    buildVideoRedFlags,
    formatTableTenScore,
    isInsufficientVideoEvaluation,
    isLegacyVideoEvaluation,
    qualitativeBandFromTenScore,
    resolveVideoRecommendation,
    shouldHideOverallScore,
} from '../utils/videoInterviewEvalDisplay.js';

/** المرحلة لمسار المقارنة (Stage 3). */
const AI_COMPARE_STAGE = 'video';

function campaignLabels(t) {
    return {
        uncategorized: t('screeningCampaignUncategorized'),
        deleted: t('screeningCampaignDeleted'),
        unknownCampaign: t('videoInterviewPageTitle'),
    };
}

/** Rebuilds the board from the cached payload, so a restored view is shaped exactly like a fetched one. */
function groupsFromSnapshot(snapshot, t) {
    const { evaluated, pending } = splitVideoCandidates(snapshot.candidates);
    return buildScreeningCampaignGroups(evaluated, pending, snapshot.meta, campaignLabels(t), {
        metaPending: !snapshot.metaComplete,
    });
}

const VideoInterview = () => {
    const { t, currentLang } = useLanguage();
    const na = t('stageEval_notApplicable');

    const translateRecLabel = (canonical) => {
        switch (canonical) {
            case 'Hire':
                return t('stageEval_recHire');
            case 'Consider':
                return t('stageEval_recConsider');
            case 'Reject':
                return t('stageEval_recReject');
            case 'N/A':
                return t('stageEval_recNa');
            default:
                return canonical;
        }
    };

    const recommendationMatchesFilter = (rawRec, filterVal) => {
        if (filterVal === 'all') return true;
        const n = String(rawRec ?? '').trim().toLowerCase();
        return n === filterVal;
    };

    const renderQualitativeCell = (score) => (
        <div className="stage-eval-cell-value">
            {formatTableTenScore(score, t, na)}
        </div>
    );

    const restoredSnapshot = useMemo(() => readStageBoardSnapshot(), []);
    const [campaignGroups, setCampaignGroups] = useState(() =>
        restoredSnapshot
            ? groupsFromSnapshot(restoredSnapshot, t)
            : { active: [], uncategorized: null }
    );
    /** null = campaign list; string = drill-down selection key */
    const [selectedCampaignKey, setSelectedCampaignKey] = useState(null);
    const [loading, setLoading] = useState(restoredSnapshot == null);
    /** Discards a slow response once a newer fetch has started. */
    const fetchSeqRef = useRef(0);
    /** Blocking fetch that currently owns the loading line; background fetches never take it. */
    const loadingOwnerRef = useRef(0);
    const paintedFromSnapshotRef = useRef(restoredSnapshot != null);
    const getLabels = useCallback(() => campaignLabels(t), [t]);
    const { hideCampaign, undoHide, hideUndo, rememberPayload, payloadRef, keepPendingHide } = useStageCampaignHide({
        stage: 'video',
        split: splitVideoCandidates,
        getLabels,
        setCampaignGroups,
        setSelectedCampaignKey,
        initialSnapshot: restoredSnapshot,
    });
    const [filter, setFilter] = useState('all'); // all, hire, consider, reject
    const [expandedRows, setExpandedRows] = useState(new Set());

    // AI Compare Top (Stage 3 — مستقل عن باقي الـ webhooks)
    const [aiCompareModalOpen, setAiCompareModalOpen] = useState(false);
    const [aiCompareSubmitting, setAiCompareSubmitting] = useState(false);
    /** 'idle' | 'pending' | 'completed' | 'failed' | 'timeout' */
    const [aiCompareStatus, setAiCompareStatus] = useState('idle');
    const [aiCompareResult, setAiCompareResult] = useState(null);
    const [aiCompareRequestId, setAiCompareRequestId] = useState(null);
    const [aiComparePanelOpen, setAiComparePanelOpen] = useState(false);
    const [aiCompareNeedTwoOpen, setAiCompareNeedTwoOpen] = useState(false);

    const selectedGroup = useMemo(
        () => (selectedCampaignKey ? findCampaignGroup(campaignGroups, selectedCampaignKey) : null),
        [campaignGroups, selectedCampaignKey]
    );

    const evaluatedCandidates = selectedGroup?.evaluated ?? [];
    const campaignCandidates = useMemo(() => {
        if (!selectedGroup) return [];
        const all = [...evaluatedCandidates, ...(selectedGroup.pending ?? [])];
        return all.sort((a, b) => {
            const ta = new Date(a.createdAt || a.updatedAt || 0).getTime();
            const tb = new Date(b.createdAt || b.updatedAt || 0).getTime();
            return tb - ta;
        });
    }, [selectedGroup, evaluatedCandidates]);

    const compareCandidateCount = useMemo(
        () => countEligibleCompareCandidates(campaignCandidates, 'video'),
        [campaignCandidates],
    );

    const filteredCandidates = useMemo(
        () =>
            campaignCandidates.filter((c) => {
                if (!hasMeaningfulStageEvaluation(c.videoInterviewEvaluation)) {
                    return filter === 'all';
                }
                return recommendationMatchesFilter(c.videoInterviewEvaluation?.recommendation, filter);
            }),
        [campaignCandidates, filter]
    );

    // Blueprint (Stage 3 v2) evaluations have their own competencies per role, so
    // the eight fixed trait columns cannot describe them. Collapse the header into
    // one spanning column UNLESS a row is positively a legacy 8-trait record. Keying
    // off "not legacy" (rather than "every row is blueprint") keeps the single
    // column as the default while data is still loading, so the header never flashes
    // the old eight columns for a beat before the competencies resolve.
    const allRowsAreBlueprint = useMemo(
        () =>
            !filteredCandidates.some((c) =>
                isLegacyVideoEvaluation(c.videoInterviewEvaluation)
            ),
        [filteredCandidates]
    );

    useStageEvalDeepLink({
        loading,
        campaignGroups,
        campaignCandidates,
        selectedCampaignKey,
        setSelectedCampaignKey,
        setExpandedRows,
        setFilter,
    });

    const selectedCampaignId = selectedGroup?.campaignId ?? null;

    const applyAiCompareFromResult = (r, autoOpen = true) => {
        if (!r) return;
        setAiCompareResult(r);
        setAiCompareRequestId(r.requestId || null);
        if (r.status === 'completed') {
            setAiCompareStatus('completed');
            if (autoOpen) setAiComparePanelOpen(true);
        } else if (r.status === 'failed' || r.status === 'refunded' || r.status === 'expired') {
            setAiCompareStatus('failed');
            if (autoOpen) setAiComparePanelOpen(true);
        } else if (r.status === 'pending' || r.status === 'processing') {
            setAiCompareStatus('pending');
            setAiComparePanelOpen(true);
        }
    };

    const fetchAiCompareState = async () => {
        if (!selectedCampaignId) return null;
        const json = await apiClient.get(
            `/api/recruitment-campaigns/${encodeURIComponent(selectedCampaignId)}/ai-compare-top?stage=${AI_COMPARE_STAGE}`
        );
        if (json?.success && json.result) {
            applyAiCompareFromResult(json.result);
            return json.result;
        }
        return null;
    };

    const handleViewLastAiCompare = async () => {
        try {
            await fetchAiCompareState();
        } catch (err) {
            console.warn('⚠️ AI compare view-last failed:', err);
        }
    };

    const handleOpenAiCompare = () => {
        if (campaignCandidates.length < 2) {
            setAiCompareNeedTwoOpen(true);
            return;
        }
        setAiCompareNeedTwoOpen(false);
        setAiCompareModalOpen(true);
    };

    const handleStartAiCompare = async (emails) => {
        if (!selectedCampaignId) return;
        setAiCompareSubmitting(true);
        try {
            const json = await apiClient.post(
                `/api/recruitment-campaigns/${encodeURIComponent(selectedCampaignId)}/ai-compare-top?stage=${AI_COMPARE_STAGE}`,
                { emails }
            );
            if (!json?.success) {
                setAiCompareStatus('failed');
                setAiCompareResult({ status: 'failed', emails, error: json?.message || json?.error });
                setAiComparePanelOpen(true);
                setAiCompareModalOpen(false);
                return;
            }
            setAiCompareRequestId(json.requestId);
            setAiCompareResult({ status: 'pending', emails, requestId: json.requestId });
            setAiCompareStatus('pending');
            setAiComparePanelOpen(true);
            setAiCompareModalOpen(false);
        } catch (err) {
            console.error('❌ AI compare trigger failed:', err);
            setAiCompareStatus('failed');
            setAiCompareResult({
                status: 'failed',
                emails,
                error: err instanceof ApiError ? err.data?.message || err.message : String(err?.message || err),
            });
            setAiComparePanelOpen(true);
            setAiCompareModalOpen(false);
        } finally {
            setAiCompareSubmitting(false);
        }
    };

    const handleToggleCampaignStatus = async (row, nextStatus) => {
        const campaignId = row?.campaignId;
        if (!campaignId) return;
        try {
            await apiClient.patch(
                `/api/recruitment-campaigns/${encodeURIComponent(campaignId)}/status`,
                { status: nextStatus }
            );
        } catch (err) {
            console.error('❌ Campaign status update failed:', err);
        } finally {
            await fetchCandidates({ background: true, skipInterim: true });
        }
    };

    useEffect(() => {
        // The snapshot is already on screen, so the opening fetch must not replace it
        // with a loading line. A later run (language switch, manual refresh) still does.
        const silent = paintedFromSnapshotRef.current;
        paintedFromSnapshotRef.current = false;
        fetchCandidates({ background: silent });
    }, [currentLang]);

    useEffect(() => {
        setExpandedRows(new Set());
        setFilter('all');
        // إعادة ضبط حالة المقارنة عند تبديل الحملة + جلب آخر نتيجة محفوظة إن وُجدت
        setAiCompareModalOpen(false);
        setAiCompareSubmitting(false);
        setAiCompareStatus('idle');
        setAiCompareResult(null);
        setAiCompareRequestId(null);
        setAiComparePanelOpen(false);
        setAiCompareNeedTwoOpen(false);

        if (!selectedCampaignId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const json = await apiClient.get(
                    `/api/recruitment-campaigns/${encodeURIComponent(selectedCampaignId)}/ai-compare-top?stage=${AI_COMPARE_STAGE}`
                );
                if (cancelled || !json?.success || !json.result) return;
                // Restore a past result on load WITHOUT auto-opening the panel — the
                // "view last comparison" button lets HR open it on demand.
                applyAiCompareFromResult(json.result, false);
            } catch (err) {
                console.warn('⚠️ AI compare hydrate failed:', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedCampaignKey, selectedCampaignId]);

    // Polling: عند pending نستطلع كل 3 ثوانٍ، بحد أقصى 40 محاولة (≈120 ثانية)
    useEffect(() => {
        if (aiCompareStatus !== 'pending' || !selectedCampaignId || !aiCompareRequestId) {
            return undefined;
        }
        let attempts = 0;
        let stopped = false;
        const interval = setInterval(async () => {
            attempts += 1;
            if (attempts > 40) {
                clearInterval(interval);
                if (!stopped) setAiCompareStatus('timeout');
                return;
            }
            try {
                const json = await apiClient.get(
                    `/api/recruitment-campaigns/${encodeURIComponent(selectedCampaignId)}/ai-compare-top?stage=${AI_COMPARE_STAGE}`
                );
                const r = json?.result;
                // تجاهل النتائج التي لا تطابق آخر طلب (stale)
                if (!r || r.requestId !== aiCompareRequestId) return;
                const terminal = r.status === 'completed'
                    ? 'completed'
                    : (r.status === 'failed' || r.status === 'refunded' || r.status === 'expired')
                        ? 'failed'
                        : null;
                if (terminal) {
                    clearInterval(interval);
                    if (!stopped) {
                        setAiCompareResult(r);
                        setAiCompareStatus(terminal);
                    }
                }
            } catch (err) {
                console.warn('⚠️ AI compare poll failed:', err);
            }
        }, 3000);
        return () => {
            stopped = true;
            clearInterval(interval);
        };
    }, [aiCompareStatus, selectedCampaignId, aiCompareRequestId]);

    // Live: surface AI-compare results instantly when the compare completes/fails.
    useEffect(() => {
        const handle = (evt) => {
            const p = evt?.payload || {};
            if (p.campaignId === selectedCampaignId && (!aiCompareRequestId || p.requestId === aiCompareRequestId)) {
                void fetchAiCompareState();
            }
        };
        const off1 = onEvent('CompareCompleted', handle);
        const off2 = onEvent('CompareFailed', handle);
        return () => {
            off1();
            off2();
        };
    }, [selectedCampaignId, aiCompareRequestId]);

    useEffect(() => {
        const previous = document.title;
        document.title = `${t('videoInterviewPageTitle')} · ${t('companyName')}`;
        return () => {
            document.title = previous;
        };
    }, [t, currentLang]);

    // Note: Backend will receive data from a different webhook URL for stage 3
    // The webhook should send videoInterviewEvaluation with the following fields:
    // - communication (number, e.g., 7.5)
    // - language_fluency (string, e.g., "Medium")
    // - confidence (string, e.g., "High")
    // - problem_solving (number, e.g., 6.0)
    // - digital_skills (string, e.g., "Good")
    // - overall_fit (string, e.g., "Good")
    // - overall_score (number, percentage)
    // - professional_attitude (string) or fit_for_role (string) - for backward compatibility
    // - recommendation (string: "Hire", "Consider", "Reject")
    const fetchCandidates = async (opts = {}) => {
        const { background = false, skipInterim = false } = opts || {};
        const seq = ++fetchSeqRef.current;
        const isCurrent = () => seq === fetchSeqRef.current;
        const ownsLoading = !background;
        const releaseLoadingIfOwned = () => {
            if (loadingOwnerRef.current !== seq) return;
            loadingOwnerRef.current = 0;
            setLoading(false);
        };
        try {
            if (ownsLoading) {
                loadingOwnerRef.current = seq;
                setLoading(true);
            }
            const loaded = await fetchStageBoardCandidates();
            if (!isCurrent()) return;

            if (!loaded) {
                console.warn('⚠️ No candidates data received');
                setCampaignGroups({ active: [], uncategorized: null });
                return;
            }

            const candidates = keepPendingHide(loaded);

            const { evaluated, pending } = splitVideoCandidates(candidates);
            const campaignIds = collectCampaignIdsFromCandidates(evaluated, pending);
            const labels = campaignLabels(t);
            rememberPayload({
                candidates,
                meta: skipInterim ? payloadRef.current.meta : {},
                metaComplete: false,
            });

            if (!skipInterim) {
                setCampaignGroups(
                    buildScreeningCampaignGroups(evaluated, pending, {}, labels, {
                        metaPending: campaignIds.length > 0,
                    })
                );
            } else {
                setCampaignGroups(
                    buildScreeningCampaignGroups(evaluated, pending, payloadRef.current.meta, labels, {
                        metaPending: true,
                    })
                );
            }
            if (ownsLoading) releaseLoadingIfOwned();

            const { meta, complete } = await fetchCampaignMetaByIds(campaignIds);
            if (!isCurrent() || !complete) return;
            rememberPayload({ candidates, meta, metaComplete: true });
            setCampaignGroups(buildScreeningCampaignGroups(evaluated, pending, meta, labels));
            writeStageBoardSnapshot({ candidates, meta, metaComplete: true });
        } catch (error) {
            // The board keeps whatever it was showing: emptying it on a dropped
            // request throws away the rows the user is reading, and the next refresh
            // or live event retries anyway. Stages 1 and 2 behave the same way.
            console.error('❌ Error fetching candidates:', error);
        } finally {
            if (ownsLoading) releaseLoadingIfOwned();
        }
    };

    // Live: refresh the video board in the background when relevant domain events arrive.
    useLiveRefresh(
        ['VideoEvaluationCompleted', 'VideoSessionCompleted', 'CandidateStatusChanged', 'CandidateApplied'],
        () => fetchCandidates({ background: true, skipInterim: true }),
    );

    const getRecommendationColor = (recommendation) => {
        switch (recommendation) {
            case 'Hire':
                return { bg: 'rgba(16, 185, 129, 0.2)', border: 'rgba(16, 185, 129, 0.4)', text: '#10B981' };
            case 'Consider':
                return { bg: 'rgba(245, 158, 11, 0.2)', border: 'rgba(245, 158, 11, 0.4)', text: '#F59E0B' };
            case 'Reject':
                return { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.4)', text: '#EF4444' };
            default:
                return { bg: 'rgba(148, 163, 184, 0.2)', border: 'rgba(148, 163, 184, 0.4)', text: '#94A3B8' };
        }
    };

    const getScoreColor = (score) => {
        if (score >= 80) return { bg: 'rgba(16, 185, 129, 0.2)', text: '#10B981' };
        if (score >= 60) return { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B' };
        return { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444' };
    };

    const buildShareData = (candidate) => {
        const candidateId = resolveSharePersonId(candidate);
        const campaignId = candidate.campaignId;
        const q = buildCandidateInterviewQuery({
            candidateId,
            campaignId,
            applicationId: resolveShareApplicationId(candidate),
            language: currentLang,
        });
        const interviewLink = absoluteAppUrl(`/video-interview-call?${q.toString()}`);

        const name =
            ((candidate.full_name || candidate.fullName) || '').trim()
            || candidate.email?.split('@')[0]
            || t('stageEval_unknownCandidate');
        const position = localizeCatalogLabel(
            candidate.position_applied_for || candidate.positionAppliedFor || na,
            currentLang,
        );
        const phone = typeof candidate.phone === 'string' ? candidate.phone.trim() : '';
        const email = typeof candidate.email === 'string' ? candidate.email.trim() : '';

        const company = resolveShareAdvertisingCompany(candidate, selectedGroup);
        const companyLine = buildShareCompanyLine(t, company);

        const shareText = fillI18nTemplate(t('videoInterview_shareBody'), {
            name,
            position,
            companyLine,
            link: interviewLink,
            score: candidate.videoInterviewEvaluation?.overall_score || 0,
            recommendation: translateRecLabel(
                resolveVideoRecommendation(candidate.videoInterviewEvaluation)
            ),
            email: email || na,
            phone: phone || na,
        });

        const emailSubject = fillI18nTemplate(t('videoInterview_shareNavigatorTitle'), { name });

        return { shareText, interviewLink, phone, email, name, emailSubject };
    };

    const showCampaignList = selectedCampaignKey === null;

    const listView = (
        <div
            className="dashboard-page dashboard-page--evaalo-visual ai-head-hunter-page headhunter-campaign-history-page dashboard-page--full-viewport-shell"
            style={{ color: '#ffffff', position: 'relative' }}
        >
            <div className="design-background design-background--evaalo-visual">
                <div className="design-orb-1" />
                <div className="design-orb-2" />
                <div className="design-orb-3" />
                    </div>
            <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
            <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

            <MobilePinchPanViewport className="mobile-pinch-pan-viewport--dashboard-shell">
            <div className="container dashboard-visual-container">
                <div className="dashboard-grid">
                    <div className="dashboard-card dashboard-card--page-active platform-features-card">
                        {loading ? (
                            <div className="dashboard-card-body">
                                <p className="headhunter-campaign-history-empty" role="status">
                                    {t('stageEval_loading')}
                                </p>
                            </div>
                        ) : (
                            <ScreeningCampaignList
                                activeCampaigns={campaignGroups.active}
                                uncategorized={campaignGroups.uncategorized}
                                onSelect={(key) => setSelectedCampaignKey(key)}
                                onRefresh={() => fetchCandidates({ background: true })}
                                onHideCampaign={hideCampaign}
                                onToggleCampaignStatus={handleToggleCampaignStatus}
                                hideUndo={hideUndo}
                                onUndoHide={undoHide}
                                titleKey="videoInterviewCampaignsTitle"
                                emptyKey="videoInterviewCampaignsEmpty"
                                activeSectionKey="videoInterviewCampaignsActiveSection"
                            />
                        )}
                    </div>
                </div>
            </div>
            </MobilePinchPanViewport>
        </div>
    );

    const detailView = (
        <div
            className="dashboard-page dashboard-page--evaalo-visual ai-head-hunter-page headhunter-campaign-history-page dashboard-page--full-viewport-shell"
            style={{ color: '#ffffff', position: 'relative' }}
        >
            <div className="design-background design-background--evaalo-visual">
                <div className="design-orb-1" />
                <div className="design-orb-2" />
                <div className="design-orb-3" />
            </div>
            <div className="dashboard-evaalo-visual-texture" aria-hidden="true" />
            <div className="dashboard-evaalo-visual-gridlines" aria-hidden="true" />

            <MobilePinchPanViewport className="mobile-pinch-pan-viewport--dashboard-shell">
            <div className="container dashboard-visual-container">
                <div className="design-header" style={{ marginBottom: '28px' }}>
                    <div className="header-content">
                        <h1 className="design-title" style={{ marginBottom: 0 }}>
                            {selectedGroup?.title
                                ? localizeCatalogLabel(selectedGroup.title, currentLang)
                                : t('videoInterviewPageTitle')}
                        </h1>
                        {selectedGroup?.location ? (
                            <p className="design-subtitle" style={{ marginTop: '10px', fontSize: '15px' }}>
                                {localizeCatalogLabel(selectedGroup.location, currentLang)}
                            </p>
                        ) : null}
                    </div>
                    <div className="header-actions" style={{ flexWrap: 'wrap', gap: '10px' }}>
                        <StageEvalBackButton onClick={() => setSelectedCampaignKey(null)} />
                        {/* تمرير الدالة مباشرة كان يبعث حدث النقر كخيارات، فيسقط الجدول إلى سطر تحميل بلا داعٍ */}
                        <StageRefreshButton
                            onRefresh={() => fetchCandidates({ background: true })}
                            label={t('stageEval_refresh')}
                        />
                        {['all', 'Hire', 'Consider', 'Reject'].map((filterOption) => {
                            const isActive = filter === filterOption.toLowerCase();
                            return (
                                <button
                                    key={filterOption}
                                    type="button"
                                    className={`btn btn-secondary candidates-toolbar-filter-btn stage-eval-filter-btn${isActive ? ' stage-eval-filter-btn--active' : ''}`}
                                    onClick={() => setFilter(filterOption.toLowerCase())}
                                    >
                                        {filterOption === 'all' && (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M2.5 5H17.5M5 10H15M7.5 15H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                            </svg>
                                        )}
                                        {filterOption === 'Hire' && (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M10 2.5L12.5 7.5L17.5 8.75L14.5 12.5L15.5 17.5L10 15L4.5 17.5L5.5 12.5L2.5 8.75L7.5 7.5L10 2.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        )}
                                        {filterOption === 'Consider' && (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2"/>
                                                <path d="M10 6V10L13 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                            </svg>
                                        )}
                                        {filterOption === 'Reject' && (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2"/>
                                                <path d="M7.5 7.5L12.5 12.5M12.5 7.5L7.5 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                            </svg>
                                        )}
                                    <span className="btn-text">
                                        {filterOption === 'all'
                                            ? t('stageEval_all')
                                            : filterOption === 'Hire'
                                              ? t('stageEval_recHire')
                                              : filterOption === 'Consider'
                                                ? t('stageEval_recConsider')
                                                : t('stageEval_recReject')}
                                    </span>
                                </button>
                            );
                        })}
                        {selectedCampaignId ? (
                            <button
                                type="button"
                                className="workflow-btn-primary head-hunter-submit-btn ai-compare-top-btn"
                                onClick={handleOpenAiCompare}
                                disabled={aiCompareStatus === 'pending'}
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
                                    <span className="btn-text btn-text--full">{t('aiCompareTop_button')}</span>
                                    <span className="btn-text btn-text--short">{t('aiCompareTop_buttonShort')}</span>
                                </span>
                            </button>
                        ) : null}
                        {selectedCampaignId && aiCompareResult?.status === 'completed' && !aiComparePanelOpen ? (
                            <button
                                type="button"
                                className="ai-compare-top-view-btn"
                                onClick={handleViewLastAiCompare}
                                title={t('aiCompareTop_viewLastTitle')}
                                aria-label={t('aiCompareTop_viewLastTitle')}
                            >
                                <svg width="22" height="22" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                    <path
                                        d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <circle cx="10" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
                                </svg>
                            </button>
                        ) : null}
                    </div>
                </div>

                <ScreeningAiCompareNeedTwoNotice
                    open={aiCompareNeedTwoOpen}
                    onDismiss={() => setAiCompareNeedTwoOpen(false)}
                    t={t}
                />

                {aiComparePanelOpen && aiCompareStatus !== 'idle' ? (
                    <div style={{ marginBottom: '24px' }}>
                        <ScreeningAiComparePanel
                            candidates={campaignCandidates}
                            campaignTitle={
                                selectedGroup?.title
                                    ? localizeCatalogLabel(selectedGroup.title, currentLang)
                                    : ''
                            }
                            uiStage="video"
                            status={aiCompareStatus}
                            result={aiCompareResult}
                            onDismiss={() => setAiComparePanelOpen(false)}
                        />
                </div>
                ) : null}

                {/* Table */}
                {loading ? (
                    <div className="stage-eval-loading">
                        {t('stageEval_loading')}
                    </div>
                ) : campaignCandidates.length > 0 ? (
                    <div className="stage-eval-table-shell">
                        <div className="stage-eval-table-scroll">
                            <table className="stage-eval-table">
                                <thead>
                                    <tr style={{ 
                                        background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                                        borderBottom: '2px solid rgba(34, 211, 238, 0.5)'
                                    }}>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'left', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px', 
                                            width: '40px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}></th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'left', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            minWidth: '250px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('stageEval_colCandidate')}</th>
                                        {allRowsAreBlueprint ? (
                                            <th colSpan={8} style={{
                                                padding: '16px',
                                                textAlign: 'center',
                                                color: '#22d3ee',
                                                fontWeight: 600,
                                                fontSize: '14px',
                                                borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                            }}>{t('videoInterview_sectionCompetencies')}</th>
                                        ) : ([
                                            'videoInterview_colProfessionalDepth',
                                            'videoInterview_colProblemHandling',
                                            'videoInterview_colDecisionMaking',
                                            'videoInterview_colPrioritization',
                                            'videoInterview_colProcessThinking',
                                            'videoInterview_colResponsibility',
                                            'videoInterview_colLearningAbility',
                                            'videoInterview_colJobReadiness',
                                        ].map((labelKey) => (
                                            <th key={labelKey} style={{
                                                padding: '16px',
                                                textAlign: 'center',
                                                color: '#22d3ee',
                                                fontWeight: 600,
                                                fontSize: '14px',
                                                borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                            }}>{t(labelKey)}</th>
                                        )))}
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                            minWidth: '140px'
                                        }}>{t('stageEval_colRecommendation')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px', 
                                            width: '80px'
                                        }}>{t('stageEval_colShare')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCandidates.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={12}
                                                className="stage-eval-empty-cell"
                                            >
                                                {evaluatedCandidates.length === 0
                                                    ? t('videoInterviewNoEvaluations')
                                                    : fillI18nTemplate(t('videoInterviewNoFilterMatch'), {
                                                          filter:
                                                              filter === 'all'
                                                                  ? t('stageEval_all')
                                                                  : filter === 'hire'
                                                                    ? t('stageEval_recHire')
                                                                    : filter === 'consider'
                                                                      ? t('stageEval_recConsider')
                                                                      : t('stageEval_recReject'),
                                                      })}
                                            </td>
                                        </tr>
                                    ) : null}
                                    {filteredCandidates.map((candidate, index) => {
                                        const evaluation = candidate.videoInterviewEvaluation;
                                        const scoreColors = getScoreColor(evaluation?.overall_score || 0);
                                        const recCanon = resolveVideoRecommendation(evaluation);
                                        const recColors = getRecommendationColor(recCanon);
                                        const finalHrEvaluationText = buildVideoFinalHrText(
                                            evaluation,
                                            t,
                                            translateRecLabel,
                                        );
                                        const roleUnderstandingText = buildRoleUnderstandingDetail(evaluation, t);
                                        const finalRoleFitText = buildFinalRoleFitDetail(evaluation, t);
                                        const redFlags = buildVideoRedFlags(evaluation, t);
                                        // Default to the blueprint layout; fall back to the legacy
                                        // eight columns only for a record positively identified as an
                                        // old 8-trait result. A still-loading eval renders as blueprint
                                        // (empty competencies) instead of flashing the old columns.
                                        const isBlueprint = !isLegacyVideoEvaluation(evaluation);
                                        const competencyRows = isBlueprint ? buildBlueprintCompetencyRows(evaluation) : [];
                                        const insufficientEval = isInsufficientVideoEvaluation(evaluation);
                                        const hideScore = shouldHideOverallScore(evaluation);
                                        const evalStrengths = normalizeStageEvalStringList(evaluation?.strengths);
                                        const evalWeaknesses = normalizeStageEvalStringList(evaluation?.weaknesses);
                                        const candidateId = candidate._id || candidate.id;
                                        const isExpanded = expandedRows.has(candidateId);
                                        const photoUrl = candidatePhotoUrl(candidate);
                                        
                                        const toggleRow = (e) => {
                                            // Don't expand if clicking on share button
                                            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                                                return;
                                            }
                                            setExpandedRows(prev => {
                                                const newSet = new Set(prev);
                                                if (newSet.has(candidateId)) {
                                                    newSet.delete(candidateId);
                                                } else {
                                                    newSet.add(candidateId);
                                                }
                                                return newSet;
                                            });
                                        };
                                        
                                        return (
                                            <React.Fragment key={candidateId}>
                                            <tr 
                                                className="stage-eval-table-row"
                                                data-stage-candidate-id={String(candidateId)}
                                                onClick={toggleRow}
                                            >
                                                {/* Expand/Collapse Icon */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center', 
                                                    width: '40px',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <svg 
                                                        width="20" 
                                                        height="20" 
                                                        viewBox="0 0 20 20" 
                                                        fill="none" 
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="stage-eval-row-toggle"
                                                        style={{
                                                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                        }}
                                                    >
                                                        <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                    </svg>
                                                </td>
                                                {/* Candidate Name */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    minWidth: '250px',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                                        {/* Profile Photo */}
                                                        <div
                                                            className="candidate-avatar-ring"
                                                            style={{
                                                            width: '52px',
                                                            height: '52px',
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
                                                                    alt={((candidate.full_name || candidate.fullName) || '').trim() || t('stageEval_profilePhotoAlt')} 
                                                                    className="candidate-avatar-photo"
                                                                    decoding="async"
                                                                    draggable={false}
                                                                    {...candidateAvatarImageProps(photoUrl, 52)}
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
                                                                    size={52}
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
                                                                {((candidate.full_name || candidate.fullName)?.[0] || candidate.email?.[0] || '?').toUpperCase()}
                                                            </div>
                                                            )}
                                                        </div>
                                                        <div className="stage-eval-candidate-cell" style={{ flex: 1, minWidth: 0 }}>
                                                            {(() => {
                                                                const candidateName = ((candidate.full_name || candidate.fullName) || '').trim()
                                                                    ? (candidate.full_name || candidate.fullName).trim()
                                                                    : candidate.email?.split('@')[0] || t('stageEval_unknownCandidate');
                                                                const positionLabel = localizeCatalogLabel(
                                                                    candidate.position_applied_for ||
                                                                        candidate.positionAppliedFor ||
                                                                        na,
                                                                    currentLang,
                                                                );
                                                                return (
                                                                    <>
                                                                        <div {...scriptTextProps(candidateName)}>{candidateName}</div>
                                                                        <div {...scriptTextProps(positionLabel)}>{positionLabel}</div>
                                                                    </>
                                                                );
                                                            })()}
                                                        {candidate.createdAt && (
                                                            <div>
                                                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.7 }}>
                                                                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1"/>
                                                                    <path d="M6 3V6L8 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                                                                </svg>
                                                                {new Date(candidate.createdAt).toLocaleString('en-US', {
                                                                    year: 'numeric',
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    hour: '2-digit',
                                                                    minute: '2-digit'
                                                                })}
                                                            </div>
                                                        )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {isBlueprint ? (
                                                    <td colSpan={8} style={{
                                                        padding: '14px 16px',
                                                        borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                        borderLeft: '1px solid rgba(34, 211, 238, 0.1)',
                                                        verticalAlign: 'middle'
                                                    }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94A3B8', marginBottom: '8px' }}>
                                                            {t('videoInterview_sectionCompetencies')}
                                                        </div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                            {competencyRows.length === 0 ? (
                                                                <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                            ) : competencyRows.map((row) => {
                                                                // Not assessed is not a failure, so show a neutral dash, not a red ✗.
                                                                // Label color lives in CSS (theme-aware): the old inline #CBD5E1 washed
                                                                // out on the light green tint in light mode.
                                                                const chipTone = !row.assessed ? 'na' : row.met ? 'met' : 'miss';
                                                                const chipSymbol = !row.assessed ? '–' : row.met ? '✓' : '✗';
                                                                return (
                                                                <span
                                                                    key={row.key}
                                                                    className={`stage-eval-competency-chip stage-eval-competency-chip--${chipTone}`}
                                                                >
                                                                    <span {...scriptTextProps(row.label, 'stage-eval-competency-chip__label')}>{row.label}</span>
                                                                    <span
                                                                        className="stage-eval-competency-chip__symbol"
                                                                        aria-label={!row.assessed ? t('videoInterview_notAssessed') : row.met ? t('videoInterview_competencyMet') : t('videoInterview_competencyNotMet')}
                                                                        title={row.assessed ? '' : t('videoInterview_notAssessed')}
                                                                    >
                                                                        {chipSymbol}
                                                                    </span>
                                                                    {row.redFlags.length > 0 ? (
                                                                        <span className="stage-eval-competency-chip__flag" title={row.redFlags.join(' • ')}>⚑</span>
                                                                    ) : null}
                                                                </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                ) : (<>
                                                {/* Professional Depth */}
                                                <td style={{
                                                    padding: '16px',
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.professional_depth)}
                                                    </div>
                                                </td>

                                                {/* Problem Handling */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.problem_handling)}
                                                    </div>
                                                </td>

                                                {/* Decision Making */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.decision_making)}
                                                    </div>
                                                </td>

                                                {/* Prioritization */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.prioritization)}
                                                    </div>
                                                </td>

                                                {/* Process Thinking */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.process_thinking)}
                                                    </div>
                                                </td>

                                                {/* Responsibility */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.responsibility)}
                                                    </div>
                                                </td>

                                                {/* Learning Ability */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.learning_ability)}
                                                    </div>
                                                </td>

                                                {/* Job Readiness */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {renderQualitativeCell(evaluation?.job_readiness)}
                                                    </div>
                                                </td>
                                                </>)}

                                                {/* Recommendation + overall score (مدمج) */}
                                                <td style={{ 
                                                    padding: '16px 12px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)',
                                                    verticalAlign: 'middle'
                                                }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        gap: '10px'
                                                    }}>
                                                        {/* An insufficient interview still carries a computed
                                                            percentage; showing it reads as a real pass mark, so
                                                            it is withheld and the verdict is shown on its own. */}
                                                        <div style={{
                                                            display: 'inline-block',
                                                            padding: '8px 16px',
                                                            borderRadius: '8px',
                                                            background: hideScore ? 'rgba(148, 163, 184, 0.15)' : scoreColors.bg,
                                                            color: hideScore ? '#94A3B8' : scoreColors.text,
                                                            fontWeight: 700,
                                                            fontSize: '18px',
                                                            lineHeight: 1.2
                                                        }}>
                                                            {hideScore ? '—' : `${evaluation?.overall_score ?? 0}%`}
                                                        </div>
                                                        {insufficientEval ? (
                                                            <div style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                background: 'rgba(245, 158, 11, 0.12)',
                                                                border: '1px solid rgba(245, 158, 11, 0.45)',
                                                                color: '#F59E0B',
                                                                fontWeight: 700,
                                                                fontSize: '12px',
                                                                lineHeight: 1.3
                                                            }}>
                                                                <span aria-hidden="true">⚠</span>
                                                                {t('videoInterview_insufficientBadge')}
                                                            </div>
                                                        ) : null}
                                                        {recCanon === 'N/A' ? null : (
                                                            <div style={{
                                                                display: 'inline-block',
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                background: recColors.bg,
                                                                border: `1px solid ${recColors.border}`,
                                                                color: recColors.text,
                                                                fontWeight: 600,
                                                                fontSize: '13px',
                                                                lineHeight: 1.3
                                                            }}>
                                                                {translateRecLabel(recCanon)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Share Button */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <StageEvalShareButton
                                                        candidate={candidate}
                                                        getShareData={buildShareData}
                                                        t={t}
                                                        shareTitle={t('videoInterviewShareTitle')}
                                                        interviewLinkReset={{
                                                            stage: 'video',
                                                            consumedAt: candidate.videoInterviewLinkConsumedAt,
                                                            onReset: () =>
                                                                fetchCandidates({
                                                                    background: true,
                                                                    skipInterim: true,
                                                                }),
                                                        }}
                                                    />
                                                </td>
                                            </tr>
                                            
                                            {/* Expanded Details Row */}
                                            {isExpanded && (
                                                <tr className="stage-eval-expanded-row">
                                                    <td colSpan={12} style={{ padding: '0' }}>
                                                        <div style={{
                                                            padding: '24px',
                                                            animation: 'slideDown 0.3s ease-out'
                                                        }}>
                                                            {insufficientEval ? (
                                                                <div role="alert" style={{
                                                                    display: 'flex',
                                                                    alignItems: 'flex-start',
                                                                    gap: '12px',
                                                                    padding: '14px 16px',
                                                                    marginBottom: '20px',
                                                                    borderRadius: '10px',
                                                                    background: 'rgba(245, 158, 11, 0.10)',
                                                                    border: '1px solid rgba(245, 158, 11, 0.45)'
                                                                }}>
                                                                    <span aria-hidden="true" style={{ fontSize: '18px', lineHeight: 1.2, color: '#F59E0B', flexShrink: 0 }}>⚠</span>
                                                                    <div>
                                                                        <div style={{ fontWeight: 700, color: '#F59E0B', marginBottom: '4px' }}>
                                                                            {t('videoInterview_insufficientTitle')}
                                                                        </div>
                                                                        <div {...scriptTextProps(t('candidates_evalInsufficientData'))} style={{ color: '#CBD5E1', fontSize: '13px', lineHeight: 1.5 }}>
                                                                            {t('candidates_evalInsufficientData')}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(2, 1fr)',
                                                                gap: '20px',
                                                                marginBottom: '20px'
                                                            }}>
                                                                {isBlueprint ? (
                                                                    /* Role competencies (blueprint / Stage 3 v2) — full width */
                                                                    <div className="stage-eval-detail-card" style={{ gridColumn: '1 / -1' }}>
                                                                        <h4 className="stage-eval-detail-card__title">
                                                                            {t('videoInterview_sectionCompetencies')}
                                                                        </h4>
                                                                        {competencyRows.length === 0 ? (
                                                                            <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                        ) : (
                                                                            <div className="stage-eval-competency-detail-list">
                                                                                {competencyRows.map((row) => {
                                                                                    const chipTone = !row.assessed ? 'na' : row.met ? 'met' : 'miss';
                                                                                    const chipSymbol = !row.assessed ? '–' : row.met ? '✓' : '✗';
                                                                                    const statusLabel = !row.assessed
                                                                                        ? t('videoInterview_notAssessed')
                                                                                        : row.met
                                                                                          ? t('videoInterview_competencyMet')
                                                                                          : t('videoInterview_competencyNotMet');
                                                                                    return (
                                                                                    <div key={row.key} className="stage-eval-competency-detail-item">
                                                                                        {/* Same colored chip as the Role Understanding table cell —
                                                                                            label + mark in one box, not status on the opposite side. */}
                                                                                        <span
                                                                                            className={`stage-eval-competency-chip stage-eval-competency-chip--${chipTone}`}
                                                                                        >
                                                                                            <span {...scriptTextProps(row.label, 'stage-eval-competency-chip__label')}>{row.label}</span>
                                                                                            <span
                                                                                                className="stage-eval-competency-chip__symbol"
                                                                                                aria-label={statusLabel}
                                                                                                title={!row.assessed ? statusLabel : ''}
                                                                                            >
                                                                                                {chipSymbol}
                                                                                            </span>
                                                                                            {row.redFlags.length > 0 ? (
                                                                                                <span className="stage-eval-competency-chip__flag" title={row.redFlags.join(' • ')}>⚑</span>
                                                                                            ) : null}
                                                                                        </span>
                                                                                        {row.evidence.length > 0 ? (
                                                                                            <ul {...scriptTextProps(row.evidence.join(' '), 'stage-eval-detail-card__list')}>
                                                                                                {row.evidence.map((ev, i) => (
                                                                                                    <li key={i} style={{ marginBottom: '4px' }} {...scriptTextProps(ev)}>{ev}</li>
                                                                                                ))}
                                                                                            </ul>
                                                                                        ) : null}
                                                                                        {row.redFlags.length > 0 ? (
                                                                                            <div className="stage-eval-competency-detail-item__flags" {...scriptTextProps(row.redFlags.join(' • '))}>
                                                                                                {'⚑ '}{row.redFlags.join(' • ')}
                                                                                            </div>
                                                                                        ) : null}
                                                                                    </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (<>
                                                                {/* Role Understanding */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('videoInterview_sectionRoleUnderstanding')}
                                                                    </h4>
                                                                    {roleUnderstandingText ? (
                                                                        <p {...scriptTextProps(roleUnderstandingText, 'stage-eval-detail-card__body')}>{roleUnderstandingText}</p>
                                                                    ) : (
                                                                        <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                    )}
                                                                </div>

                                                                {/* Final Fit for the Role */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('videoInterview_sectionFinalFit')}
                                                                    </h4>
                                                                    {finalRoleFitText ? (
                                                                        <p {...scriptTextProps(finalRoleFitText, 'stage-eval-detail-card__body')}>{finalRoleFitText}</p>
                                                                    ) : (
                                                                        <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                    )}
                                                                </div>
                                                                </>)}

                                                                {/* Red Flags */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('videoInterview_sectionRedFlags')}
                                                                    </h4>
                                                                    {redFlags.length > 0 ? (
                                                                        <ul {...scriptTextProps(redFlags.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {redFlags.map((flag, i) => (
                                                                                <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(flag)}>{flag}</li>
                                                                            ))}
                                                                        </ul>
                                                                    ) : (
                                                                        <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                    )}
                                                                </div>

                                                                {/* Summary */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_summary')}
                                                                    </h4>
                                                                    {(() => {
                                                                        const text = evaluation?.summary || t('stageEval_noSummary');
                                                                        return <p {...scriptTextProps(text, 'stage-eval-detail-card__body')}>{text}</p>;
                                                                    })()}
                                                                </div>

                                                                {/* Strengths (Stage 3 v2) */}
                                                                {evalStrengths.length > 0 ? (
                                                                    <div className="stage-eval-detail-card">
                                                                        <h4 className="stage-eval-detail-card__title">
                                                                            {t('stageEval_strengths')}
                                                                        </h4>
                                                                        <ul {...scriptTextProps(evalStrengths.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {evalStrengths.map((s, i) => (
                                                                                <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(s)}>{s}</li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                ) : null}

                                                                {/* Weaknesses (Stage 3 v2) */}
                                                                {evalWeaknesses.length > 0 ? (
                                                                    <div className="stage-eval-detail-card">
                                                                        <h4 className="stage-eval-detail-card__title">
                                                                            {t('stageEval_weaknesses')}
                                                                        </h4>
                                                                        <ul {...scriptTextProps(evalWeaknesses.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {evalWeaknesses.map((w, i) => (
                                                                                <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(w)}>{w}</li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                ) : null}

                                                                {/* Final HR Evaluation — last so the verdict closes the detail panel */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_finalHrEval')}
                                                                    </h4>
                                                                    {(() => {
                                                                        const text = finalHrEvaluationText || t('stageEval_none');
                                                                        return <p {...scriptTextProps(text, 'stage-eval-detail-card__body')}>{text}</p>;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>
                        {t('videoInterviewNoEvaluations')}
                    </div>
                )}

                {/* Stats — interview-eval-stat-card في index.css (زجاج سماوي عند hover) */}
                {!loading && evaluatedCandidates.length > 0 && (
                    <div className="interview-eval-stats-grid">
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_totalEvaluations')}</div>
                            <div className="interview-eval-stat-card__value">{evaluatedCandidates.length}</div>
                        </div>
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_recHire')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--hire">
                                {evaluatedCandidates.filter(c => c.videoInterviewEvaluation?.recommendation === 'Hire').length}
                            </div>
                        </div>
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_recConsider')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--consider">
                                {evaluatedCandidates.filter(c => c.videoInterviewEvaluation?.recommendation === 'Consider').length}
                            </div>
                        </div>
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_recReject')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--reject">
                                {evaluatedCandidates.filter(c => c.videoInterviewEvaluation?.recommendation === 'Reject').length}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </MobilePinchPanViewport>
        </div>
    );

    return (
        <>
            <style>{`
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        max-height: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        max-height: 1000px;
                        transform: translateY(0);
                    }
                }
            `}</style>
            {showCampaignList ? listView : detailView}
            <AiCompareTopEmailModal
                open={aiCompareModalOpen}
                submitting={aiCompareSubmitting}
                onClose={() => setAiCompareModalOpen(false)}
                onSubmit={handleStartAiCompare}
                compareCandidateCount={compareCandidateCount}
            />
        </>
    );
};

export default VideoInterview;





