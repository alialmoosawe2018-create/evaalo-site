import type { RubricResultItem, RubricResultValue } from '../shared/formTemplates/types.js';
import { isValidRubricResultValue } from './stage1N8nPayloadBuilder.js';

const CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);

function asStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
            }
        } catch {
            /* not JSON — Stage 1 sends one sentence of evidence per criterion */
        }
        return [s];
    }
    return [];
}

/**
 * Stage 1's scoring node speaks a different dialect than this model does, in
 * three places at once: it sends `criteria_results`, not `rubricResults`; its
 * items are keyed `criterionId`/`status`, not `rubricItemId`/`result`; and its
 * vocabulary is met/partial/missing/not_assessed, not
 * meets/partially_meets/does_not_meet/insufficient_evidence.
 *
 * Any one of those made the normalizer return undefined, so EVERY per-criterion
 * breakdown has been silently dropped: a candidate showed a score with nothing
 * explaining it, and `buildStage1Item` built the compare payload's `eligibility`
 * from the same empty array — the comparison AI ranked people without ever
 * seeing which requirements they actually met.
 */
const STAGE1_STATUS_TO_RUBRIC_RESULT: Record<string, RubricResultValue> = {
    met: 'meets',
    meets: 'meets',
    partial: 'partially_meets',
    partially_meets: 'partially_meets',
    missing: 'does_not_meet',
    does_not_meet: 'does_not_meet',
    not_assessed: 'insufficient_evidence',
    'not assessed': 'insufficient_evidence',
    insufficient_evidence: 'insufficient_evidence',
};

function pickRubricResultsRaw(data: Record<string, unknown>): unknown {
    const nested = data.writtenInterviewEvaluation;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const n = nested as Record<string, unknown>;
        const rr = n.rubricResults ?? n.criteria_results ?? n.criteriaResults;
        if (rr !== undefined) return rr;
    }
    return (
        data.rubricResults ??
        data.rubric_results ??
        data.criteria_results ??
        data.criteriaResults
    );
}

/** Normalize inbound n8n rubricResults for persistence (hidden from UI until Phase 2). */
export function normalizeRubricResultsFromWebhook(
    data: Record<string, unknown>
): RubricResultItem[] | undefined {
    const raw = pickRubricResultsRaw(data);
    if (!Array.isArray(raw) || raw.length === 0) return undefined;

    const out: RubricResultItem[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const rubricItemId = String(
            o.rubricItemId ?? o.rubric_item_id ?? o.criterionId ?? o.criterion_id ?? ''
        ).trim();
        const rawStatus = String(o.result ?? o.status ?? '').trim().toLowerCase();
        const resultRaw = STAGE1_STATUS_TO_RUBRIC_RESULT[rawStatus];
        if (!rubricItemId || !resultRaw || !isValidRubricResultValue(resultRaw)) continue;
        const confidenceRaw = String(o.confidence ?? 'medium').trim().toLowerCase();
        const confidence = CONFIDENCE_VALUES.has(confidenceRaw)
            ? (confidenceRaw as RubricResultItem['confidence'])
            : 'medium';
        out.push({
            rubricItemId,
            result: resultRaw,
            evidence: asStringArray(o.evidence),
            confidence,
        });
    }
    return out.length > 0 ? out : undefined;
}
