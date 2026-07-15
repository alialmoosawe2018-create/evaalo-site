import { SCREENING_UNCATEGORIZED_KEY, findCampaignGroup } from './screeningCampaigns.js';

export function stageEvalPathForStage(stage) {
    const n = Number(stage);
    if (n === 2) return '/call-evaluation';
    if (n === 3) return '/video-evaluation';
    return '/screening';
}

export function resolveCampaignSelectionKey(campaignId) {
    if (campaignId == null || String(campaignId).trim() === '') {
        return SCREENING_UNCATEGORIZED_KEY;
    }
    return String(campaignId).trim();
}

export function buildStageEvalCandidateUrl(stage, { candidateId, campaignId } = {}) {
    const path = stageEvalPathForStage(stage);
    const q = new URLSearchParams();
    if (candidateId != null && String(candidateId).trim() !== '') {
        q.set('candidateId', String(candidateId));
    }
    if (campaignId != null && String(campaignId).trim() !== '') {
        q.set('campaignId', String(campaignId));
    }
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
}

export function findCampaignSelectionKeyForCandidate(groups, candidateId) {
    if (!groups || candidateId == null) return null;
    const id = String(candidateId);
    const rows = [
        ...(groups.active || []),
        ...(groups.uncategorized ? [groups.uncategorized] : []),
    ];
    for (const row of rows) {
        const inBucket = [...(row.evaluated || []), ...(row.pending || [])].some(
            (c) => String(c._id || c.id) === id,
        );
        if (inBucket) return row.selectionKey;
    }
    return null;
}

export function campaignGroupExists(groups, selectionKey) {
    if (!selectionKey) return false;
    return Boolean(findCampaignGroup(groups, selectionKey));
}
