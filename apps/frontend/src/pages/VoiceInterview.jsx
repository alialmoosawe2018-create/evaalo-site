import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    candidateAvatarImageProps,
    candidatePhotoUrl,
    GenderAvatar,
    inferGenderFromName,
    shouldUseGenderAvatar,
} from '../utils/candidateAssets';
import '../design-styles.css';
import { absoluteAppUrl } from '../config/apiBase.js';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { onEvent } from '../services/eventsSocket';
import { buildCandidateInterviewQuery, resolveSharePersonId, resolveShareApplicationId } from '../utils/interviewShareLink.js';
import { localizeCatalogLabel } from '../utils/localizeCatalogLabel.js';
import apiClient, { ApiError } from '../services/apiClient';
import { useLanguage } from '../contexts/LanguageContext';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { canonicalStageRecommendation, hasMeaningfulStageEvaluation } from '../utils/stageRecommendation.js';
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
import VoiceRecordingCell from '../components/screening/VoiceRecordingCell.jsx';
import { useStageEvalDeepLink } from '../hooks/useStageEvalDeepLink.js';
import { useStageCampaignHide } from '../hooks/useStageCampaignHide.js';
import {
    buildScreeningCampaignGroups,
    collectCampaignIdsFromCandidates,
    findCampaignGroup,
    splitVoiceCandidates,
} from '../utils/voiceCampaigns.js';
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

/** المرحلة لمسار المقارنة (Stage 2). */
const AI_COMPARE_STAGE = 'voice';

function campaignLabels(t) {
    return {
        uncategorized: t('screeningCampaignUncategorized'),
        deleted: t('screeningCampaignDeleted'),
        unknownCampaign: t('voiceInterviewPageTitle'),
    };
}

/** Rebuilds the board from the cached payload, so a restored view is shaped exactly like a fetched one. */
function groupsFromSnapshot(snapshot, t) {
    const { evaluated, pending } = splitVoiceCandidates(snapshot.candidates);
    return buildScreeningCampaignGroups(evaluated, pending, snapshot.meta, campaignLabels(t), {
        metaPending: !snapshot.metaComplete,
    });
}

/** نص من n8n قد يكون "undefined" حرفياً — لا نعرض كائنات أو undefined */
function displayVoiceText(v, fallback = 'N/A') {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'object') return fallback;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || /^undefined$/i.test(t) || /^null$/i.test(t)) return fallback;
        return t;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    const s = String(v);
    if (/^undefined$/i.test(s.trim()) || /^null$/i.test(s.trim())) return fallback;
    return s;
}

