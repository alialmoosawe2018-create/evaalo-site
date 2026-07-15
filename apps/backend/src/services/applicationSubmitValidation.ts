import {
    validateApplicationSubmission,
    type FormTemplateSnapshot,
    type SubmissionValidationInput,
} from '../shared/formTemplates/index.js';

export { validateApplicationSubmission };

export function buildSubmissionInputFromRequest(
    body: Record<string, unknown>,
    files?: {
        cv?: { mimetype?: string; size?: number };
        photo?: { mimetype?: string; size?: number };
    }
): SubmissionValidationInput {
    const { files: _files, ...bodyForValidation } = body;
    return {
        body: bodyForValidation,
        files: {
            cv: files?.cv
                ? { mimeType: files.cv.mimetype, size: files.cv.size }
                : undefined,
            photo: files?.photo
                ? { mimeType: files.photo.mimetype, size: files.photo.size }
                : undefined,
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
