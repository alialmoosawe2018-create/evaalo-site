/**
 * One rule, in one order, for "which language should this evaluation be written in?"
 *
 * The three stages each answered it differently, and only Stage 1 ever looked at
 * the campaign: Stage 2 and Stage 3 read the share link and fell back to a blind
 * 'ar'. So an English campaign got Arabic voice/video reports, an Arabic campaign
 * got an English one whenever the link carried a different language, and the same
 * candidate could be described in two languages across two stages of one hiring
 * process.
 *
 * The precedence below reflects who is actually choosing:
 *
 *   1. the campaign — the only party that deliberately chose a REPORT language
 *      (`criteria.evaluationLanguage`, set from the campaign's own language when
 *      it is published). The report is read by the employer, not the candidate.
 *   2. the share/session link — an explicit ar/en/ku picked when the interview or
 *      submission was created. Used when the campaign said nothing.
 *   3. the application's stored evaluationContext.
 *   4. whatever the caller could detect from the candidate's own words.
 *   5. 'ar'.
 *
 * Steps 2–4 only ever run for a campaign with no language on record (older
 * campaigns) or for an interview with no campaign at all.
 */

export type EvaluationLanguage = 'ar' | 'en';

/**
 * A language tag → the language an evaluation is written in.
 * Kurdish maps to Arabic: the evaluators produce ar/en only.
 * @returns null for 'auto', empty, or anything unrecognised — "no answer here",
 *          which is what lets the caller fall through to the next source.
 */
export function normalizeEvaluationLanguage(raw: unknown): EvaluationLanguage | null {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (!s) return null;
    if (s === 'en' || s === 'english' || s.startsWith('en-')) return 'en';
    if (s === 'ar' || s === 'arabic' || s.startsWith('ar-')) return 'ar';
    if (s === 'ku' || s === 'kurdish' || s === 'ckb' || s.startsWith('ku-')) return 'ar';
    return null;
}

/** The campaign's report language, from its criteria object. */
export function campaignCriteriaLanguage(
    criteria?: Record<string, unknown> | null
): EvaluationLanguage | null {
    if (!criteria || typeof criteria !== 'object') return null;
    return normalizeEvaluationLanguage(criteria.evaluationLanguage ?? criteria.language);
}

export interface ResolveEvaluationLanguageInput {
    /** The campaign's criteria object (or a snapshot of it) — highest authority. */
    campaignCriteria?: Record<string, unknown> | null;
    /** Language tag carried by the share link / interview session. */
    shareLanguage?: unknown;
    /** The application's stored evaluation context. */
    evaluationContext?: { evaluationLanguage?: unknown } | null;
    /**
     * What the caller detected from the candidate's own text. Detection differs by
     * stage (a CV blob vs a mixed-language transcript), so each caller does its own
     * and passes the verdict — this function decides only the ORDER.
     */
    detected?: EvaluationLanguage | null;
}

export function resolveEvaluationLanguage(
    input: ResolveEvaluationLanguageInput
): EvaluationLanguage {
    return (
        campaignCriteriaLanguage(input.campaignCriteria) ??
        normalizeEvaluationLanguage(input.shareLanguage) ??
        normalizeEvaluationLanguage(input.evaluationContext?.evaluationLanguage) ??
        input.detected ??
        'ar'
    );
}
