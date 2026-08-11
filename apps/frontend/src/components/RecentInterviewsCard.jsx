import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import {
    candidateAvatarImageProps,
    candidatePhotoUrl,
    GenderAvatar,
    inferGenderFromName,
    shouldUseGenderAvatar,
} from '../utils/candidateAssets';
import { absoluteAppUrl } from '../config/apiBase.js';
import { buildCandidateInterviewQuery, resolveSharePersonId, resolveShareApplicationId } from '../utils/interviewShareLink.js';
import { apiClient } from '../services/apiClient';
import { getMyProfile, clearDashboardRecentInterviews } from '../services/profileService';
import { fillI18nTemplate as fillDashboardTemplate } from '../utils/i18nTemplate.js';
import { resolveDashboardInterviewStage } from '../utils/stageRecommendation.js';
import {
    buildShareCompanyLine,
    buildShareCompanyPart,
} from '../utils/shareInterviewLink.js';
import {
    collectCampaignIdsFromCandidates,
    resolveCompanyFromMeta,
    withoutPendingAnalysis,
} from '../utils/screeningCampaigns.js';
import { buildStageEvalCandidateUrl } from '../utils/stageEvalNavigation.js';
import {
    dismissNotification,
    filterDismissedNotifications,
    getCandidateActivityTime,
    isNotificationDismissed,
} from '../utils/notificationActivity.js';
import { scriptTextProps } from '../utils/textScript.js';
import {
    buildMockRecentInterviews,
    isMockRecentInterviewId,
} from '../utils/demoSampleData.js';

const DASHBOARD_UNKNOWN = 'Unknown';
const DASHBOARD_NA = 'N/A';

function toTime(value) {
    if (!value) return 0;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
}

function filterCandidatesByClearedAt(candidates, clearedAtIso) {
    const clearedAtMs = toTime(clearedAtIso);
    let filtered = candidates;
    if (clearedAtMs) {
        filtered = candidates.filter((c) => {
            const activityAt = getCandidateActivityTime(c);
            return activityAt > clearedAtMs;
        });
    }
    return filterDismissedNotifications(filtered);
}

function mapCandidateToInterview(candidate, metaByCampaignId = {}) {
    const name =
        ((candidate.full_name || candidate.fullName) || '').trim() ||
        candidate.candidate ||
        candidate.email?.split('@')[0] ||
        DASHBOARD_UNKNOWN;
    const stage = resolveDashboardInterviewStage(candidate);
    const campId = candidate.campaignId;
    const company =
        (campId && metaByCampaignId[campId]
            ? resolveCompanyFromMeta(metaByCampaignId[campId])
            : '') ||
        (candidate.company_applied_to || candidate.companyAppliedTo || '').trim() ||
        '';
    return {
        id: candidate._id || candidate.id,
        candidate: name,
        full_name: candidate.full_name || candidate.fullName,
        position: candidate.position_applied_for || candidate.positionAppliedFor || DASHBOARD_NA,
        company,
        stage,
        campaignId: candidate.campaignId,
        entryStage: candidate.entryStage,
        date: candidate.interviewDate || candidate.createdAt || new Date().toISOString().split('T')[0],
        originalStatus: candidate.status,
        email: candidate.email,
        photoUrl: candidatePhotoUrl(candidate),
        writtenInterviewEvaluation: candidate.writtenInterviewEvaluation,
        voiceInterviewEvaluation: candidate.voiceInterviewEvaluation,
        videoInterviewEvaluation: candidate.videoInterviewEvaluation,
        activityTime: getCandidateActivityTime(candidate),
    };
}

function dashboardDateLocale(lang) {
    if (lang === 'ar') return 'ar-IQ';
    if (lang === 'ku') return 'ckb-IQ';
    return 'en-US';
}

function formatDashboardInterviewDate(raw, locale) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '—';
    try {
        return new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(d);
    } catch {
        return d.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    }
}

