/**
 * Stage 2 (voice) competency display.
 *
 * Since 2026-09-13 the voice scorer measures TEN fixed competencies — the ones an
 * employer looks for in every role — and returns, for each, a rating word, whether
 * it was assessed, and the verbatim quote it rests on. The board used to show five
 * flat fields instead (`communication`, `language_fluency`, `confidence`,
 * `problem_solving`, `digital_skills`), which the scorer still sends because
 * `campaignComparePool` reads them; those five are a subset and carry no evidence.
 *
 * This module turns the stored evaluation into the same row shape Stage 3 feeds
 * `CompetencyChips`, so both stages read alike.
 *
 * ⚠️ Unlike Stage 3, a Stage 2 competency carries NO title: the ten are fixed, so
 * the label is translated here from the key. A key the scorer adds later still
 * renders — humanized — rather than disappearing.
 */
import { localizeRatingWord } from './ratingWords.js';
import { normalizeStageEvalStringList, normalizeStageEvalText } from './stageRecommendation.js';

/** The ten, in the scorer's weight order (heaviest first). */
export const STAGE2_COMPETENCY_ORDER = [
    'relevant_experience_role_fit',
    'communication_skills',
    'professional_attitude',
    'english_fluency',
    'learning_and_adaptability',
    'time_management_and_prioritization',
    'teamwork_and_collaboration',
    'problem_solving',
    'confidence_level',
    'computer_skills',
];

const LABEL_KEYS = {
    relevant_experience_role_fit: 'stageEval_colRelevantExperience',
    communication_skills: 'stageEval_colCommunicationSkills',
    professional_attitude: 'stageEval_colProfessionalAttitude',
    english_fluency: 'stageEval_colEnglishFluency',
    learning_and_adaptability: 'stageEval_colLearningAdaptability',
    time_management_and_prioritization: 'stageEval_colTimeManagement',
    teamwork_and_collaboration: 'stageEval_colTeamwork',
    problem_solving: 'stageEval_colProblemSolving',
    confidence_level: 'stageEval_colConfidenceLevel',
    computer_skills: 'stageEval_colComputerSkills',
};

/** "learning_and_adaptability" → "Learning and adaptability" (unknown keys only). */
function humanizeKey(key) {
    const s = String(key || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export function stage2CompetencyLabel(key, t) {
    const labelKey = LABEL_KEYS[key];
    return labelKey ? t(labelKey) : humanizeKey(key);
}

function normalizeRating(rating) {
    return String(rating == null ? '' : rating).trim().toLowerCase().replace(/[_-]+/g, ' ');
}

/**
 * Colour band for a rating word. The owner asked for Stage 3's three colours and
 * no fourth, so the middle band is read the way Stage 3 reads its own middle band:
 * `COMPETENCY_MET_MIN_SCORE = 3` of 5 counts as met, and Intermediate — which earns
 * 40% of the competency's weight, not zero — counts the same. The chip still spells
 * the rating out, so the reader sees "Intermediate", not just a colour.
 */
export function stage2RatingTone(rating) {
    const r = normalizeRating(rating);
    if (r === 'excellent') return 'met';
    if (r === 'good') return 'met';
    if (r === 'intermediate') return 'met';
    if (r === 'bad') return 'miss';
    return 'na';
}

function isAssessedRow(row) {
    if (!row || row.assessed === false) return false;
    return stage2RatingTone(row.rating) !== 'na';
}

/**
 * The five flat fields the scorer wrote before it measured ten competencies, in
 * the order their columns stood. 31 of the 41 stored evaluations are still this
 * shape, so they are rendered as chips in the same single column rather than
 * dropped — the reviewer reads every row the same way.
 *
 * `communication` and `problem_solving` can arrive as a 0–10 number instead of a
 * word (the pre-calc metrics path), which is why the tone is resolved for both.
 */
const LEGACY_FIELDS = [
    ['communication', 'stageEval_colCommunicationSkills'],
    ['language_fluency', 'stageEval_colEnglishFluency'],
    ['confidence', 'stageEval_colConfidenceLevel'],
    ['problem_solving', 'stageEval_colProblemSolving'],
    ['digital_skills', 'stageEval_colComputerSkills'],
];

/** Tone for a 0–10 score, on the same three-colour scale: the middle band is met. */
function toneFromTenScore(n) {
    if (!Number.isFinite(n)) return 'na';
    return n >= 4 ? 'met' : 'miss';
}

/** True when this evaluation has a verdict but none of the ten competencies. */
export function isLegacyStage2Evaluation(evaluation) {
    if (!evaluation || isStage2CompetencyEvaluation(evaluation)) return false;
    return LEGACY_FIELDS.some(([field]) => {
        const v = evaluation[field];
        return v != null && v !== '';
    });
}

/**
 * Chip rows for a pre-ten-competency evaluation. No evidence exists for these —
 * that is the whole reason the instrument was replaced — so the chip carries the
 * rating alone and the detail list shows nothing underneath it.
 */
export function buildLegacyStage2Rows(evaluation, t) {
    const rows = [];
    for (const [field, labelKey] of LEGACY_FIELDS) {
        const raw = evaluation?.[field];
        if (raw == null || raw === '') continue;
        const asNumber = typeof raw === 'number' ? raw : NaN;
        const tone = Number.isFinite(asNumber)
            ? toneFromTenScore(asNumber)
            : stage2RatingTone(raw);
        const assessed = tone !== 'na';
        const mark = Number.isFinite(asNumber)
            ? String(asNumber)
            : assessed
              ? localizeRatingWord(normalizeStageEvalText(raw), t)
              : '–';
        rows.push({
            key: field,
            label: t(labelKey),
            tone,
            mark,
            markLabel: assessed ? String(mark) : t('videoInterview_notAssessed'),
            markTitle: assessed ? '' : t('videoInterview_notAssessed'),
            evidence: [],
            redFlags: [],
            note: '',
            assessed,
        });
    }
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
            if (a.row.assessed !== b.row.assessed) return a.row.assessed ? -1 : 1;
            return a.index - b.index;
        })
        .map(({ row }) => {
            const { assessed, ...rest } = row;
            return rest;
        });
}

