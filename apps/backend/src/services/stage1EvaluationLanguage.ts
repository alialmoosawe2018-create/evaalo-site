import {
    normalizeEvaluationLanguage,
    resolveEvaluationLanguage,
    type EvaluationLanguage,
} from './evaluationLanguage.js';

export type Stage1EvaluationLanguage = EvaluationLanguage;

/** UI / campaign language → evaluation output language (ku → ar), defaulting to 'ar'. */
export function normalizeStage1EvaluationLanguage(raw: unknown): Stage1EvaluationLanguage {
    return normalizeEvaluationLanguage(raw) ?? 'ar';
}

/**
 * The written stage's own language detector: the candidate's identifying text.
 * Any Arabic letter is enough — an Arabic CV routinely names English tools and
 * employers, so a ratio test would read those as an English application.
 * @returns null when there is no text to judge, so the caller falls through.
 */
export function detectStage1TextLanguage(
    candidateData: Record<string, unknown>
): EvaluationLanguage | null {
    const blob = [
        candidateData.full_name,
        candidateData.location,
        candidateData.coverLetter,
        candidateData.position_applied_for,
    ]
        .filter((v) => v != null && String(v).trim())
        .join(' ');
    if (!blob.trim()) return null;
    return /[؀-ۿݐ-ݿ]/.test(blob) ? 'ar' : 'en';
}

export function inferStage1EvaluationLanguage(
    candidateData: Record<string, unknown>,
    criteria?: Record<string, unknown> | null
): Stage1EvaluationLanguage {
    return resolveEvaluationLanguage({
        campaignCriteria: criteria,
        detected: detectStage1TextLanguage(candidateData),
    });
}
