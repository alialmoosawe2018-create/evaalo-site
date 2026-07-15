import { hasMeaningfulStageEvaluation } from './stageRecommendation.js';
import {
    buildScreeningCampaignGroups,
    collectCampaignIdsFromCandidates,
    findCampaignGroup,
    isHiddenFromStage,
    SCREENING_UNCATEGORIZED_KEY,
} from './screeningCampaigns.js';

export {
    buildScreeningCampaignGroups,
    collectCampaignIdsFromCandidates,
    findCampaignGroup,
    SCREENING_UNCATEGORIZED_KEY,
};

/**
 * Stage 3 candidates: evaluated (video eval) + pending (direct Video, entryStage video).
 * Matches VideoInterview filter: isDirectVideo || hasEvaluation.
 */
export function splitVideoCandidates(allCandidates) {
    const evaluated = [];
    const pending = [];
    for (const c of allCandidates) {
        if (isHiddenFromStage(c, 'video')) continue;
        if (hasMeaningfulStageEvaluation(c.videoInterviewEvaluation)) {
            evaluated.push(c);
        } else if (c.entryStage === 'video') {
            pending.push(c);
        }
    }
    return { evaluated, pending };
}
