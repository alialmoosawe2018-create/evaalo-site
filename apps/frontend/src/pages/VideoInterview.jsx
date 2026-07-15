import React, { useEffect, useMemo, useState } from 'react';
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
import { canonicalStageRecommendation, hasMeaningfulStageEvaluation } from '../utils/stageRecommendation.js';
import { scriptTextProps } from '../utils/textScript.js';
import ScreeningCampaignList from '../components/screening/ScreeningCampaignList.jsx';
import ScreeningAiComparePanel from '../components/screening/ScreeningAiComparePanel.jsx';
import StageEvalBackButton from '../components/screening/StageEvalBackButton.jsx';
import AiCompareTopEmailModal from '../components/screening/AiCompareTopEmailModal.jsx';
import { countEligibleCompareCandidates } from '../utils/compareTopCreditCost.js';
import ScreeningAiCompareNeedTwoNotice from '../components/screening/ScreeningAiCompareNeedTwoNotice.jsx';
import MobilePinchPanViewport from '../components/MobilePinchPanViewport.jsx';
import StageEvalShareButton from '../components/screening/StageEvalShareButton.jsx';
import { useStageEvalDeepLink } from '../hooks/useStageEvalDeepLink.js';
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
import { absoluteAppUrl } from '../config/apiBase.js';
import { buildCandidateInterviewQuery, resolveSharePersonId, resolveShareApplicationId } from '../utils/interviewShareLink.js';
import { localizeCatalogLabel } from '../utils/localizeCatalogLabel.js';
import {
    buildFinalRoleFitDetail,
    buildRoleUnderstandingDetail,
    buildVideoFinalHrText,
    buildVideoRedFlags,
    formatTableTenScore,
    qualitativeBandFromTenScore,
} from '../utils/videoInterviewEvalDisplay.js';

/** المرحلة لمسار المقارنة (Stage 3). */
const AI_COMPARE_STAGE = 'video';

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

    const [campaignGroups, setCampaignGroups] = useState({ active: [], uncategorized: null });
    /** null = campaign list; string = drill-down selection key */
    const [selectedCampaignKey, setSelectedCampaignKey] = useState(null);
    const [loading, setLoading] = useState(true);
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

    const handleHideCampaign = async (row) => {
        const ids = [...(row?.evaluated || []), ...(row?.pending || [])]
            .map((c) => c._id || c.id)
            .filter(Boolean);
        if (ids.length === 0) {
            await fetchCandidates();
            return;
        }
        try {
            await apiClient.post('/api/candidates/bulk-hide', { ids, stage: 'video' });
        } catch (err) {
            console.error('❌ Campaign hide failed:', err);
        } finally {
            setSelectedCampaignKey(null);
            await fetchCandidates();
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
            await fetchCandidates();
        }
    };

    useEffect(() => {
        fetchCandidates();
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
                const r = json.result;
                setAiCompareResult(r);
                setAiCompareRequestId(r.requestId || null);
                if (r.status === 'completed') {
                    setAiCompareStatus('completed');
                    setAiComparePanelOpen(true);
                } else if (r.status === 'failed' || r.status === 'refunded' || r.status === 'expired') {
                    setAiCompareStatus('failed');
                    setAiComparePanelOpen(true);
                } else if (r.status === 'pending' || r.status === 'processing') {
                    setAiCompareStatus('pending');
                    setAiComparePanelOpen(true);
                }
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
    const fetchCandidates = async () => {
        try {
            setLoading(true);
            const result = await apiClient.get('/api/candidates');
            
            if (result.success && result.data) {
                const { evaluated, pending } = splitVideoCandidates(result.data);
                const campaignIds = collectCampaignIdsFromCandidates(evaluated, pending);

                const metaByCampaignId = {};
                if (campaignIds.length > 0) {
                    try {
                        const metaJson = await apiClient.get(
                            `/api/recruitment-campaigns?ids=${encodeURIComponent(campaignIds.join(','))}`
                        );
                        if (metaJson.success && Array.isArray(metaJson.data)) {
                            for (const row of metaJson.data) {
                                if (row?.campaignId) metaByCampaignId[row.campaignId] = row;
                            }
                        }
                    } catch (metaErr) {
                        console.warn('⚠️ Campaign metadata batch fetch failed:', metaErr);
                    }
                }

                const groups = buildScreeningCampaignGroups(evaluated, pending, metaByCampaignId, {
                    uncategorized: t('screeningCampaignUncategorized'),
                    deleted: t('screeningCampaignDeleted'),
                    unknownCampaign: t('videoInterviewPageTitle'),
                });
                setCampaignGroups(groups);
            } else {
                console.warn('⚠️ No candidates data received');
                setCampaignGroups({ active: [], uncategorized: null });
            }
        } catch (error) {
            console.error('❌ Error fetching candidates:', error);
            setCampaignGroups({ active: [], uncategorized: null });
        } finally {
            setLoading(false);
        }
    };

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
                canonicalStageRecommendation(candidate.videoInterviewEvaluation?.recommendation)
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
                                onRefresh={fetchCandidates}
                                onHideCampaign={handleHideCampaign}
                                onToggleCampaignStatus={handleToggleCampaignStatus}
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
                        <button type="button" className="btn btn-secondary candidates-toolbar-filter-btn" onClick={fetchCandidates}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16 10C16 13.3137 13.3137 16 10 16C6.68629 16 4 13.3137 4 10C4 6.68629 6.68629 4 10 4C11.82 4 13.45 4.81 14.55 6.08" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M16 4V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            <span className="btn-text">{t('stageEval_refresh')}</span>
                        </button>
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
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colProfessionalDepth')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colProblemHandling')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colDecisionMaking')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colPrioritization')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colProcessThinking')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colResponsibility')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colLearningAbility')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('videoInterview_colJobReadiness')}</th>
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
                                        const recCanon = canonicalStageRecommendation(evaluation?.recommendation);
                                        const recColors = getRecommendationColor(recCanon);
                                        const finalHrEvaluationText = buildVideoFinalHrText(
                                            evaluation,
                                            t,
                                            translateRecLabel,
                                        );
                                        const roleUnderstandingText = buildRoleUnderstandingDetail(evaluation, t);
                                        const finalRoleFitText = buildFinalRoleFitDetail(evaluation, t);
                                        const redFlags = buildVideoRedFlags(evaluation, t);
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
                                                        <div style={{
                                                            display: 'inline-block',
                                                            padding: '8px 16px',
                                                            borderRadius: '8px',
                                                            background: scoreColors.bg,
                                                            color: scoreColors.text,
                                                            fontWeight: 700,
                                                            fontSize: '18px',
                                                            lineHeight: 1.2
                                                        }}>
                                                            {evaluation?.overall_score ?? 0}%
                                                        </div>
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
                                                            onReset: fetchCandidates,
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
                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: 'repeat(2, 1fr)',
                                                                gap: '20px',
                                                                marginBottom: '20px'
                                                            }}>
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

                                                                {/* Final HR Evaluation */}
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





