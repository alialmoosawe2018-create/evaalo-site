/** Maps API/text recommendation to Hire | Consider | Reject | Incomplete | N/A | other verbatim */
export function canonicalStageRecommendation(rec) {
    if (rec == null || String(rec).trim() === '') return 'N/A';
    const s = String(rec).trim();
    const lower = s.toLowerCase();
    if (lower === 'hire') return 'Hire';
    if (lower === 'consider') return 'Consider';
    if (lower === 'reject') return 'Reject';
    if (lower === 'incomplete') return 'Incomplete';
    return s;
}

const INVALID_STAGE_EVAL_TEXT = new Set(['undefined', 'null', 'nan', '']);

/** Hide n8n/JS placeholder strings and empty values in stage evaluation UI. */
export function normalizeStageEvalText(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || INVALID_STAGE_EVAL_TEXT.has(s.toLowerCase())) return null;
    return s;
}

/** Parse strengths/weaknesses arrays that may arrive JSON-stringified from n8n. */
export function normalizeStageEvalStringList(raw) {
    if (raw == null) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items
        .flatMap((item) => {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed)) return parsed;
                    } catch {
                        /* keep scalar */
                    }
                }
            }
            return [item];
        })
        .map((x) => normalizeStageEvalText(x))
        .filter(Boolean);
}

/** n8n/Mongoose may yield empty subdocs — only count evaluations with real content. */
export function hasMeaningfulStageEvaluation(e) {
    return Boolean(
        e &&
            (e.recommendation ||
                e.overall_score != null ||
                e.summary ||
                e.final_hr_evaluation ||
                e.role_understanding != null ||
                e.professional_depth != null ||
                e.final_role_fit != null)
    );
}

/**
 * درجة المرحلة 0–100: `overall_score` أولاً، ثم حقول بديلة شائعة من n8n (مثل aiEvaluation.score).
 * @param {Record<string, unknown> | null | undefined} evaluation
 * @param {unknown[]} [fallbacks]
 * @returns {number | null}
 */
export function resolveStageOverallScore(evaluation, fallbacks = []) {
    if (evaluation?.overall_score != null) {
        const n = Number(evaluation.overall_score);
        if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
    }
    for (const fb of fallbacks) {
        if (fb == null || fb === '') continue;
        const n = Number(fb);
        if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
    }
    return null;
}

export function isScreeningEntryCandidate(candidate) {
    const entry = candidate?.entryStage;
    return !entry || entry === 'screening';
}

/** Dashboard «Recent Interviews» — aligned with Written/Voice/Video stage pages. */
export function resolveDashboardInterviewStage(candidate) {
    if (
        hasMeaningfulStageEvaluation(candidate?.videoInterviewEvaluation) ||
        candidate?.entryStage === 'video'
    ) {
        return 3;
    }
    if (
        hasMeaningfulStageEvaluation(candidate?.voiceInterviewEvaluation) ||
        candidate?.entryStage === 'audio'
    ) {
        return 2;
    }
    if (
        hasMeaningfulStageEvaluation(candidate?.writtenInterviewEvaluation) ||
        isScreeningEntryCandidate(candidate)
    ) {
        return 1;
    }
    return null;
}
