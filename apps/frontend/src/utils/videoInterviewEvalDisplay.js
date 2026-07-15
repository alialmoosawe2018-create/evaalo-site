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
