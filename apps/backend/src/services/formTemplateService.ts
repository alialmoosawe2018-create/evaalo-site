import { createHash, randomBytes } from 'crypto';
import {
    buildFormBinding as buildBinding,
    buildFullSnapshot,
    DEFAULT_FORM_TEMPLATE_ID,
    resolveFormTemplate,
    rubricPayloadForHash,
    snapshotPayloadForHash,
    type CampaignFormBinding,
    type EvaluationRubricItem,
    type FormTemplateSnapshot,
} from '../shared/formTemplates/index.js';

export function hashSnapshot(snapshot: FormTemplateSnapshot): string {
    const payload = snapshotPayloadForHash(snapshot);
    return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function hashRubric(items: EvaluationRubricItem[]): string {
    const payload = rubricPayloadForHash(items);
    return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function createFormBindingForTemplate(templateId?: string): CampaignFormBinding {
    const id = (templateId || DEFAULT_FORM_TEMPLATE_ID).trim();
    resolveFormTemplate(id);
    const snapshot = buildFullSnapshot(id);
    const schemaHash = hashSnapshot(snapshot);
    return buildBinding(id, schemaHash);
}

export function resolveLegacyFormBinding(): CampaignFormBinding {
    return createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
}

export function mintPublicApplicationToken(): string {
    return `pub_${randomBytes(24).toString('base64url')}`;
}

export function getPositionTitleFromCriteria(criteria: Record<string, unknown>): string {
    const position =
        (typeof criteria.position === 'string' && criteria.position.trim()) ||
        (typeof criteria.job === 'string' && criteria.job.trim()) ||
        '';
    return position || 'Open Position';
}

export function toPublicFormConfig(binding: CampaignFormBinding) {
    return {
        templateId: binding.templateId,
        schemaVersion: binding.schemaVersion,
        sections: binding.snapshot.sections,
        fields: binding.snapshot.fields.map((f) => ({
            id: f.id,
            type: f.type,
            required: f.required,
            labelKey: f.labelKey,
            sectionId: f.sectionId,
            validation: f.validation ?? undefined,
        })),
    };
}
