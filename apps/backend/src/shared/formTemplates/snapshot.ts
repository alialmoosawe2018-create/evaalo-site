import type { CampaignFormBinding, FormTemplateSnapshot } from './types.js';
import { resolveFieldDefs } from './fieldRegistry.js';
import { resolveFormTemplate } from './templates.js';

export function buildFullSnapshot(templateId: string): FormTemplateSnapshot {
    const tpl = resolveFormTemplate(templateId);
    const fieldIdSet = new Set<string>();
    for (const section of tpl.sections) {
        for (const fid of section.fieldIds) {
            fieldIdSet.add(fid);
        }
    }
    for (const fid of tpl.fieldIds) {
        fieldIdSet.add(fid);
    }
    const fields = resolveFieldDefs([...fieldIdSet]);
    return {
        sections: tpl.sections.map((s) => ({
            id: s.id,
            titleKey: s.titleKey,
            fieldIds: [...s.fieldIds],
        })),
        fields,
    };
}

export function buildFormBinding(templateId: string, schemaHash: string): CampaignFormBinding {
    const tpl = resolveFormTemplate(templateId);
    const snapshot = buildFullSnapshot(templateId);
    return {
        templateId: tpl.id,
        templateVersion: tpl.version,
        schemaVersion: tpl.schemaVersion,
        schemaHash,
        snapshot,
    };
}

/** Deterministic JSON for hashing — keys sorted recursively. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
}

export function snapshotPayloadForHash(snapshot: FormTemplateSnapshot): string {
    return stableStringify({
        sections: snapshot.sections,
        fields: snapshot.fields.map((f) => ({
            id: f.id,
            type: f.type,
            required: f.required,
            validation: f.validation ?? null,
        })),
    });
}

export function getAllowedFieldIds(snapshot: FormTemplateSnapshot): Set<string> {
    return new Set(snapshot.fields.map((f) => f.id));
}
