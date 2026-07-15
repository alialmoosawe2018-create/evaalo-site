import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    campaignGroupExists,
    findCampaignSelectionKeyForCandidate,
    resolveCampaignSelectionKey,
} from '../utils/stageEvalNavigation.js';

/**
 * Opens the campaign drill-down and expands a candidate row from ?candidateId=&campaignId= URL params.
 */
export function useStageEvalDeepLink({
    loading,
    campaignGroups,
    campaignCandidates,
    selectedCampaignKey,
    setSelectedCampaignKey,
    setExpandedRows,
    setFilter,
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const candidateId = searchParams.get('candidateId');
    const campaignId = searchParams.get('campaignId');
    const appliedRef = useRef(false);

    useEffect(() => {
        appliedRef.current = false;
    }, [candidateId, campaignId]);

    useEffect(() => {
        if (loading || appliedRef.current) return;

        if (!candidateId && campaignId && selectedCampaignKey === null) {
            const keyFromUrl = resolveCampaignSelectionKey(campaignId);
            if (keyFromUrl && campaignGroupExists(campaignGroups, keyFromUrl)) {
                setSelectedCampaignKey(keyFromUrl);
                appliedRef.current = true;
                setSearchParams({}, { replace: true });
            }
            return;
        }

        if (!candidateId) return;

        const targetId = String(candidateId);

        if (selectedCampaignKey === null) {
            const keyFromUrl = campaignId
                ? resolveCampaignSelectionKey(campaignId)
                : findCampaignSelectionKeyForCandidate(campaignGroups, targetId);
            if (keyFromUrl && campaignGroupExists(campaignGroups, keyFromUrl)) {
                setSelectedCampaignKey(keyFromUrl);
            }
            return;
        }

        if (!Array.isArray(campaignCandidates) || campaignCandidates.length === 0) return;

        const match = campaignCandidates.find(
            (c) => String(c._id || c.id) === targetId,
        );
        if (!match) {
            appliedRef.current = true;
            setSearchParams({}, { replace: true });
            return;
        }

        setFilter('all');
        setExpandedRows(new Set([targetId]));
        appliedRef.current = true;
        setSearchParams({}, { replace: true });

        requestAnimationFrame(() => {
            document
                .querySelector(`[data-stage-candidate-id="${CSS.escape(targetId)}"]`)
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }, [
        loading,
        candidateId,
        campaignId,
        campaignGroups,
        campaignCandidates,
        selectedCampaignKey,
        setSelectedCampaignKey,
        setExpandedRows,
        setFilter,
        setSearchParams,
    ]);
}
