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
 * Stage 2 candidates: evaluated (voice eval) + pending (direct Call, entryStage audio).
 * Matches VoiceInterview filter: isDirectAudio || hasEvaluation.
 */
export function splitVoiceCandidates(allCandidates) {
    const evaluated = [];
    const pending = [];
    for (const c of allCandidates) {
        if (isHiddenFromStage(c, 'voice')) continue;
        if (hasMeaningfulStageEvaluation(c.voiceInterviewEvaluation)) {
            evaluated.push(c);
        } else if (c.entryStage === 'audio') {
            pending.push(c);
        }
    }
    return { evaluated, pending };
}
