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
 *
 * Pending also holds anyone whose VIDEO link is spent without an evaluation.
 * The video link locks on a single spoken sentence, so a short session can lock
 * it and produce nothing to score — and Stage 3 is the only place it is
 * reopened. Until 2026-09-23 the Stage 2 button covered this case; that button
 * now reopens the voice link.
 */
export function splitVideoCandidates(allCandidates) {
    const evaluated = [];
    const pending = [];
    for (const c of allCandidates) {
        if (isHiddenFromStage(c, 'video')) continue;
        if (hasMeaningfulStageEvaluation(c.videoInterviewEvaluation)) {
            evaluated.push(c);
        } else if (c.entryStage === 'video' || c.videoInterviewLinkConsumedAt) {
            pending.push(c);
        }
    }
    return { evaluated, pending };
}
