import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { normalizeHeadHunterPayload } from '../utils/headHunterNormalize.js';
import { apiClient } from '../services/apiClient';
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

    /**
     * The cached copy is whatever the tab last managed to save, and that is exactly
     * what went wrong: a search closed before its expansion wave landed was cached
     * short — 11 of 20 candidates on a real search, all 20 of them already paid for.
     * Since 2026-09-28 the server keeps every candidate, so ask it.
     *
     * It only ever ADDS. The server copy replaces the cached one when it holds more
     * candidates and never when it holds fewer, so a stale or empty server answer
     * cannot take results off a page that is already showing them.
     */
    const searchId = campaign?.searchId || (campaign ? null : id);
    const [serverPayload, setServerPayload] = useState(null);
    useEffect(() => {
        if (!searchId) return undefined;
        let alive = true;
        apiClient
            .get(`/api/head-hunter/last-result?searchId=${encodeURIComponent(searchId)}`, { quiet: true })
            .then((res) => {
                if (!alive || !res?.payload) return;
                const fromServer = normalizeHeadHunterPayload(res.payload).candidates.length;
                const cached = normalizeHeadHunterPayload(campaign?.payload ?? null).candidates.length;
                if (fromServer > cached) setServerPayload(res.payload);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [searchId, campaign?.payload]);

    const effectivePayload = serverPayload ?? campaign?.payload ?? null;

    const n8nInbound = useMemo(
        () => ({
            loading: false,
            error: '',
            hasData: Boolean(effectivePayload),
            receivedAt: campaign?.receivedAt ?? null,
            payload: effectivePayload,
        }),
        [effectivePayload, campaign?.receivedAt],
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
        // Counts the payload actually on screen, so the badge can never disagree
        // with the list below it.
        () => (effectivePayload ? normalizeHeadHunterPayload(effectivePayload).candidates.length : 0),
        [effectivePayload],
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
