import { fillI18nTemplate } from './i18nTemplate.js';
import { canonicalStageRecommendation, normalizeStageEvalStringList, normalizeStageEvalText } from './stageRecommendation.js';

/** Competency columns shown in the video evaluation table (0–10 each). */
export const VIDEO_TABLE_COMPETENCY_KEYS = [
    'professional_depth',
    'problem_handling',
    'decision_making',
    'prioritization',
    'process_thinking',
    'responsibility',
    'learning_ability',
    'job_readiness',
];

const COLUMN_LABEL_KEYS = {
    professional_depth: 'videoInterview_colProfessionalDepth',
    problem_handling: 'videoInterview_colProblemHandling',
    decision_making: 'videoInterview_colDecisionMaking',
    prioritization: 'videoInterview_colPrioritization',
    process_thinking: 'videoInterview_colProcessThinking',
    responsibility: 'videoInterview_colResponsibility',
    learning_ability: 'videoInterview_colLearningAbility',
    job_readiness: 'videoInterview_colJobReadiness',
    role_understanding: 'videoInterview_sectionRoleUnderstanding',
    final_role_fit: 'videoInterview_sectionFinalFit',
};

/** Map a 0–10 competency score to good | average | weak (detail cards). */
export function qualitativeBandFromTenScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return null;
    if (n >= 7) return 'good';
    if (n >= 4) return 'average';
    return 'weak';
}

/** Table label bands: good (7–10), average (4–6), bad (0–3) — plain text, no colors. */
export function tableBandFromTenScore(score) {
    return qualitativeBandFromTenScore(score);
}

export function formatTableTenScore(score, t, na = 'N/A') {
    const band = tableBandFromTenScore(score);
    if (!band) return na;
    const keyByBand = {
        good: 'stageEval_qualGood',
        average: 'stageEval_qualAverage',
        weak: 'stageEval_qualBad',
    };
    return t(keyByBand[band]);
}

export function formatQualitativeTenScore(score, t, na = 'N/A') {
    const band = qualitativeBandFromTenScore(score);
    if (!band) return na;
    const keyByBand = {
        good: 'stageEval_qualGood',
        average: 'stageEval_qualAverage',
        weak: 'stageEval_qualWeak',
    };
    return t(keyByBand[band]);
}

export function qualitativeTextColor(band) {
    switch (band) {
        case 'good':
            return '#10B981';
        case 'average':
            return '#F59E0B';
        case 'weak':
            return '#EF4444';
        default:
            return '#94A3B8';
    }
}

function buildDimensionDetail(score, analysisPrefix, t) {
    const band = qualitativeBandFromTenScore(score);
    if (!band) return null;
    const label = formatQualitativeTenScore(score, t);
    const analysis = t(`${analysisPrefix}_${band}`);
    return `${label} — ${analysis}`;
}

export function buildRoleUnderstandingDetail(evaluation, t) {
    return buildDimensionDetail(
        evaluation?.role_understanding,
        'videoInterview_roleUnderstanding',
        t,
    );
}

export function buildFinalRoleFitDetail(evaluation, t) {
    return buildDimensionDetail(
        evaluation?.final_role_fit,
        'videoInterview_finalFit',
        t,
    );
}

export function buildVideoRedFlags(evaluation, t) {
    const flags = [];

    for (const item of normalizeStageEvalStringList(evaluation?.red_flags)) {
        flags.push(item);
    }

    const competencyScores = Array.isArray(evaluation?.competencyScores)
        ? evaluation.competencyScores
        : [];
    for (const row of competencyScores) {
        const title = normalizeStageEvalText(row?.title) || row?.competencyKey || '';
        const rowFlags = Array.isArray(row?.redFlags) ? row.redFlags : [];
        for (const f of rowFlags) {
            const text = normalizeStageEvalText(f);
            if (text) flags.push(title ? `${title}: ${text}` : text);
        }
    }

    for (const key of [...VIDEO_TABLE_COMPETENCY_KEYS, 'role_understanding', 'final_role_fit']) {
        const band = qualitativeBandFromTenScore(evaluation?.[key]);
        if (band !== 'weak') continue;
        const labelKey = COLUMN_LABEL_KEYS[key];
        if (!labelKey) continue;
        flags.push(
            fillI18nTemplate(t('videoInterview_redFlagCompetency'), {
                dimension: t(labelKey),
                rating: t('stageEval_qualWeak'),
            }),
        );
    }

    return [...new Set(flags)];
}

