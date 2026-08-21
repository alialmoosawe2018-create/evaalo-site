/**
 * Recommendation calibration — keep the HR recommendation label consistent with
 * the numeric overall_score.
 *
 * n8n's LLM sometimes returns an over-optimistic label (e.g. a 61/100 marked
 * "Hire" while the narrative says "advance to Stage 3 to verify"). This clamps
 * the label DOWN to what the score band allows. It never inflates a cautious
 * label, so it can only make the recommendation more conservative.
 *
 * Disable with `STAGE_REC_SCORE_CLAMP=false`.
 */
export type Recommendation = 'Hire' | 'Consider' | 'Reject';

/** ترتيب التوصيات من الأضعف للأقوى — للمقارنة والتخفيض عند تجاوز حد الدرجة. */
const RECOMMENDATION_RANK: Record<Recommendation, number> = {
    Reject: 0,
    Consider: 1,
    Hire: 2,
};

/**
 * سقف التوصية حسب الدرجة (0–100). مرتّبة تنازلياً؛ أول عتبة يبلغها `score` تحدّد
 * أعلى توصية مسموحة:
 *   ≥ 70  → Hire
 *   50–69 → Consider
 *   < 50  → Reject
 * قابلة للضبط عبر البيئة: `STAGE_REC_HIRE_MIN` (افتراضي 70) و`STAGE_REC_CONSIDER_MIN` (افتراضي 50).
 */
function scoreCeiling(score: number): Recommendation {
    const hireMin = numEnv('STAGE_REC_HIRE_MIN', 70);
    const considerMin = numEnv('STAGE_REC_CONSIDER_MIN', 50);
    if (score >= hireMin) return 'Hire';
    if (score >= considerMin) return 'Consider';
    return 'Reject';
}

function numEnv(name: string, def: number): number {
    const v = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

/**
 * يُخفّض التوصية إلى ما تسمح به الدرجة (لا يرفعها أبداً). يعيد التوصية كما هي عند
 * غياب الدرجة، أو تعطيل الحارس، أو كون التوصية متّسقة/أكثر تحفّظاً من سقف الدرجة.
 */
export function clampRecommendationToScore(
    rec: Recommendation | undefined,
    score: number | undefined
): Recommendation | undefined {
    if (!rec) return rec;
    if (typeof score !== 'number' || !Number.isFinite(score)) return rec;
    if (typeof process !== 'undefined' && process.env?.STAGE_REC_SCORE_CLAMP === 'false') return rec;
    const ceiling = scoreCeiling(score);
    return RECOMMENDATION_RANK[rec] > RECOMMENDATION_RANK[ceiling] ? ceiling : rec;
}
