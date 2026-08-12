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
    }
    return out;
}