export function buildVideoFinalHrText(evaluation, t, translateRecLabel) {
    const explicit = normalizeStageEvalText(
        evaluation?.final_hr_evaluation || evaluation?.finalHrEvaluation,
    );
    if (explicit) return explicit;

    const recCanon = resolveVideoRecommendation(evaluation);
    if (recCanon === 'N/A' && evaluation?.overall_score == null) return null;

    const recLabel = translateRecLabel(recCanon);
    const score =
        shouldHideOverallScore(evaluation) ||
        evaluation?.overall_score == null ||
        !Number.isFinite(Number(evaluation.overall_score))
            ? ''
            : Number(evaluation.overall_score);

    const noteKey =
        recCanon === 'Hire'
            ? 'videoInterview_finalHrNote_hire'
            : recCanon === 'Consider'
              ? 'videoInterview_finalHrNote_consider'
              : 'videoInterview_finalHrNote_reject';

    return fillI18nTemplate(t('videoInterview_finalHrBuilt'), {
        rec: recLabel,
        score,
        note: t(noteKey),
    });
}

/**
 * True when a blueprint competency row carries a REAL 1–5 score. The v2 scorer
 * emits `score: null` for a competency it could not assess (no evidence), and
 * `Number(null)` coerces to 0 — so a naive `Number.isFinite` check treats those
 * as a real "0/5". Guard against that: null / empty / out-of-range = not assessed.
 */
export function isAssessedBlueprintRow(row) {
    if (!row || row.assessed === false) return false;
    if (row.score == null || row.score === '') return false;
    const n = Number(row.score);
    return Number.isFinite(n) && n >= 1;
}

/**
 * True when a video evaluation should be treated as "insufficient data": the
 * scorer produced a recommendation/score but there is no competency evidence to
 * back it. This covers two cases:
 *   1. the v2 scorer explicitly flagged status === 'insufficient_data', and
 *   2. a degenerate stored record (overall_score + recommendation + summary only,
 *      with no competencyScores and none of the 10 named trait fields) — which is
 *      what an insufficient interview collapses to once the empty breakdown is
 *      dropped on the way into the DB.
 * In both cases the auto recommendation is untrustworthy and the reviewer should
 * re-interview or review manually, so callers surface a notice instead of a
 * table of N/A cells read as a clean "Consider".
 */
export function isInsufficientVideoEvaluation(evaluation) {
    if (!evaluation) return false;

    const status = String(evaluation.status || '').trim().toLowerCase();
    if (status === 'insufficient_data' || status === 'insufficient') return true;

    // Any real assessed blueprint competency (1–5 score) => sufficient.
    const comps = Array.isArray(evaluation.competencyScores) ? evaluation.competencyScores : [];
    if (comps.some(isAssessedBlueprintRow)) return false;

    // Any legacy named competency score => sufficient.
    const legacyKeys = [...VIDEO_TABLE_COMPETENCY_KEYS, 'role_understanding', 'final_role_fit'];
    const anyLegacy = legacyKeys.some((k) => Number.isFinite(Number(evaluation[k])));
    if (anyLegacy) return false;

    // No competency evidence at all, yet a verdict/score exists => insufficient.
    const hasVerdict =
        canonicalStageRecommendation(evaluation.recommendation) !== 'N/A' ||
        (evaluation.overall_score != null && Number.isFinite(Number(evaluation.overall_score)));
    return hasVerdict;
}

/**
 * True when the evaluation came from the blueprint-driven (Stage 3 v2) scorer.
 *
 * Any v2 marker counts — a competencyScores array (even one the scorer could not
 * fill), an explicit insufficient_data status, or the generic_ratings block. An
 * empty array used to fall through to the legacy 8-column table, which showed a
 * v2 result as eight "N/A" traits that were never measured in the first place.
 */