/** strengths/weaknesses قد تصل كنص أو مصفوفة من n8n */
function normalizeVoiceBulletList(raw) {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) {
        return raw
            .map((x) => (typeof x === 'string' ? x.trim() : String(x).trim()))
            .filter((x) => x && !/^undefined$/i.test(x) && !/^null$/i.test(x));
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t || /^undefined$/i.test(t) || /^null$/i.test(t)) return [];
        return t
            .split(/\n+|(?:\s*,\s*)/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

/** مهارة: رقم /10 أو نص (كلمات) */
function formatVoiceSkill(v, naLabel, outOfTenTpl) {
    if (v === undefined || v === null) return naLabel;
    if (typeof v === 'number' && Number.isFinite(v)) return fillI18nTemplate(outOfTenTpl, { n: v });
    return displayVoiceText(v, naLabel);
}

const VoiceInterview = () => {
    const { t, currentLang } = useLanguage();
    const na = t('stageEval_notApplicable');
    const skillOutTen = t('stageEval_skillOutOfTen');
    /**
     * ترجمة كلمات التقييم الإنجليزية القادمة من n8n للعرض بلغة الواجهة.
     * يعالج الكلمة المفردة ("Intermediate") وأيضًا صيغة "الكلمة (٣/١٠)" التي
     * يُخرجها التقييم أحيانًا للمقاييس المحسوبة مسبقًا — فيترجم الكلمة ويُبقي الدرجة.
     */
    const localizeRating = (val) => {
        if (val == null) return val;
        const RATE = {
            excellent: 'stageEval_rateExcellent',
            good: 'stageEval_rateGood',
            intermediate: 'stageEval_rateIntermediate',
            bad: 'stageEval_rateBad',
        };
        const s = String(val).trim();
        const exact = RATE[s.toLowerCase()];
        if (exact) return t(exact);
        // "Word (3/10)" / "Word - ..." → اعرض الكلمة المعرّبة فقط (بلا الدرجة)،
        // كباقي الحقول. (الأرقام الصِرفة مثل "8/10" لا تُطابَق وتبقى كما هي.)
        const m = s.match(/^(excellent|good|intermediate|bad)\b/i);
        if (m) return t(RATE[m[1].toLowerCase()]);
        return val;
    };

    const translateRecLabel = (canonical) => {
        switch (canonical) {
            case 'Hire':
                return t('stageEval_recAccepted');
            case 'Consider':
                return t('stageEval_recConsider');
            case 'Reject':
                return t('stageEval_recReject');
            case 'Incomplete':
                return t('stageEval_recIncomplete');
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
        stage: 'voice',
        split: splitVoiceCandidates,
        getLabels,
        setCampaignGroups,
        setSelectedCampaignKey,
        initialSnapshot: restoredSnapshot,
    });
    const [filter, setFilter] = useState('all'); // all, hire, consider, reject
    const [expandedRows, setExpandedRows] = useState(new Set());
    // كاش روابط التسجيل الموقّتة لكل مرشح: { url, expiresAt } + حالات التحميل/الخطأ.

    // AI Compare Top (Stage 2 — مستقل عن باقي الـ webhooks)
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
        () => countEligibleCompareCandidates(campaignCandidates, 'voice'),
        [campaignCandidates],
    );

    const filteredCandidates = useMemo(
        () =>
            campaignCandidates.filter((c) => {
                if (!hasMeaningfulStageEvaluation(c.voiceInterviewEvaluation)) {
                    return filter === 'all';
                }
                return recommendationMatchesFilter(c.voiceInterviewEvaluation?.recommendation, filter);
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
                const noCredits = json?.error === 'INSUFFICIENT_CREDITS';
                setAiCompareStatus('failed');
                setAiCompareResult({
                    status: 'failed',
                    emails,
                    error: noCredits ? t('aiCompareTop_noCredits') : json?.message || json?.error,
                });
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
            const noCredits =
                err instanceof ApiError &&
                (err.status === 402 || err.data?.error === 'INSUFFICIENT_CREDITS');
            console.error('❌ AI compare trigger failed:', err);
            setAiCompareStatus('failed');
            setAiCompareResult({
                status: 'failed',
                emails,
                error: noCredits
                    ? t('aiCompareTop_noCredits')
                    : err instanceof ApiError
                      ? err.data?.message || err.message
                      : String(err?.message || err),
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
        document.title = `${t('voiceInterviewPageTitle')} · ${t('companyName')}`;
        return () => {
            document.title = previous;
        };
    }, [t, currentLang]);

    // Stage 2: POST /webhook/n8n/stage2 — voiceInterviewEvaluation
    // communication / problem_solving: number أو نص | strengths / weaknesses: مصفوفة أو سطر
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

            const { evaluated, pending } = splitVoiceCandidates(candidates);
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
            console.error('❌ Error fetching candidates:', error);
        } finally {
            if (ownsLoading) releaseLoadingIfOwned();
        }
    };

    // Live: refresh the voice board in the background when relevant domain events arrive.
    useLiveRefresh(
        [
            'VoiceEvaluationCompleted',
            'VideoSessionCompleted',
            'CandidateStatusChanged',
            'CandidateApplied',
            'InterviewLinkAccessChanged',
        ],
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
            case 'Incomplete':
                return { bg: 'rgba(100, 116, 139, 0.2)', border: 'rgba(100, 116, 139, 0.45)', text: '#64748B' };
            default:
                return { bg: 'rgba(148, 163, 184, 0.2)', border: 'rgba(148, 163, 184, 0.4)', text: '#94A3B8' };
        }
    };

    const getScoreColor = (score) => {
        if (score >= 80) return { bg: 'rgba(16, 185, 129, 0.2)', text: '#10B981' };
        if (score >= 60) return { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B' };
        return { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444' };
    };

    /** Stage 2: المشاركة = رابط مقابلة الفيديو (LiveKit) + تقييم الصوت */
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

        const shareText = fillI18nTemplate(t('voiceInterview_shareBody'), {
            name,
            position,
            companyLine,
            link: interviewLink,
            score: candidate.voiceInterviewEvaluation?.overall_score || 0,
            recommendation: translateRecLabel(
                canonicalStageRecommendation(candidate.voiceInterviewEvaluation?.recommendation)
            ),
            email: email || na,
            phone: phone || na,
        });

        const emailSubject = fillI18nTemplate(t('voiceInterview_shareNavigatorTitle'), { name });

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
                                titleKey="voiceInterviewCampaignsTitle"
                                emptyKey="voiceInterviewCampaignsEmpty"
                                activeSectionKey="voiceInterviewCampaignsActiveSection"
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
                                : t('voiceInterviewPageTitle')}
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
                                              ? t('stageEval_recAccepted')
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
                            uiStage="voice"
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
                                        }}>{t('stageEval_colCommunicationSkills')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('stageEval_colEnglishFluency')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('stageEval_colConfidenceLevel')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('stageEval_colProblemSolving')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '14px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)'
                                        }}>{t('stageEval_colComputerSkills')}</th>
                                        <th style={{ 
                                            padding: '16px 8px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '13px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                            whiteSpace: 'nowrap',
                                            width: '1%',
                                            maxWidth: '118px',
                                            minWidth: '100px'
                                        }}>{t('stageEval_colRecommendation')}</th>
                                        <th style={{ 
                                            padding: '16px', 
                                            textAlign: 'center', 
                                            color: '#22d3ee', 
                                            fontWeight: 600, 
                                            fontSize: '13px',
                                            borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                            whiteSpace: 'nowrap',
                                            minWidth: '160px'
                                        }}>{t('stageEval_colRecording')}</th>
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
                                                colSpan={10}
                                                className="stage-eval-empty-cell"
                                            >
                                                {evaluatedCandidates.length === 0
                                                    ? t('voiceInterviewNoEvaluations')
                                                    : fillI18nTemplate(t('voiceInterviewNoFilterMatch'), {
                                                          filter:
                                                              filter === 'all'
                                                                  ? t('stageEval_all')
                                                                  : filter === 'hire'
                                                                    ? t('stageEval_recAccepted')
                                                                    : filter === 'consider'
                                                                      ? t('stageEval_recConsider')
                                                                      : t('stageEval_recReject'),
                                                      })}
                                            </td>
                                        </tr>
                                    ) : null}
                                    {filteredCandidates.map((candidate, index) => {
                                        const evaluation = candidate.voiceInterviewEvaluation;
                                        const strengthItems = normalizeVoiceBulletList(evaluation?.strengths);
                                        const weaknessItems = normalizeVoiceBulletList(evaluation?.weaknesses);
                                        const recCanon = canonicalStageRecommendation(evaluation?.recommendation);
                                        const recColors = getRecommendationColor(recCanon);
                                        const scoreValue =
                                            recCanon === 'Incomplete' || evaluation?.overall_score == null
                                                ? null
                                                : Number(evaluation.overall_score);
                                        const scoreColors =
                                            scoreValue == null
                                                ? { bg: 'rgba(100, 116, 139, 0.2)', text: '#64748B' }
                                                : getScoreColor(scoreValue);
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

                                                {/* Communication */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {localizeRating(formatVoiceSkill(evaluation?.communication, na, skillOutTen))}
                                                    </div>
                                                </td>

                                                {/* Language Fluency */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {localizeRating(displayVoiceText(evaluation?.language_fluency, na))}
                                                    </div>
                                                </td>

                                                {/* Confidence */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {localizeRating(displayVoiceText(evaluation?.confidence, na))}
                                                    </div>
                                                </td>

                                                {/* Problem Solving */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {localizeRating(formatVoiceSkill(evaluation?.problem_solving, na, skillOutTen))}
                                                    </div>
                                                </td>

                                                {/* Digital Skills */}
                                                <td style={{ 
                                                    padding: '16px', 
                                                    textAlign: 'center',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div className="stage-eval-cell-value">
                                                        {localizeRating(displayVoiceText(evaluation?.digital_skills, na))}
                                                    </div>
                                                </td>

                                                {/* Score + Recommendation (مثل Stage 1) */}
                                                <td style={{ 
                                                    padding: '10px 6px', 
                                                    textAlign: 'center',
                                                    verticalAlign: 'middle',
                                                    maxWidth: '118px',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        width: '100%'
                                                    }}>
                                                        <div style={{
                                                            display: 'inline-block',
                                                            padding: '5px 10px',
                                                            borderRadius: '6px',
                                                            background: scoreColors.bg,
                                                            color: scoreColors.text,
                                                            fontWeight: 700,
                                                            fontSize: '14px',
                                                            lineHeight: 1.15
                                                        }}>
                                                            {scoreValue == null ? '—' : `${scoreValue}%`}
                                                        </div>
                                                        <div style={{
                                                            display: 'inline-block',
                                                            padding: '4px 8px',
                                                            borderRadius: '5px',
                                                            background: recColors.bg,
                                                            border: `1px solid ${recColors.border}`,
                                                            color: recColors.text,
                                                            fontWeight: 600,
                                                            fontSize: '11px',
                                                            lineHeight: 1.15,
                                                            letterSpacing: '0.02em',
                                                        }}>
                                                            {translateRecLabel(recCanon)}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Recording (presigned, lazy) */}
                                                <td style={{ 
                                                    padding: '12px 8px', 
                                                    textAlign: 'center',
                                                    verticalAlign: 'middle',
                                                    borderRight: '1px solid rgba(34, 211, 238, 0.3)',
                                                    borderLeft: '1px solid rgba(34, 211, 238, 0.1)'
                                                }}>
                                                    <VoiceRecordingCell
                                                        candidateId={candidateId}
                                                        hasRecording={!!candidate.voiceRecording?.key}
                                                        t={t}
                                                    />
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
                                                        shareTitle={t('voiceInterviewShareTitle')}
                                                        interviewLinkReset={{
                                                            // هذه المرحلة تشارك رابط /video-interview-call، والبوابة التي
                                                            // تحجبه هي videoInterviewLinkConsumedAt؛ استهداف مرحلة voice
                                                            // كان يفتح علماً آخر فيبقى الرابط المُشارك "مكتملاً".
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
                                                    <td colSpan={10} style={{ padding: '0' }}>
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
                                                                {/* Summary */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_summary')}
                                                                    </h4>
                                                                    {(() => {
                                                                        const text = displayVoiceText(evaluation?.summary, t('stageEval_noSummary'));
                                                                        return <p {...scriptTextProps(text, 'stage-eval-detail-card__body')}>{text}</p>;
                                                                    })()}
                                                                </div>

                                                                {/* Weaknesses */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_weaknesses')}
                                                                    </h4>
                                                                    {weaknessItems.length > 0 ? (
                                                                        <ul {...scriptTextProps(weaknessItems.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {weaknessItems.map((w, i) => {
                                                                                const text = displayVoiceText(w, '');
                                                                                return <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(text)}>{text}</li>;
                                                                            })}
                                                                        </ul>
                                                                    ) : evaluation?.red_flags && evaluation.red_flags.length > 0 ? (
                                                                        <ul {...scriptTextProps(evaluation.red_flags.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {evaluation.red_flags.map((flag, i) => (
                                                                                <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(flag)}>{flag}</li>
                                                                            ))}
                                                                        </ul>
                                                                    ) : (
                                                                        <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                    )}
                                                                </div>

                                                                {/* Strengths */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_strengths')}
                                                                    </h4>
                                                                    {strengthItems.length > 0 ? (
                                                                        <ul {...scriptTextProps(strengthItems.join(' '), 'stage-eval-detail-card__list')}>
                                                                            {strengthItems.map((strength, i) => {
                                                                                const text = displayVoiceText(strength, '');
                                                                                return <li key={i} style={{ marginBottom: '6px' }} {...scriptTextProps(text)}>{text}</li>;
                                                                            })}
                                                                        </ul>
                                                                    ) : (
                                                                        <span className="stage-eval-detail-card__muted">{t('stageEval_none')}</span>
                                                                    )}
                                                                </div>

                                                                {/* Professional Attitude */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_professionalAttitude')}
                                                                    </h4>
                                                                    {(() => {
                                                                        const text = displayVoiceText(
                                                                            evaluation?.professional_attitude ?? evaluation?.fit_for_role,
                                                                            t('stageEval_none')
                                                                        );
                                                                        return <p {...scriptTextProps(text, 'stage-eval-detail-card__body')}>{text}</p>;
                                                                    })()}
                                                                </div>

                                                                {/* Final HR Evaluation */}
                                                                <div className="stage-eval-detail-card">
                                                                    <h4 className="stage-eval-detail-card__title">
                                                                        {t('stageEval_finalHrEval')}
                                                                    </h4>
                                                                    {(() => {
                                                                        const text = displayVoiceText(
                                                                            evaluation?.final_hr_evaluation ??
                                                                                evaluation?.finalHrEvaluation ??
                                                                                evaluation?.recommendation,
                                                                            t('voiceInterview_noFinalHr')
                                                                        );
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
                        {t('voiceInterviewNoEvaluations')}
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
                            <div className="interview-eval-stat-card__label">{t('stageEval_recAccepted')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--hire">
                                {evaluatedCandidates.filter(c => c.voiceInterviewEvaluation?.recommendation === 'Hire').length}
                            </div>
                        </div>
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_recConsider')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--consider">
                                {evaluatedCandidates.filter(c => c.voiceInterviewEvaluation?.recommendation === 'Consider').length}
                            </div>
                        </div>
                        <div className="interview-eval-stat-card">
                            <div className="interview-eval-stat-card__label">{t('stageEval_recReject')}</div>
                            <div className="interview-eval-stat-card__value interview-eval-stat-card__value--reject">
                                {evaluatedCandidates.filter(c => c.voiceInterviewEvaluation?.recommendation === 'Reject').length}
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

export default VoiceInterview;





