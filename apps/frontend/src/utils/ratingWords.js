/**
 * The stage scorers write their rating words in English no matter what language
 * the rest of the report is in — "Medium", "High", "Fluent" — because those words
 * are a fixed enum the backend and the comparison AI read, not prose. So an
 * otherwise-Arabic voice evaluation showed English words down the skills row.
 *
 * They are translated HERE, at display time, and the stored value stays the
 * English enum: `recommendation` (Hire / Consider / Reject) is from the same
 * family, and compare, filtering and the stage board all key off it.
 *
 * Only whole rating words are translated. A rating cell sometimes arrives as
 * "Good (7/10)" — the word is translated and the score dropped, matching every
 * other cell in that table — but a sentence that merely STARTS with a rating word
 * ("Good communication throughout…") is left alone rather than truncated to one
 * word, so this is safe to apply to a field that might hold prose.
 */

/** Rating vocabulary → translation key. Longest phrase wins, so "very good" beats "good". */
const RATING_KEYS = {
    stageEval_rateExcellent: [
        'excellent',
        'outstanding',
        'exceptional',
        'superior',
        'very good',
        'very high',
        'very strong',
        'native',
        'expert',
        'advanced',
        'fluent',
        'strong',
    ],
    stageEval_rateGood: [
        'good',
        'high',
        'proficient',
        'above average',
        'competent',
        'solid',
        'upper intermediate',
    ],
    stageEval_rateIntermediate: [
        'intermediate',
        'medium',
        'moderate',
        'average',
        'fair',
        'adequate',
        'satisfactory',
        'sufficient',
        'acceptable',
        'conversational',
    ],
    stageEval_rateBasic: [
        'basic',
        'beginner',
        'elementary',
        'novice',
        'limited',
        'below average',
        'emerging',
    ],
    stageEval_rateBad: [
        'bad',
        'poor',
        'weak',
        'low',
        'very low',
        'very poor',
        'very weak',
        'insufficient',
        'minimal',
        'lacking',
        'none',
    ],
};

/** Phrases sorted longest-first, so "very good" is tested before "good". */
const RATING_ENTRIES = Object.entries(RATING_KEYS)
    .flatMap(([key, words]) => words.map((word) => [word, key]))
    .sort((a, b) => b[0].length - a[0].length);

const NOT_ASSESSED = /^(not\s?assessed|not\s?evaluated|not\s?applicable|unassessed|n\/?a)$/;

/** "Very_Good" / "VERY  GOOD" → "very good" — the scorers are not consistent. */
function normalizeWord(text) {
    return String(text)
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.،,;:!]+$/, '');
}

/**
 * True when what follows a rating word is a score or a qualifier rather than more
 * sentence — "Good (7/10)", "High – 8", "Medium." — which is what makes it safe to
 * show the rating word alone.
 */
function isScoreTail(tail) {
    return /^[\s(:\-–—/]*\(?\s*\d/.test(tail) || /^[\s.،,;:!)]*$/.test(tail);
}

/**
 * Translate a rating word for display.
 * @param {*} value raw value from the evaluation (word, "word (n/10)", prose, number)
 * @param {(key: string) => string} t translator from the language context
 * @returns the translated rating, or the value unchanged when it is not a rating
 */
export function localizeRatingWord(value, t) {
    if (value == null) return value;
    const raw = String(value).trim();
    if (!raw) return value;

    const normalized = normalizeWord(raw);
    if (NOT_ASSESSED.test(normalized)) return t('videoInterview_notAssessed');

    for (const [word, key] of RATING_ENTRIES) {
        if (normalized === word) return t(key);
    }
    for (const [word, key] of RATING_ENTRIES) {
        if (!normalized.startsWith(word)) continue;
        if (isScoreTail(normalized.slice(word.length))) return t(key);
        break;
    }
    return value;
}