export function isBlueprintVideoEvaluation(evaluation) {
    if (!evaluation) return false;

    if (Array.isArray(evaluation.competencyScores)) return true;
    const status = String(evaluation.status || '').trim().toLowerCase();
    if (status === 'insufficient_data' || status === 'insufficient') return true;
    const generic = evaluation.generic_ratings;
    if (generic && typeof generic === 'object' && !Array.isArray(generic)) return true;

    // No v2 marker: only a record from the retired 8-trait scorer belongs in the
    // legacy layout.
    return false;
}

/**
 * True ONLY for a record from the retired 8-trait scorer: it carries at least one
 * of the eight numeric trait fields and has no v2 (blueprint) marker. Everything
 * else — including an empty or still-loading record — is treated as NOT legacy.
 *
 * The table uses this (rather than `!isBlueprintVideoEvaluation`) to pick a layout,
 * so the blueprint layout is the DEFAULT: an evaluation that has not finished
 * loading its v2 fields no longer flashes the old eight-column table for a beat
 * before the competencies resolve — the legacy layout appears only for a record
 * positively identified as an old 8-trait result.
 */
export function isLegacyVideoEvaluation(evaluation) {
    if (!evaluation) return false;
    if (isBlueprintVideoEvaluation(evaluation)) return false;
    const legacyKeys = [...VIDEO_TABLE_COMPETENCY_KEYS, 'role_understanding', 'final_role_fit'];
    return legacyKeys.some((k) => {
        const v = evaluation[k];
        return v != null && v !== '' && Number.isFinite(Number(v));
    });
}

/**
 * Lowest 1–5 score that still counts as "met" (✓). Reviewers read a competency
 * as pass/fail, not as a number, so the numeric score stays internal to the
 * overall calculation and only the verdict is shown.
 */
export const COMPETENCY_MET_MIN_SCORE = 3;

/** A competency is met only when it was actually assessed AND cleared the bar. */
export function isCompetencyMet(row) {
    if (!isAssessedBlueprintRow(row)) return false;
    return Number(row.score) >= COMPETENCY_MET_MIN_SCORE;
}

/**
 * True when no overall percentage may be shown. An insufficient interview still
 * carries a computed number, and showing it reads as a real pass mark.
 */
export function shouldHideOverallScore(evaluation) {
    return isInsufficientVideoEvaluation(evaluation);
}

/**
 * The recommendation to display. An interview that covered too little of the role
 * cannot support a pass, so it always reads Reject — the v2 scorer now says so
 * itself, but records written before that fix still carry a stale "Consider".
 */
export function resolveVideoRecommendation(evaluation) {
    if (isInsufficientVideoEvaluation(evaluation)) return 'Reject';
    return canonicalStageRecommendation(evaluation?.recommendation);
}

/** Map a blueprint 1–5 competency score to good (4–5) | average (3) | weak (1–2). */
export function fiveScoreBand(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return null;
    if (n >= 4) return 'good';
    if (n >= 3) return 'average';
    return 'weak';
}

/** Humanize a competency key like "technical_troubleshooting" -> "Technical troubleshooting". */
export function humanizeCompetencyKey(key) {
    const s = String(key || '').trim();
    if (!s) return '';
    const words = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** Normalize evaluation.competencyScores into display rows for the blueprint (v2) view. */
export function buildBlueprintCompetencyRows(evaluation) {
    const comps = Array.isArray(evaluation?.competencyScores) ? evaluation.competencyScores : [];
    return comps.map((row) => {
        const key = row?.competencyKey || '';
        const label = normalizeStageEvalText(row?.title) || humanizeCompetencyKey(key);
        const scoreNum = Number(row?.score);
        // `score: null` (the scorer could not assess this competency) must read as
        // "not assessed", NOT "0/5" — Number(null) coerces to 0, so check properly.
        const assessed = isAssessedBlueprintRow(row);
        return {
            key,
            label,
            assessed,
            met: isCompetencyMet(row),
            score: assessed ? scoreNum : null,
            band: assessed ? fiveScoreBand(scoreNum) : null,
            evidence: normalizeStageEvalStringList(row?.evidence),
            redFlags: normalizeStageEvalStringList(row?.redFlags),
        };
    });
}
