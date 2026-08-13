import React, { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { normalizeHeadHunterPayload } from '../utils/headHunterNormalize.js';
import { useHeadHunterPersistence } from '../hooks/useHeadHunterPersistence.js';
import { useHeadHunterSearchHistory } from '../hooks/useHeadHunterSearchHistory.js';
import HeadHunterResultsWorkspace from '../components/headhunter/HeadHunterResultsWorkspace.jsx';
import '../design-styles.css';

/**
 * صفحة عرض حملة محفوظة محلياً (نتيجة بحث سابقة).
 */
export default function HeadHunterCampaignPage() {
    const { t, currentLang } = useLanguage();
    const { id } = useParams();
    const hh = useHeadHunterPersistence();
    const { getById } = useHeadHunterSearchHistory();

    // `getById` reads + JSON.parses the whole campaign history from localStorage,
    // so it must not run on every render: an unstable `campaign.payload` also
    // re-triggers candidate normalization and defeats memoization down the tree.
    const campaign = useMemo(() => (id ? getById(id) : null), [getById, id]);

    const receivedAtFormatted = useMemo(() => {
        const raw = campaign?.receivedAt;
        if (!raw) return '';
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '—';
        const locale = currentLang === 'ar' ? 'ar' : currentLang === 'ku' ? 'ckb-IQ' : 'en-US';
        try {
            return new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(d);
        } catch {
            return d.toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        }
    }, [campaign?.receivedAt, currentLang]);

    const n8nInbound = useMemo(
        () => ({
            loading: false,
            error: '',
            hasData: Boolean(campaign?.payload),
            receivedAt: campaign?.receivedAt ?? null,
            payload: campaign?.payload ?? null,
        }),
        [campaign?.payload, campaign?.receivedAt],
    );

    const searchContext = useMemo(
        () => ({
            position: campaign?.position,
            location: campaign?.location,
            yearsExperience: campaign?.yearsExperience,
            ageRange: campaign?.ageRange,
            query: campaign?.query,
        }),
        [
            campaign?.position,
            campaign?.location,
            campaign?.yearsExperience,
            campaign?.ageRange,
            campaign?.query,
        ],
    );

    const nCandidates = useMemo(
        () => (campaign?.payload ? normalizeHeadHunterPayload(campaign.payload).candidates.length : 0),
        [campaign?.payload],
    );

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [id]);

    if (!campaign) {
        return (
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
                <div className="container dashboard-visual-container">
                    <div className="dashboard-grid">
                        <div className="dashboard-card dashboard-card--page-active platform-features-card">
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">{t('aiHeadHunterCampaignNotFoundTitle')}</h2>
                            </div>
                            <div className="dashboard-card-body">
                                <p className="headhunter-campaign-history-empty">{t('aiHeadHunterCampaignNotFoundBody')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
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

            <div className="container dashboard-visual-container">
                <div className="dashboard-grid">
                    <div className="dashboard-card dashboard-card--page-active platform-features-card dashboard-card--headhunter-results">
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">{t('aiHeadHunterCampaignSavedTitle')}</h2>
                        </div>
                        <div className="dashboard-card-body">
                            <div className="headhunter-campaign-snapshot-meta" role="region" aria-label={t('aiHeadHunterCampaignMetaRegion')}>
                                <div className="headhunter-campaign-snapshot-meta__item">
                                    <span className="headhunter-campaign-snapshot-meta__label">{t('aiHeadHunterPosition')}</span>
                                    <span className="headhunter-campaign-snapshot-meta__value" dir="auto">
                                        {campaign.position}
                                    </span>
                                </div>
                                <div className="headhunter-campaign-snapshot-meta__item">
                                    <span className="headhunter-campaign-snapshot-meta__label">{t('aiHeadHunterLocation')}</span>
                                    <span className="headhunter-campaign-snapshot-meta__value" dir="auto">
                                        {campaign.location}
                                    </span>
                                </div>
                                <div className="headhunter-campaign-snapshot-meta__item">
                                    <span className="headhunter-campaign-snapshot-meta__label">{t('aiHeadHunterReceivedAt')}</span>
                                    <span className="headhunter-campaign-snapshot-meta__value" dir="auto">
                                        {receivedAtFormatted}
                                    </span>
                                </div>
                                <div className="headhunter-campaign-snapshot-meta__item headhunter-campaign-snapshot-meta__item--badge">
                                    <span className="headhunter-campaign-snapshot-meta__label">
                                        {t('aiHeadHunterCampaignSnapshotCountHeading')}
                                    </span>
                                    <span
                                        className="headhunter-campaign-snapshot-meta__value headhunter-campaign-snapshot-meta__value--accent"
                                        aria-label={t('aiHeadHunterCampaignCandidatesCount').replace('{n}', String(nCandidates))}
                                    >
                                        {nCandidates}
                                    </span>
                                </div>
                            </div>
                            <div
                                className="dashboard-card-body--headhunter-results headhunter-campaign-history-results"
                                role="region"
                                aria-label={t('aiHeadHunterResultsRegion')}
                            >
                                <div className="headhunter-discovery">
                                    <div className="headhunter-discovery__main">
                                        <HeadHunterResultsWorkspace
                                            hh={hh}
                                            n8nInbound={n8nInbound}
                                            campaignPosition={campaign?.position}
                                            searchContext={searchContext}
                                            t={t}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
