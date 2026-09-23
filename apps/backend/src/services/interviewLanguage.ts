/**
 * The language an interview is CONDUCTED in — voice (Stage 2) and video (Stage 3).
 *
 * Owner's decision, 2026-09-23: it is set when the job is created, and nothing
 * else decides it — not the share link, not the recruiter's browser, not the
 * candidate's browser. The REPORT language (`criteria.evaluationLanguage`, see
 * ./evaluationLanguage.ts) is a different question and is deliberately untouched:
 * an Arabic interview with an English report is a legitimate request.
 *
 * Why the campaign and not the link: the language changes the SHAPE of the
 * interview, not just its words. An Arabic voice session has a Phase 3 English
 * test; an English one has none and runs Phase 2 to the time cap. Two candidates
 * in one campaign interviewed in two languages took two different interviews, and
 * their scores are compared side by side. And the link was where the defect lived:
 * on 2026-09-23 both interviews ran in English because every link builder stamped
 * the recruiter's browser locale ('en' by default) into `?language=`, while both
 * campaigns said Arabic.
 *
 * This module is neutral on purpose — neither under `evaalo-only-voice/` nor in the
 * video route — so both stages import the same rule and cannot drift apart.
 */
import { campaignCriteriaLanguage, normalizeEvaluationLanguage } from './evaluationLanguage.js';

export type InterviewLanguage = 'ar' | 'en';

/** Where the answer came from — logged, so a wrong language is diagnosable. */
export type InterviewLanguageSource = 'campaign' | 'legacy_evaluation_language' | 'default';

/**
 * One normalizer for the whole system. Kurdish is served by the Arabic voice, as
 * everywhere else in the voice path; anything unrecognised is `null` — "not said",
 * which is a different value from Arabic.
 */
export function normalizeInterviewLanguage(raw: unknown): InterviewLanguage | null {
    return normalizeEvaluationLanguage(raw);
}

export interface CampaignLanguageFields {
    interviewLanguage?: unknown;
    criteria?: Record<string, unknown> | null;
}

/**
 * The campaign's own field; else, for a campaign created before the field existed,
 * its report language read EXACTLY as the report reads it (campaignCriteriaLanguage),
 * so an old campaign keeps the language it has behaved with since V1; else Arabic.
 *
 * The share link is not an input. That is the point.
 */
export function resolveCampaignInterviewLanguage(
    campaign?: CampaignLanguageFields | null
): { language: InterviewLanguage; source: InterviewLanguageSource } {
    const own = normalizeInterviewLanguage(campaign?.interviewLanguage);
    if (own) return { language: own, source: 'campaign' };
    const legacy = campaignCriteriaLanguage(campaign?.criteria ?? null);
    if (legacy) return { language: legacy, source: 'legacy_evaluation_language' };
    return { language: 'ar', source: 'default' };
}

/**
 * Load and resolve by campaignId — for the candidate-facing pages, which have a
 * campaignId and nothing else. Modelled on `loadCampaignRoles` (./campaignRole.ts),
 * which already serves this same public route: dynamic model import, keyed read,
 * swallows its own errors. A campaign that cannot be read resolves to the same
 * Arabic default the voice session falls back to, so page and agent agree.
 */
export async function loadCampaignInterviewLanguage(
    campaignId: string
): Promise<{ language: InterviewLanguage; source: InterviewLanguageSource }> {
    const id = String(campaignId || '').trim();
    if (!id) return resolveCampaignInterviewLanguage(null);
    try {
        const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
        const doc = await RecruitmentCampaign.findOne({ campaignId: id })
            .select('interviewLanguage criteria.evaluationLanguage criteria.language')
            .lean();
        return resolveCampaignInterviewLanguage(doc as CampaignLanguageFields | null);
    } catch (error: unknown) {
        console.warn(
            `[interviewLanguage] campaign ${id} unreadable: ${error instanceof Error ? error.message : error}`
        );
        return resolveCampaignInterviewLanguage(null);
    }
}
