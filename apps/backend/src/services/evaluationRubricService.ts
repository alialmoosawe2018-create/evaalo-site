import { randomBytes } from 'crypto';
import {
    PRESET_RUBRIC_KEYS,
    buildRubricDraftsFromCampaignInput,
    buildRubricItemsFromDrafts,
    sanitizeRubricText,
    validateRubricDraftList,
    type EvaluationRubricItem,
    type RubricDraftItem,
    RUBRIC_EXPECTATION_MAX,
    RUBRIC_LABEL_MAX,
} from '../shared/formTemplates/index.js';
import { hashRubric } from './formTemplateService.js';

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

export function parseCustomRubricInput(raw: unknown): Array<{ label: string; expectation: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ label: string; expectation: string }> = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const label = sanitizeRubricText(String(o.label ?? ''), RUBRIC_LABEL_MAX);
        const expectation = sanitizeRubricText(String(o.expectation ?? o.value ?? ''), RUBRIC_EXPECTATION_MAX);
        if (label && expectation) out.push({ label, expectation });
    }
    return out;
}

export function buildEvaluationRubricFromCampaignBody(body: Record<string, unknown>): {
    items: EvaluationRubricItem[];
    rubricSnapshotHash: string;
    rubricVersion: number;
} {
    const customRaw = body.customRubricItems ?? body.customCriteria;
    const customItems = parseCustomRubricInput(customRaw);

    const flatForPresets = { ...body };
    delete flatForPresets.customRubricItems;
    delete flatForPresets.customCriteria;
    delete flatForPresets.evaluationRubric;
    delete flatForPresets.formTemplateId;

    const drafts = buildRubricDraftsFromCampaignInput(flatForPresets, customItems);
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
        rubricSnapshotHash: hashRubric(items),
        rubricVersion: 1,
    };
}

export function stripRubricAndTemplateKeysFromCriteria(body: Record<string, unknown>): Record<string, unknown> {
    const criteria = { ...body };
    const remove = [
        'evaluationRubric',
        'customRubricItems',
        'customCriteria',
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
        if (v == null || !String(v).trim()) continue;
        customItems.push({ label: k, expectation: String(v).trim() });
    }
    const drafts = buildRubricDraftsFromCampaignInput(criteria, customItems);
    return buildRubricItemsFromDrafts(drafts, assignRubricId);
}
