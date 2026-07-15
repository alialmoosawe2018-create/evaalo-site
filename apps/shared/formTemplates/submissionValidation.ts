import type { FormFieldDef, FormTemplateSnapshot } from './types.js';
import { SUBMIT_META_FIELDS } from './types.js';
import { getAllowedFieldIds } from './snapshot.js';

export interface FileUploadMeta {
    mimeType?: string;
    size?: number;
}

export interface SubmissionValidationInput {
    body: Record<string, unknown>;
    files?: Record<string, FileUploadMeta | undefined>;
}

export interface SubmissionValidationResult {
    ok: boolean;
    errors: Array<{ field: string; message: string }>;
    normalized: Record<string, unknown>;
    submittedFieldIds: string[];
}

function parseJsonArray(raw: unknown): unknown[] | null {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function asTrimmedString(v: unknown): string {
    if (v === undefined || v === null) return '';
    return String(v).trim();
}

function validateStringField(field: FormFieldDef, raw: unknown): string | null {
    const s = asTrimmedString(raw);
    if (!s) {
        if (field.required) return `${field.id} is required`;
        return null;
    }
    const v = field.validation;
    if (v?.minLength != null && s.length < v.minLength) {
        return `${field.id} must be at least ${v.minLength} characters`;
    }
    if (v?.maxLength != null && s.length > v.maxLength) {
        return `${field.id} exceeds maximum length`;
    }
    if (v?.pattern) {
        try {
            if (!new RegExp(v.pattern).test(s)) return `${field.id} has invalid format`;
        } catch {
            /* ignore bad pattern */
        }
    }
    if (v?.allowedValues && v.allowedValues.length > 0 && !v.allowedValues.includes(s)) {
        return `${field.id} has invalid value`;
    }
    return null;
}

function validateStringArrayField(field: FormFieldDef, raw: unknown): string | null {
    const arr = parseJsonArray(raw);
    if (!arr) {
        if (field.required) return `${field.id} must be a valid array`;
        return null;
    }
    const items = arr.map((x) => asTrimmedString(x)).filter(Boolean);
    if (field.required && items.length === 0) return `${field.id} is required`;
    const min = field.validation?.minItems;
    const max = field.validation?.maxItems;
    if (min != null && items.length < min) {
        return `${field.id} requires at least ${min} items`;
    }
    if (max != null && items.length > max) {
        return `${field.id} exceeds maximum items`;
    }
    return null;
}

function validateBooleanField(field: FormFieldDef, raw: unknown): string | null {
    const truthy =
        raw === true ||
        raw === 'true' ||
        raw === '1' ||
        raw === 1;
    if (field.required && !truthy) return `${field.id} must be accepted`;
    return null;
}

function validateFileField(
    field: FormFieldDef,
    fileMeta: FileUploadMeta | undefined
): string | null {
    if (!fileMeta) {
        if (field.required) return `${field.id} is required`;
        return null;
    }
    const mime = (fileMeta.mimeType || '').toLowerCase();
    const allowed = field.validation?.mimeTypes?.map((m) => m.toLowerCase()) ?? [];
    if (allowed.length && mime && !allowed.some((m) => mime.includes(m.replace('application/', '')) || mime === m)) {
        if (!allowed.includes(mime)) {
            const ok = allowed.some((m) => mime.includes(m.split('/')[1] || m));
            if (!ok) return `${field.id} must be one of: ${allowed.join(', ')}`;
        }
    }
    const maxBytes = field.validation?.maxBytes;
    if (maxBytes != null && fileMeta.size != null && fileMeta.size > maxBytes) {
        return `${field.id} exceeds maximum file size`;
    }
    return null;
}

export function validateApplicationSubmission(
    snapshot: FormTemplateSnapshot,
    input: SubmissionValidationInput
): SubmissionValidationResult {
    const errors: Array<{ field: string; message: string }> = [];
    const allowed = getAllowedFieldIds(snapshot);
    const fieldById = new Map(snapshot.fields.map((f) => [f.id, f]));
    const normalized: Record<string, unknown> = {};
    const submittedFieldIds: string[] = [];

    for (const key of Object.keys(input.body)) {
        if (SUBMIT_META_FIELDS.has(key)) continue;
        if (!allowed.has(key)) {
            errors.push({ field: key, message: `Unexpected field: ${key}` });
        }
    }

    for (const field of snapshot.fields) {
        if (field.type === 'file') {
            const fileKey = field.id === 'cv' ? 'cv' : field.id;
            const meta = input.files?.[fileKey];
            const err = validateFileField(field, meta);
            if (err) errors.push({ field: field.id, message: err });
            else if (meta) {
                submittedFieldIds.push(field.id);
                normalized[field.id] = fileKey;
            }
            continue;
        }

        const raw = input.body[field.id];
        const hasValue =
            raw !== undefined &&
            raw !== null &&
            !(typeof raw === 'string' && raw.trim() === '');

        if (field.type === 'boolean') {
            const err = validateBooleanField(field, raw);
            if (err) errors.push({ field: field.id, message: err });
            else if (hasValue || field.required) {
                submittedFieldIds.push(field.id);
                normalized[field.id] =
                    raw === true || raw === 'true' || raw === '1' || raw === 1;
            }
            continue;
        }

        if (field.type === 'string_array' || field.type === 'language_array') {
            const err = validateStringArrayField(field, raw);
            if (err) errors.push({ field: field.id, message: err });
            else {
                const arr = parseJsonArray(raw) ?? [];
                const items = arr.map((x) => asTrimmedString(x)).filter(Boolean);
                if (items.length > 0 || field.required) {
                    submittedFieldIds.push(field.id);
                    normalized[field.id] = field.type === 'language_array' ? arr : items;
                }
            }
            continue;
        }

        const err = validateStringField(field, raw);
        if (err) errors.push({ field: field.id, message: err });
        else if (hasValue || field.required) {
            submittedFieldIds.push(field.id);
            normalized[field.id] = asTrimmedString(raw);
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        normalized,
        submittedFieldIds,
    };
}
