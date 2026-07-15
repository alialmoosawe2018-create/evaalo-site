export type Stage1EvaluationLanguage = 'ar' | 'en';

/** UI / campaign language → evaluation output language (ku → ar). */
export function normalizeStage1EvaluationLanguage(raw: unknown): Stage1EvaluationLanguage {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (s === 'en' || s.startsWith('en-')) return 'en';
    return 'ar';
}

export function inferStage1EvaluationLanguage(
    candidateData: Record<string, unknown>,
    criteria?: Record<string, unknown> | null
): Stage1EvaluationLanguage {
    const fromCampaign = criteria?.evaluationLanguage ?? criteria?.language;
    if (fromCampaign != null && String(fromCampaign).trim()) {
        return normalizeStage1EvaluationLanguage(fromCampaign);
    }
    const blob = [
        candidateData.full_name,
        candidateData.location,
        candidateData.coverLetter,
        candidateData.position_applied_for,
    ]
        .filter((v) => v != null && String(v).trim())
        .join(' ');
    if (/[\u0600-\u06FF\u0750-\u077F]/.test(blob)) return 'ar';
    return 'en';
}
