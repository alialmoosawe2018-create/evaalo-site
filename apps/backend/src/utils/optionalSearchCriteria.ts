export const OPTIONAL_CRITERION_LABELS: Record<string, { en: string; ar: string }> = {
    requiredLanguages: { en: 'Required languages', ar: 'اللغات المطلوبة' },
    requiredSkills: { en: 'Required skills', ar: 'المهارات المطلوبة' },
    certifications: { en: 'Certifications', ar: 'الشهادات' },
    company: { en: 'Company', ar: 'الشركة' },
    gender: { en: 'Gender', ar: 'الجنس' },
};

export const OPTIONAL_CRITERION_KEYS = Object.keys(OPTIONAL_CRITERION_LABELS);

export function parseOptionalCriteria(
    source: Record<string, unknown>,
    maxLen: number
): { criteria: Record<string, string>; error?: string } {
    const criteria: Record<string, string> = {};
    for (const key of OPTIONAL_CRITERION_KEYS) {
        const raw = typeof source[key] === 'string' ? source[key].trim() : '';
        if (!raw) continue;
        if (raw.length > maxLen) {
            return { criteria: {}, error: `${key} must be at most ${maxLen} characters` };
        }
        criteria[key] = raw;
    }
    return { criteria };
}

export function phraseOptionalCriterion(key: string, value: string): { en: string; ar: string } {
    const label = OPTIONAL_CRITERION_LABELS[key];
    if (label) {
        return { en: `${label.en}: ${value}`, ar: `${label.ar}: ${value}` };
    }
    return { en: `${key}: ${value}`, ar: `${key}: ${value}` };
}

export function optionalCriteriaToPhrases(criteria: Record<string, string>): { en: string; ar: string }[] {
    return Object.entries(criteria).map(([key, value]) => phraseOptionalCriterion(key, value));
}