/** True when this evaluation came from the ten-competency scorer. */
export function isStage2CompetencyEvaluation(evaluation) {
    if (!evaluation) return false;
    if (Array.isArray(evaluation.competencyScores)) return true;
    const status = String(evaluation.status || '').trim().toLowerCase();
    return status === 'insufficient_data' || status === 'insufficient';
}

/** The scorer could not measure enough of the role to stand behind a number. */
export function isInsufficientStage2Evaluation(evaluation) {
    const status = String(evaluation?.status || '').trim().toLowerCase();
    return status === 'insufficient_data' || status === 'insufficient';
}

/**
 * Share of the role's weight that was actually assessed (0–100), or null.
 *
 * ⚠️ `Number(null)` and `Number('')` are both 0 — a finite, in-range number. Read
 * naively, an evaluation with no coverage field would report "Coverage 0%", which
 * says the interview measured nothing. Absence is checked before the conversion.
 */
export function stage2Coverage(evaluation) {
    const raw = evaluation?.coverage;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return Math.round(n);
}

/**
 * Display rows for `CompetencyChips`. Assessed competencies keep the scorer's
 * order (heaviest first); unassessed sink to the bottom, so a reviewer reads what
 * the interview actually covered before what it missed.
 */
export function buildStage2CompetencyRows(evaluation, t) {
    const comps = Array.isArray(evaluation?.competencyScores) ? evaluation.competencyScores : [];
    const rows = comps.map((row, index) => {
        const key = row?.competencyKey || '';
        const assessed = isAssessedRow(row);
        const tone = assessed ? stage2RatingTone(row?.rating) : 'na';
        const ratingText = normalizeStageEvalText(row?.rating);
        const mark = assessed ? localizeRatingWord(ratingText, t) : '–';
        return {
            key: key || `competency-${index}`,
            label: normalizeStageEvalText(row?.title) || stage2CompetencyLabel(key, t),
            tone,
            mark,
            markLabel: assessed ? String(mark) : t('videoInterview_notAssessed'),
            // The mark already spells the rating out; only the dash needs explaining.
            markTitle: assessed ? '' : t('videoInterview_notAssessed'),
            evidence: normalizeStageEvalStringList(row?.evidence),
            redFlags: [],
            note: row?.selfReported === true ? t('stageEval_selfReported') : '',
            assessed,
            index,
        };
    });
    return rows
        .sort((a, b) => {
            if (a.assessed !== b.assessed) return a.assessed ? -1 : 1;
            return a.index - b.index;
        })
        .map(({ assessed, index, ...row }) => row);
}