const RecentInterviewsCard = ({ variant = 'dashboard' }) => {
    const { t, currentLang } = useLanguage();
    const navigate = useNavigate();
    const [recentInterviews, setRecentInterviews] = useState([]);
    const [loadingInterviews, setLoadingInterviews] = useState(true);
    const [clearingRecent, setClearingRecent] = useState(false);
    const [clearRecentError, setClearRecentError] = useState(null);
    const [analysisReleaseAt, setAnalysisReleaseAt] = useState(null);
    const clearedAtRef = useRef(null);
    const scrollRef = useRef(null);

    const clampRecentInterviewsScrollWheel = useCallback((e) => {
        const el = scrollRef.current;
        if (!el) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        const atTop = scrollTop <= 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
        if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
            e.preventDefault();
        }
    }, []);

    // Bound natively: React registers wheel listeners as passive, so preventDefault
    // from an onWheel prop is ignored and the page scrolls at the list boundaries.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('wheel', clampRecentInterviewsScrollWheel, { passive: false });
        return () => el.removeEventListener('wheel', clampRecentInterviewsScrollWheel);
    }, [clampRecentInterviewsScrollWheel]);

    const mockRecentInterviews = useMemo(() => buildMockRecentInterviews(t), [t]);
    const mockRecentInterviewsRef = useRef(mockRecentInterviews);
    mockRecentInterviewsRef.current = mockRecentInterviews;

    const buildRecentInterviewsList = (candidates, clearedAtIso, metaByCampaignId = {}) => {
        const filtered = filterCandidatesByClearedAt(candidates, clearedAtIso ?? clearedAtRef.current);
        const interviews = filtered
            .map((c) => mapCandidateToInterview(c, metaByCampaignId))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const hasClearedAt = toTime(clearedAtIso ?? clearedAtRef.current) > 0;
        if (interviews.length === 0 && !hasClearedAt) {
            return mockRecentInterviewsRef.current;
        }
        return interviews;
    };

    const fetchRecentInterviews = useCallback(async ({ background = false } = {}) => {
        try {
            if (!background) setLoadingInterviews(true);
            setClearRecentError(null);

            const [profileResult, candidatesResult] = await Promise.all([
                getMyProfile().catch(() => null),
                apiClient.get('/api/candidates').catch(() => null),
            ]);

            const clearedAtIso =
                profileResult?.preferences?.dashboardRecentInterviewsClearedAt ?? null;
            clearedAtRef.current = clearedAtIso;

            const allCandidates =
                candidatesResult?.success && Array.isArray(candidatesResult.data)
                    ? candidatesResult.data
                    : [];

            // لا إشعار قبل جهوزية البطاقة كاملة — نفس مهلة تحليل المرحلة الأولى.
            const { visible: candidates, nextReleaseAt } = withoutPendingAnalysis(allCandidates);
            setAnalysisReleaseAt(nextReleaseAt);

            const campaignIds = collectCampaignIdsFromCandidates(candidates, []);
            const metaByCampaignId = {};
            if (campaignIds.length > 0) {
                try {
                    const metaRes = await apiClient.get(
                        `/api/recruitment-campaigns?ids=${encodeURIComponent(campaignIds.join(','))}`
                    );
                    if (metaRes?.success && Array.isArray(metaRes.data)) {
                        for (const row of metaRes.data) {
                            if (row?.campaignId) metaByCampaignId[row.campaignId] = row;
                        }
                    }
                } catch (metaErr) {
                    console.warn('[RecentInterviewsCard] campaign metadata fetch failed:', metaErr);
                }
            }

            setRecentInterviews(buildRecentInterviewsList(candidates, clearedAtIso, metaByCampaignId));
        } catch (error) {
            console.error('Error fetching recent interviews:', error);
            const hasClearedAt = toTime(clearedAtRef.current) > 0;
            setRecentInterviews(hasClearedAt ? [] : mockRecentInterviewsRef.current);
        } finally {
            if (!background) setLoadingInterviews(false);
        }
    }, []);

    useEffect(() => {
        fetchRecentInterviews();
    }, [fetchRecentInterviews]);

    // فشل التحليل لا يُصدر حدثاً، فنُعيد الجلب عند انتهاء المهلة لكشف الإشعار المؤجَّل.
    useEffect(() => {
        if (analysisReleaseAt == null) return undefined;
        const delay = Math.max(0, analysisReleaseAt - Date.now()) + 1000;
        const timerId = window.setTimeout(
            () => fetchRecentInterviews({ background: true }),
            delay
        );
        return () => window.clearTimeout(timerId);
    }, [analysisReleaseAt, fetchRecentInterviews]);

    useEffect(() => {
        setRecentInterviews((prev) => {
            if (
                prev.length > 0 &&
                prev.every((item) => isMockRecentInterviewId(item.id))
            ) {
                return mockRecentInterviews;
            }
            return prev;
        });
    }, [mockRecentInterviews]);

    useEffect(() => {
        const onDismissed = () => {
            setRecentInterviews((prev) =>
                prev.filter(
                    (item) =>
                        isMockRecentInterviewId(item.id) ||
                        !isNotificationDismissed(item),
                ),
            );
        };
        window.addEventListener('evaalo:notification-dismissed', onDismissed);
        return () => window.removeEventListener('evaalo:notification-dismissed', onDismissed);
    }, []);

    const handleInterviewItemClick = (interview) => {
        if (!interview?.id || String(interview.id).startsWith('mock-')) return;
        if (!interview.stage) return;

        dismissNotification(interview);
        setRecentInterviews((prev) =>
            prev.filter(
                (item) =>
                    item.id !== interview.id ||
                    item.activityTime !== interview.activityTime,
            ),
        );

        navigate(
            buildStageEvalCandidateUrl(interview.stage, {
                candidateId: interview.id,
                campaignId: interview.campaignId,
            }),
        );
    };

    const handleClearRecentInterviews = async () => {
        if (clearingRecent || loadingInterviews) return;
        setClearingRecent(true);
        setClearRecentError(null);
        try {
            const preferences = await clearDashboardRecentInterviews();
            const clearedAtIso = preferences?.dashboardRecentInterviewsClearedAt ?? null;
            clearedAtRef.current = clearedAtIso;
            setRecentInterviews([]);
            window.dispatchEvent(new CustomEvent('evaalo:notifications-cleared'));
        } catch (err) {
            console.error('[RecentInterviewsCard] clear recent interviews failed:', err);
            setClearRecentError(t('dashboardClearRecentError'));
        } finally {
            setClearingRecent(false);
        }
    };

    const dateLocale = useMemo(() => dashboardDateLocale(currentLang), [currentLang]);
    const avatarSize = variant === 'notifications' ? 40 : 48;
    const actionBtnSize = variant === 'notifications' ? 32 : 36;

    const handleShareInterview = async (interview) => {
        const candidateId = resolveSharePersonId(interview) || interview.id;
        const camp = interview.campaignId;
        const stage = interview.stage;
        const q = buildCandidateInterviewQuery({
            candidateId,
            campaignId: camp,
            applicationId: resolveShareApplicationId(interview),
            language: currentLang,
        });

        const stageNum = Number(stage);
        const useVideo = stageNum === 3;
        const interviewLink = useVideo
            ? absoluteAppUrl(`/video-interview-call?${q.toString()}`)
            : absoluteAppUrl(`/interview?${q.toString()}`);

        const candidateLabel =
            interview.candidate === DASHBOARD_UNKNOWN
                ? t('dashboardUnknownCandidate')
                : interview.candidate;
        const positionLabel =
            interview.position === DASHBOARD_NA ? t('dashboardNa') : interview.position;
        const dateStr = formatDashboardInterviewDate(interview.date, dateLocale);
        const stageBadges =
            interview.stage != null ? `${t('dashboardStage')} ${interview.stage}` : '?';
        const company = (interview.company || '').trim();
        const companyPart = buildShareCompanyPart(t, company);
        const companyLine = buildShareCompanyLine(t, company);

        const shareVars = {
            name: candidateLabel,
            position: positionLabel,
            companyPart,
            companyLine,
            date: dateStr,
            stage: stageBadges,
            email: interview.email || t('dashboardNa'),
            link: interviewLink,
            url: interviewLink,
        };

        const shareText = fillDashboardTemplate(
            useVideo ? t('dashboardShareClipboardVideo') : t('dashboardShareClipboardVoice'),
            shareVars
        );

        if (navigator.share) {
            try {
                await navigator.share({
                    title: fillDashboardTemplate(
                        useVideo
                            ? t('dashboardNavigatorShareTitleVideo')
                            : t('dashboardNavigatorShareTitleVoice'),
                        { name: candidateLabel }
                    ),
                    text: fillDashboardTemplate(
                        useVideo
                            ? t('dashboardShareNavigatorTextVideo')
                            : t('dashboardShareNavigatorTextVoice'),
                        {
                            name: candidateLabel,
                            position: positionLabel,
                            companyPart,
                        }
                    ),
                    url: interviewLink,
                });
                return;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error sharing:', err);
                }
            }
        }

        try {
            await navigator.clipboard.writeText(shareText);
            alert(useVideo ? `✅ ${t('dashboardShareCopiedVideo')}` : `✅ ${t('dashboardShareCopiedVoice')}`);
        } catch (err) {
            console.error('Failed to copy:', err);
            prompt(
                useVideo ? t('dashboardSharePromptVideo') : t('dashboardSharePromptVoice'),
                shareText
            );
        }
    };

    return (
        <div
            className={`dashboard-card dashboard-card--page-active platform-features-card recent-interviews-card recent-interviews-card--${variant}`}
        >
            <div className="dashboard-card-header">
                <h2 className="dashboard-card-title">
                    {variant === 'notifications'
                        ? t('appBottomNavNotifications')
                        : t('dashboardRecentInterviews')}
                </h2>
                <button
                    type="button"
                    aria-label={t('dashboardClearRecentAria')}
                    title={t('dashboardClearRecentTooltip')}
                    className="btn btn-secondary dashboard-delete-btn"
                    disabled={clearingRecent || loadingInterviews}
                    onClick={() => handleClearRecentInterviews()}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.5 5H4.16667H17.5M6.66667 5V3.33333C6.66667 2.89131 6.84226 2.46738 7.15482 2.15482C7.46738 1.84226 7.89131 1.66667 8.33333 1.66667H11.6667C12.1087 1.66667 12.5326 1.84226 12.8452 2.15482C13.1577 2.46738 13.3333 2.89131 13.3333 3.33333V5M15.8333 5V16.6667C15.8333 17.1087 15.6577 17.5326 15.3452 17.8452C15.0326 18.1577 14.6087 18.3333 14.1667 18.3333H5.83333C5.39131 18.3333 4.96738 18.1577 4.65482 17.8452C4.34226 17.5326 4.16667 17.1087 4.16667 16.6667V5H15.8333Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8.33333 9.16667V14.1667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.6667 9.16667V14.1667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </button>
            </div>
            {clearRecentError ? (
                <p
                    role="alert"
                    style={{
                        margin: '0 22px 8px',
                        fontSize: 13,
                        color: '#fca5a5',
                    }}
                >
                    {clearRecentError}
                </p>
            ) : null}
            <div
                ref={scrollRef}
                className="dashboard-card-body recent-interviews-scroll"
            >
                {loadingInterviews ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                        {t('dashboardLoadingInterviews')}
                    </div>
                ) : recentInterviews.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                        {t('dashboardNoInterviews')}
                    </div>
                ) : (
                    <div className="interview-list">
                        {recentInterviews.map((interview) => {
                            const rowName =
                                interview.candidate === DASHBOARD_UNKNOWN
                                    ? t('dashboardUnknownCandidate')
                                    : interview.candidate;
                            const rowPosition =
                                interview.position === DASHBOARD_NA
                                    ? t('dashboardNa')
                                    : interview.position;
                            const rowDate = formatDashboardInterviewDate(
                                interview.date,
                                dateLocale
                            );
                            return (
                                <div
                                    key={interview.id}
                                    className="interview-item"
                                    role="button"
                                    tabIndex={0}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => handleInterviewItemClick(interview)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleInterviewItemClick(interview);
                                        }
                                    }}
                                >
                                    <div className="interview-item__profile">
                                        <div
                                            className="candidate-avatar-ring interview-item__avatar"
                                            style={{
                                                width: `${avatarSize}px`,
                                                height: `${avatarSize}px`,
                                                borderRadius: '50%',
                                                overflow: 'hidden',
                                                flexShrink: 0,
                                                border: 'none',
                                                background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                boxShadow:
                                                    '0 0 0 2px rgba(34, 211, 238, 0.35), 0 2px 8px rgba(6, 182, 212, 0.2)',
                                            }}
                                        >
                                            {interview.photoUrl ? (
                                                <img
                                                    alt={rowName || t('dashboardProfileAlt')}
                                                    className="candidate-avatar-photo"
                                                    decoding="async"
                                                    draggable={false}
                                                    {...candidateAvatarImageProps(interview.photoUrl, avatarSize)}
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        objectFit: 'cover',
                                                    }}
                                                    onError={(e) => {
                                                        e.target.style.display = 'none';
                                                        const fall = e.target.nextElementSibling;
                                                        if (fall) fall.style.display = 'flex';
                                                    }}
                                                />
                                            ) : null}
                                            {shouldUseGenderAvatar(interview, interview.photoUrl) ? (
                                                <GenderAvatar
                                                    gender={inferGenderFromName(interview)}
                                                    size={avatarSize}
                                                />
                                            ) : (
                                                <div
                                                    style={{
                                                        display: interview.photoUrl ? 'none' : 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '100%',
                                                        height: '100%',
                                                        fontSize: '16px',
                                                        fontWeight: 600,
                                                        color: '#fff',
                                                    }}
                                                >
                                                    {(rowName?.[0] || interview.email?.[0] || '?').toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="interview-item__text">
                                            <div {...scriptTextProps(rowName, 'interview-title')}>{rowName}</div>
                                            <div className="interview-meta">
                                                <span {...scriptTextProps(rowPosition)}>{rowPosition}</span>
                                                <span aria-hidden="true"> • </span>
                                                <span {...scriptTextProps(rowDate)}>{rowDate}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="interview-item__actions">
                                        {interview.stage ? (
                                            <span
                                                className={`status-badge status-stage status-stage--${interview.stage}`}
                                            >
                                                {t('dashboardStage')} {interview.stage}
                                            </span>
                                        ) : (
                                            <span className="status-badge status-pending">
                                                {t('dashboardPending')}
                                            </span>
                                        )}
                                        {interview.stage === 3 ? (
                                            <div
                                                className="interview-item__done-icon"
                                                style={{
                                                    width: `${actionBtnSize}px`,
                                                    height: `${actionBtnSize}px`,
                                                    borderRadius: '50%',
                                                    border: '1px solid rgba(16, 185, 129, 0.4)',
                                                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                                                }}
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            </div>
                                        ) : interview.stage ? (
                                            <button
                                                type="button"
                                                className="interview-item__share-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleShareInterview(interview);
                                                }}
                                                title={t('dashboardShareInterviewLinkTitle')}
                                                style={{
                                                    width: `${actionBtnSize}px`,
                                                    height: `${actionBtnSize}px`,
                                                    borderRadius: '50%',
                                                    border: '1px solid rgba(34, 211, 238, 0.4)',
                                                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                                    backdropFilter: 'blur(10px)',
                                                    color: '#fff',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '14px',
                                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                                                    padding: 0,
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1.1) rotate(360deg)';
                                                    e.currentTarget.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
                                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.5)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                                                    e.currentTarget.style.background = 'linear-gradient(135deg, #10B981 0%, #059669 100%)';
                                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
                                                }}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecentInterviewsCard;
