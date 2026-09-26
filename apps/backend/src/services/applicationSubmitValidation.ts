import {
    validateApplicationSubmission,
    type FormTemplateSnapshot,
    type SubmissionValidationInput,
} from '../shared/formTemplates/index.js';

export { validateApplicationSubmission };

interface RawUpload {
    mimetype?: string;
    size?: number;
}

const toMeta = (f?: RawUpload) =>
    f ? { mimeType: f.mimetype, size: f.size } : undefined;

export function buildSubmissionInputFromRequest(
    body: Record<string, unknown>,
    files?: {
        cv?: RawUpload;
        photo?: RawUpload;
        certificates?: RawUpload[];
    }
): SubmissionValidationInput {
    const { files: _files, ...bodyForValidation } = body;
    return {
        body: bodyForValidation,
        files: {
            cv: toMeta(files?.cv),
            photo: toMeta(files?.photo),
            certificates: (files?.certificates ?? []).map((f) => ({
                mimeType: f.mimetype,
                size: f.size,
            })),
        },
    };
}

/** الاستمارة قد ترسل languages كـ [{ name, level }] بينما المخطط يخزن string[] */
export function normalizeLanguagesToStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of input) {
        let s = '';
        if (typeof item === 'string') {
            s = item.trim();
        } else if (item && typeof item === 'object' && item !== null && 'name' in item) {
            const name = String((item as { name?: string }).name || '').trim();
            const level = String((item as { level?: string }).level || '').trim();
            if (!name && !level) s = '';
            else if (level) s = `${name} (${level})`;
            else s = name;
        } else {
            s = String(item ?? '').trim();
        }
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

export function mergeValidatedIntoCandidateData(
    normalized: Record<string, unknown>,
    snapshot: FormTemplateSnapshot
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...normalized };
    if ('agreeToTerms' in out) {
        out.agreeToTerms = Boolean(out.agreeToTerms);
    }
    for (const field of snapshot.fields) {
        if (field.type === 'string_array' && Array.isArray(out[field.id])) {
            out[field.id] = (out[field.id] as unknown[]).map(String);
        }
        // The form sends each language as { name, level } and validation keeps
        // the objects, but Candidate.languages is [String]: the public link
        // route saved them as-is and answered 500 to every NEW applicant who
        // added a language (found 2026-09-26). The logged-in route converted
        // them before validation, so both now store "Arabic (native)".
        if (field.type === 'language_array' && Array.isArray(out[field.id])) {
            out[field.id] = normalizeLanguagesToStringArray(out[field.id]);
        }
    }
    return out;
}
