import type { EvaluationRubricItem, RubricDraftItem } from './types.js';
import { PRESET_RUBRIC_KEYS, RUBRIC_EXPECTATION_MAX, RUBRIC_LABEL_MAX } from './types.js';

export function normalizeRubricLabelKey(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function sanitizeRubricText(text: string, maxLen: number): string {
    let s = text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/<[^>]*>/g, '')
        .trim();
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
}

export interface RubricValidationError {
    code: string;
    message: string;
    index?: number;
}

export function validateRubricDraftItem(
    item: RubricDraftItem,
    index: number
): RubricValidationError | null {
    const label = sanitizeRubricText(item.label ?? '', RUBRIC_LABEL_MAX);
    const expectation = sanitizeRubricText(item.expectation ?? '', RUBRIC_EXPECTATION_MAX);

    if (!label) {
        return { code: 'RUBRIC_LABEL_REQUIRED', message: 'Criterion label is required', index };
    }
    if (!expectation) {
        return { code: 'RUBRIC_EXPECTATION_REQUIRED', message: 'Criterion expectation is required', index };
    }
    if (item.type === 'preset') {
        const key = (item.key || '').trim();
        if (!key || !PRESET_RUBRIC_KEYS.has(key)) {
            return { code: 'RUBRIC_INVALID_PRESET_KEY', message: `Invalid preset key: ${key}`, index };
        }
    }
    return null;
}

export function validateRubricDraftList(drafts: RubricDraftItem[]): RubricValidationError[] {
    const errors: RubricValidationError[] = [];
    const seenKeys = new Set<string>();

    drafts.forEach((item, index) => {
        const err = validateRubricDraftItem(item, index);
        if (err) errors.push(err);

        const label = sanitizeRubricText(item.label ?? '', RUBRIC_LABEL_MAX);
        const norm = item.type === 'preset' ? (item.key || '').trim() : normalizeRubricLabelKey(label);
        if (!norm) return;
        const dedupeKey = `${item.type}:${norm}`;
        if (seenKeys.has(dedupeKey)) {
            errors.push({
                code: 'RUBRIC_DUPLICATE',
                message: `Duplicate criterion: ${label}`,
                index,
            });
        }
        seenKeys.add(dedupeKey);
    });

    return errors;
}

/** Server assigns stable ids — pure builder given pre-generated ids. */
export function buildRubricItemsFromDrafts(
    drafts: RubricDraftItem[],
    assignId: (draft: RubricDraftItem, index: number) => string
): EvaluationRubricItem[] {
    return drafts.map((draft, index) => {
        const label = sanitizeRubricText(draft.label, RUBRIC_LABEL_MAX);
        const expectation = sanitizeRubricText(draft.expectation, RUBRIC_EXPECTATION_MAX);
        const key =
            draft.type === 'preset'
                ? (draft.key || '').trim()
                : normalizeRubricLabelKey(label);
        return {
            id: assignId(draft, index),
            type: draft.type,
            key,
            label,
            expectation,
        };
    });
}

export function rubricPayloadForHash(items: EvaluationRubricItem[]): string {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(
        sorted.map((r) => ({
            id: r.id,
            type: r.type,
            key: r.key,
            label: r.label,
            expectation: r.expectation,
        }))
    );
}

/** Build rubric drafts from flat preset criteria object + custom items from UI. */
export function buildRubricDraftsFromCampaignInput(
    flatCriteria: Record<string, unknown>,
    customItems: Array<{ label: string; expectation: string }>
): RubricDraftItem[] {
    const drafts: RubricDraftItem[] = [];
    const skipKeys = new Set([
        'jobAdvertisement',
        'evaluationRubric',
        'formTemplateId',
        'interviewType',
        'templateType',
        'templateName',
        'step',
        'timestamp',
        'aiCompareTop',
        'aiCompareTopEmails',
    ]);

    for (const [key, val] of Object.entries(flatCriteria)) {
        if (skipKeys.has(key)) continue;
        if (val === undefined || val === null) continue;
        const valueStr = typeof val === 'string' ? val.trim() : String(val).trim();
        if (!valueStr) continue;
        if (PRESET_RUBRIC_KEYS.has(key)) {
            drafts.push({
                type: 'preset',
                key,
                label: key,
                expectation: valueStr,
            });
        }
    }

    for (const c of customItems) {
        drafts.push({
            type: 'custom',
            label: c.label,
            expectation: c.expectation,
        });
    }

    return drafts;
}
