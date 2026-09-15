import { randomBytes } from 'crypto';
import {
    PRESET_RUBRIC_KEYS,
    NON_CRITERION_META_KEYS,
    buildRubricDraftsFromCampaignInput,
    buildRubricItemsFromDrafts,
    sanitizeRubricText,
    validateRubricDraftList,
    type EvaluationRubricItem,
    type RubricDraftItem,
    RUBRIC_EXPECTATION_MAX,
    RUBRIC_LABEL_MAX,
} from '../shared/formTemplates/index.js';
import { hashRubricContent } from './formTemplateService.js';

export class RubricValidationError extends Error {
    readonly statusCode = 400;
    readonly code: string;
    readonly details: Array<{ code: string; message: string; index?: number }>;

    constructor(
        code: string,
        message: string,
        details: Array<{ code: string; message: string; index?: number }> = []
    ) {
        super(message);
        this.name = 'RubricValidationError';
        this.code = code;
        this.details = details;
    }
}

function assignRubricId(draft: RubricDraftItem, index: number): string {
    const suffix = randomBytes(4).toString('hex');
    if (draft.type === 'preset' && draft.key) {
        return `preset__${draft.key}__${suffix}`;
    }
    const slug = sanitizeRubricText(draft.label, RUBRIC_LABEL_MAX)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 40);
    return `custom__${slug || 'item'}__${suffix}`;
}

export function parseCustomRubricInput(
    raw: unknown
): Array<{ label: string; expectation: string; essential?: boolean }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ label: string; expectation: string; essential?: boolean }> = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const label = sanitizeRubricText(String(o.label ?? ''), RUBRIC_LABEL_MAX);
        const expectation = sanitizeRubricText(String(o.expectation ?? o.value ?? ''), RUBRIC_EXPECTATION_MAX);
        if (label && expectation) {
            out.push(o.essential === true ? { label, expectation, essential: true } : { label, expectation });
        }
    }
    return out;
}

/**
 * The preset keys the recruiter marked as must-haves. Accepts the array the UI
 * sends and, defensively, a JSON string of it — the same tolerance the rest of
 * the body already gets. Unknown keys are dropped rather than trusted.
 */
export function parseEssentialCriteriaInput(raw: unknown): Set<string> {
    let arr: unknown = raw;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) return new Set();
    return new Set(
        arr
            .map((k) => String(k ?? '').trim())
            .filter((k) => k && PRESET_RUBRIC_KEYS.has(k))
    );
}

export function buildEvaluationRubricFromCampaignBody(body: Record<string, unknown>): {
    items: EvaluationRubricItem[];
    rubricSnapshotHash: string;
    rubricVersion: number;
} {
    const customRaw = body.customRubricItems ?? body.customCriteria;
    const customItems = parseCustomRubricInput(customRaw);
    const essentialKeys = parseEssentialCriteriaInput(body.essentialCriteria);

    const flatForPresets = { ...body };
    delete flatForPresets.customRubricItems;
    delete flatForPresets.customCriteria;
    delete flatForPresets.evaluationRubric;
    delete flatForPresets.formTemplateId;
    delete flatForPresets.essentialCriteria;

    const drafts = buildRubricDraftsFromCampaignInput(flatForPresets, customItems, essentialKeys);
    const validationErrors = validateRubricDraftList(drafts);
    if (validationErrors.length > 0) {
        throw new RubricValidationError(
            'RUBRIC_VALIDATION_FAILED',
            'Evaluation rubric validation failed',
            validationErrors
        );
    }

    if (drafts.length === 0) {
        throw new RubricValidationError('RUBRIC_EMPTY', 'At least one evaluation criterion is required');
    }

    const items = buildRubricItemsFromDrafts(drafts, assignRubricId);
    return {
        items,
        // المحتوى لا الهويّة — معرّفات البنود تحمل لاحقة عشوائية.
        rubricSnapshotHash: hashRubricContent(items),
        rubricVersion: 1,
    };
}

export function stripRubricAndTemplateKeysFromCriteria(body: Record<string, unknown>): Record<string, unknown> {
    const criteria = { ...body };
    const remove = [
        'evaluationRubric',
        'customRubricItems',
        'customCriteria',
        // A list of keys, not a requirement — left in `criteria` it would be
        // derived into a bogus custom criterion the candidate can never meet.
        'essentialCriteria',
        'formTemplateId',
        'jobAdvertisement',
        'interviewType',
        'templateType',
        'templateName',
        'step',
        'timestamp',
    ];
    for (const k of remove) delete criteria[k];
    return criteria;
}

export function deriveLegacyRubricFromCriteria(criteria: Record<string, unknown>): EvaluationRubricItem[] {
    const customItems: Array<{ label: string; expectation: string }> = [];
    for (const [k, v] of Object.entries(criteria)) {
        if (PRESET_RUBRIC_KEYS.has(k)) continue;
        // Catalog plumbing and the report language are not things a candidate
        // can meet; without this the scorer was handed 4 unanswerable criteria.
        if (NON_CRITERION_META_KEYS.has(k)) continue;
        if (v == null || !String(v).trim()) continue;
        customItems.push({ label: k, expectation: String(v).trim() });
    }
    const drafts = buildRubricDraftsFromCampaignInput(criteria, customItems);
    return buildRubricItemsFromDrafts(drafts, assignRubricId);
}
