function asTrimmedString(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
}

function parseJsonArray(raw) {
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

function validateStringField(field, raw) {
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
            /* ignore */
        }
    }
    if (v?.allowedValues?.length && !v.allowedValues.includes(s)) {
        return `${field.id} has invalid value`;
    }
    return null;
}

function validateStringArrayField(field, raw) {
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

function validateLanguageArrayField(field, raw) {
    const arr = parseJsonArray(raw);
    if (!arr) {
        if (field.required) return `${field.id} must be a valid array`;
        return null;
    }
    const items = arr.filter(
        (x) => x && typeof x === 'object' && asTrimmedString(x.name) && asTrimmedString(x.level)
    );
    if (field.required && items.length === 0) return `${field.id} is required`;
    const max = field.validation?.maxItems;
    if (max != null && items.length > max) {
        return `${field.id} exceeds maximum items`;
    }
    return null;
}

function validateBooleanField(field, raw) {
    const truthy = raw === true || raw === 'true' || raw === '1' || raw === 1;
    if (field.required && !truthy) return `${field.id} must be accepted`;
    return null;
}

function validateFileField(field, file) {
    if (!file) {
        if (field.required) return `${field.id} is required`;
        return null;
    }
    const mime = (file.type || '').toLowerCase();
    const allowed = field.validation?.mimeTypes?.map((m) => m.toLowerCase()) ?? [];
    if (allowed.length && mime) {
        const ok = allowed.some((m) => mime === m || mime.includes(m.split('/')[1] || m));
        if (!ok) return `${field.id} must be an allowed file type`;
    }
    const maxBytes = field.validation?.maxBytes;
    if (maxBytes != null && file.size > maxBytes) {
        return `${field.id} exceeds maximum file size`;
    }
    return null;
}

export function validateDynamicField(field, value, file) {
    switch (field.type) {
        case 'string_array':
            return validateStringArrayField(field, value);
        case 'language_array':
            return validateLanguageArrayField(field, value);
        case 'boolean':
            return validateBooleanField(field, value);
        case 'file':
            return validateFileField(field, file);
        case 'textarea':
        case 'text':
        case 'email':
        case 'tel':
        case 'url':
        case 'select':
            return validateStringField(field, value);
        default:
            return validateStringField(field, value);
    }
}

export function validateDynamicSection(fields, formValues, filesByFieldId) {
    const errors = {};
    for (const field of fields) {
        const msg = validateDynamicField(
            field,
            formValues[field.id],
            filesByFieldId[field.id]
        );
        if (msg) errors[field.id] = msg;
    }
    return errors;
}

export function buildInitialFormValues(fields) {
    const values = {};
    for (const field of fields) {
        if (field.type === 'boolean') {
            values[field.id] = false;
        } else if (field.type === 'string_array' || field.type === 'language_array') {
            values[field.id] = [];
        } else if (field.id === 'salaryCurrency') {
            values[field.id] = 'USD';
        } else if (field.type !== 'file') {
            values[field.id] = '';
        }
    }
    return values;
}

export function fieldsForSection(formConfig, sectionId) {
    const fieldMap = new Map((formConfig.fields || []).map((f) => [f.id, f]));
    const section = (formConfig.sections || []).find((s) => s.id === sectionId);
    if (!section) return [];
    return section.fieldIds.map((id) => fieldMap.get(id)).filter(Boolean);
}
