import type { RubricResultItem, RubricResultValue } from '../shared/formTemplates/types.js';
import { isValidRubricResultValue } from './stage1N8nPayloadBuilder.js';

const CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);

function asStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
            }
        } catch {
            /* ignore */
        }
    }
    return [];
}

function pickRubricResultsRaw(data: Record<string, unknown>): unknown {
    const nested = data.writtenInterviewEvaluation;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const rr = (nested as Record<string, unknown>).rubricResults;
        if (rr !== undefined) return rr;
    }
    return data.rubricResults ?? data.rubric_results;
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
        const rubricItemId = String(o.rubricItemId ?? o.rubric_item_id ?? '').trim();
        const resultRaw = String(o.result ?? '').trim() as RubricResultValue;
        if (!rubricItemId || !isValidRubricResultValue(resultRaw)) continue;
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
