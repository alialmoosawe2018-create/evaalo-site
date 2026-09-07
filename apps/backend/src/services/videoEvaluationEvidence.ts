/**
 * Did the video interview actually measure anything?
 *
 * An interview that was cut short still comes back with a computed
 * `overall_score` and a recommendation. The stage board already refuses to show
 * that number — `isInsufficientVideoEvaluation` in the frontend hides the score
 * and reads the verdict as Reject — but that rule lived ONLY in the browser, so
 * the one reader that actually ranks people never saw it: campaignComparePool
 * copied `overall_score` and `recommendation` straight into the comparison. A
 * candidate whose connection dropped after a minute could therefore be ranked
 * against someone who sat through the whole interview, on a number backed by no
 * evidence.
 *
 * This is the same rule, moved to where the decision is made. It is a faithful
 * port of the frontend's `videoInterviewEvalDisplay.js` — the two must agree, or
 * the board and the comparison will describe the same candidate differently.
 */

/** The blueprint (v2) competency keys the retired 8-trait scorer also used. */
const LEGACY_COMPETENCY_KEYS = [
    'professional_depth',
    'problem_handling',
    'decision_making',
    'prioritization',
    'process_thinking',
    'responsibility',
    'learning_ability',
    'job_readiness',
    'role_understanding',
    'final_role_fit',
] as const;

const FINAL_RECOMMENDATIONS = new Set(['hire', 'consider', 'reject']);

/**
 * True when a blueprint row carries a REAL 1–5 score. `score: null` means the
 * scorer could not assess that competency, and `Number(null)` is 0 — so a naive
 * finite check would read "not assessed" as a real zero.
 */
function isAssessedBlueprintRow(row: unknown): boolean {
    if (!row || typeof row !== 'object') return false;
    const r = row as { assessed?: unknown; score?: unknown };
    if (r.assessed === false) return false;
    if (r.score == null || r.score === '') return false;
    const n = Number(r.score);
    return Number.isFinite(n) && n >= 1;
}

export interface VideoEvaluationLike {
    status?: unknown;
    overall_score?: unknown;
    recommendation?: unknown;
    competencyScores?: unknown;
    [key: string]: unknown;
}

/**
 * True when the evaluation carries a verdict with no evidence behind it.
 *
 * Two ways that happens:
 *   1. the v2 scorer said so outright (`status: 'insufficient_data'`), and
 *   2. a degenerate record — a score and a recommendation, but not one assessed
 *      competency — which is what an interview that ended early collapses to
 *      once the empty breakdown is dropped on the way into the database.
 *
 * An evaluation with no verdict at all is NOT insufficient; it is simply absent,
 * and callers filter those out long before this.
 */
export function isInsufficientVideoEvaluation(
    evaluation: VideoEvaluationLike | null | undefined
): boolean {
    if (!evaluation) return false;

    const status = String(evaluation.status ?? '').trim().toLowerCase();
    if (status === 'insufficient_data' || status === 'insufficient') return true;

    const comps = Array.isArray(evaluation.competencyScores) ? evaluation.competencyScores : [];
    if (comps.some(isAssessedBlueprintRow)) return false;

    const anyLegacy = LEGACY_COMPETENCY_KEYS.some((k) =>
        Number.isFinite(Number(evaluation[k]))
    );
    if (anyLegacy) return false;

    const hasVerdict =
        FINAL_RECOMMENDATIONS.has(String(evaluation.recommendation ?? '').trim().toLowerCase()) ||
        (evaluation.overall_score != null && Number.isFinite(Number(evaluation.overall_score)));
    return hasVerdict;
}

/** What the comparison is told about the evidence behind a row. */
export type InterviewEvidence = 'complete' | 'insufficient';

export function videoInterviewEvidence(
    evaluation: VideoEvaluationLike | null | undefined
): InterviewEvidence {
    return isInsufficientVideoEvaluation(evaluation) ? 'insufficient' : 'complete';
}
