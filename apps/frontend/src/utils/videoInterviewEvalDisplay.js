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

    const recCanon = canonicalStageRecommendation(evaluation?.recommendation);
    if (recCanon === 'N/A' && evaluation?.overall_score == null) return null;

    const recLabel = translateRecLabel(recCanon);
    const score =
        evaluation?.overall_score != null && Number.isFinite(Number(evaluation.overall_score))
            ? Number(evaluation.overall_score)
            : '';

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

    // Any real assessed blueprint competency => sufficient.
    const comps = Array.isArray(evaluation.competencyScores) ? evaluation.competencyScores : [];
    const anyAssessed = comps.some(
        (r) => r?.assessed !== false && Number.isFinite(Number(r?.score)),
    );
    if (anyAssessed) return false;

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
 * True when the evaluation is the blueprint-driven (Stage 3 v2) shape:
 * it carries scored competencyScores and does NOT carry the legacy 10 trait fields.
 */
export function isBlueprintVideoEvaluation(evaluation) {
    if (!evaluation) return false;
    const comps = Array.isArray(evaluation.competencyScores) ? evaluation.competencyScores : [];
    if (comps.length === 0) return false;
    const legacyKeys = [...VIDEO_TABLE_COMPETENCY_KEYS, 'role_understanding', 'final_role_fit'];
    const hasLegacyTrait = legacyKeys.some((k) => {
        const v = evaluation[k];
        return v !== undefined && v !== null && v !== '';
    });
    return !hasLegacyTrait;
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
        const assessed = row?.assessed !== false && Number.isFinite(scoreNum);
        return {
            key,
            label,
            assessed,
            score: assessed ? scoreNum : null,
            band: assessed ? fiveScoreBand(scoreNum) : null,
            evidence: normalizeStageEvalStringList(row?.evidence),
            redFlags: normalizeStageEvalStringList(row?.redFlags),
        };
    });
}
