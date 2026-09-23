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
 *
 * Pending also holds anyone whose VOICE link is spent without an evaluation to
 * show for it (the n8n callback failed, or never came). Stage 2 is the only
 * place the voice link is reopened, so a candidate missing from this page is a
 * link nobody can reopen — the form → voice candidate is never `audio`.
 */
export function splitVoiceCandidates(allCandidates) {
    const evaluated = [];
    const pending = [];
    for (const c of allCandidates) {
        if (isHiddenFromStage(c, 'voice')) continue;
        if (hasMeaningfulStageEvaluation(c.voiceInterviewEvaluation)) {
            evaluated.push(c);
        } else if (c.entryStage === 'audio' || c.voiceInterviewLinkConsumedAt) {
            pending.push(c);
        }
    }
    return { evaluated, pending };
}
