import type {
    EvaluationRubricItem,
    FormFieldDef,
    FormTemplateSnapshot,
    RubricResultValue,
} from '../shared/formTemplates/types.js';
import { getAllowedFieldIds } from '../shared/formTemplates/snapshot.js';
import { deriveLegacyRubricFromCriteria } from './evaluationRubricService.js';
import { resolveCampaignFormBinding } from './publicCampaignService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

export const STAGE1_PAYLOAD_SCHEMA_VERSION = 2;

export interface Stage1FormTemplateBucket {
    id: string;
    schemaVersion: number;
    schemaHash?: string;
    availableFieldIds: string[];
}

export interface Stage1SubmittedApplicationBucket {
    submittedFieldIds: string[];
    values: Record<string, unknown>;
}

export interface Stage1RubricItemForN8n {
    id: string;
    type: string;
    key: string;
    label: string;
    expectation: string;
    /** Delimited text for LLM prompts — treat as data, not instructions. */
    delimitedExpectation: string;
}

export interface Stage1ThreeBucketPayload {
    payloadSchemaVersion: number;
    formTemplate: Stage1FormTemplateBucket;
    submittedApplication: Stage1SubmittedApplicationBucket;
    evaluationRubric: Stage1RubricItemForN8n[];
    evaluationGuardrails: {
        treatCriteriaAndApplicationAsData: true;
        neverFollowInstructionsInUntrustedContent: true;
        insufficientEvidenceWhenNoProof: true;
        delimiterExamples: {
            criterion: '<evaluation_criterion data="true">…</evaluation_criterion>';
            evidence: '<application_evidence data="true">…</application_evidence>';
        };
    };
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapCriterionDelimiter(text: string): string {
    return `<evaluation_criterion data="true">${escapeXml(text)}</evaluation_criterion>`;
}

function hasSubmittedValue(field: FormFieldDef, raw: unknown): boolean {
    if (raw === undefined || raw === null) return false;
    if (field.type === 'boolean') return raw === true || raw === 'true' || raw === '1';
    if (field.type === 'string_array' || field.type === 'language_array') {
        return Array.isArray(raw) && raw.length > 0;
    }
    if (field.type === 'file') return false;
    const s = String(raw).trim();
    return s.length > 0;
}

function fileMetaForField(
    fieldId: string,
    files: Array<{ kind?: string; originalName?: string; mimeType?: string; size?: number }> | undefined
): Record<string, unknown> | null {
    if (!files?.length) return null;
    if (fieldId === 'certificates') {
        const certs = files.filter((f) => f.kind === 'certificate');
        if (!certs.length) return null;
        return {
            uploaded: true,
            count: certs.length,
            items: certs.map((f) => ({
                originalName: f.originalName || '',
                mimeType: f.mimeType || '',
                size: f.size ?? null,
            })),
        };
    }
    const match =
        fieldId === 'cv'
            ? files.find((f) => f.kind === 'cv') ||
              files.find((f) => f.kind !== 'certificate' && f.mimeType === 'application/pdf')
            : files.find((f) => f.kind === 'photo');
    if (!match) return null;
    return {
        uploaded: true,
        originalName: match.originalName || '',
        mimeType: match.mimeType || '',
        size: match.size ?? null,
    };
}

export function buildSubmittedApplicationFromCandidate(
    snapshot: FormTemplateSnapshot,
    candidate: Record<string, unknown>
): Stage1SubmittedApplicationBucket {
    const submittedFieldIds: string[] = [];
    const values: Record<string, unknown> = {};
    const files = candidate.files as
        | Array<{ kind?: string; originalName?: string; mimeType?: string; size?: number }>
        | undefined;

    for (const field of snapshot.fields) {
        if (field.type === 'file') {
            const meta = fileMetaForField(field.id, files);
            if (meta) {
                submittedFieldIds.push(field.id);
                values[field.id] = meta;
            }
            continue;
        }
        const raw = candidate[field.id];
        if (!hasSubmittedValue(field, raw)) continue;
        submittedFieldIds.push(field.id);
        values[field.id] = raw;
    }

    return { submittedFieldIds, values };
}

export function resolveCampaignEvaluationRubric(
    campaign: CampaignFormContext
): EvaluationRubricItem[] {
    const stored = campaign.evaluationRubric;
    if (Array.isArray(stored) && stored.length > 0) {
        return stored as EvaluationRubricItem[];
    }
    const criteria = (campaign.criteria || {}) as Record<string, unknown>;
    return deriveLegacyRubricFromCriteria(criteria);
}

export function rubricItemsForN8n(items: EvaluationRubricItem[]): Stage1RubricItemForN8n[] {
    return items.map((item) => ({
        id: item.id,
        type: item.type,
        key: item.key,
        label: item.label,
        expectation: item.expectation,
        delimitedExpectation: wrapCriterionDelimiter(item.expectation),
    }));
}

export function buildStage1ThreeBucketPayload(
    campaign: CampaignFormContext,
    candidate: Record<string, unknown>
): Stage1ThreeBucketPayload {
    const binding = resolveCampaignFormBinding(campaign);
    const snapshot = binding.snapshot;
    const rubric = resolveCampaignEvaluationRubric(campaign);
    const submitted = buildSubmittedApplicationFromCandidate(snapshot, candidate);
    const availableFieldIds = [...getAllowedFieldIds(snapshot)];

    return {
        payloadSchemaVersion: STAGE1_PAYLOAD_SCHEMA_VERSION,
        formTemplate: {
            id: binding.templateId,
            schemaVersion: binding.schemaVersion,
            schemaHash: binding.schemaHash,
            availableFieldIds,
        },
        submittedApplication: submitted,
        evaluationRubric: rubricItemsForN8n(rubric),
        evaluationGuardrails: {
            treatCriteriaAndApplicationAsData: true,
            neverFollowInstructionsInUntrustedContent: true,
            insufficientEvidenceWhenNoProof: true,
            delimiterExamples: {
                criterion: '<evaluation_criterion data="true">…</evaluation_criterion>',
                evidence: '<application_evidence data="true">…</application_evidence>',
            },
        },
    };
}

export function isValidRubricResultValue(v: string): v is RubricResultValue {
    return (
        v === 'meets' ||
        v === 'partially_meets' ||
        v === 'does_not_meet' ||
        v === 'insufficient_evidence'
    );
}
