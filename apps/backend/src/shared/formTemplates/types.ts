/** Pure types — no React, no Node-specific imports except where noted in helpers. */

export type FormFieldType =
    | 'text'
    | 'email'
    | 'tel'
    | 'url'
    | 'textarea'
    | 'select'
    | 'boolean'
    | 'string_array'
    | 'language_array'
    | 'file';

export interface FormFieldValidation {
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
    pattern?: string;
    mimeTypes?: string[];
    maxBytes?: number;
    allowedValues?: string[];
}

export interface FormFieldDef {
    id: string;
    type: FormFieldType;
    required: boolean;
    labelKey: string;
    sectionId: string;
    /** `file` fields only: accept several uploads under the same field name. */
    multiple?: boolean;
    validation?: FormFieldValidation;
}

export interface FormSectionDef {
    id: string;
    titleKey: string;
    fieldIds: string[];
}

export interface FormTemplateSnapshot {
    sections: FormSectionDef[];
    fields: FormFieldDef[];
}

export interface FormTemplateRegistryEntry {
    id: string;
    nameKey: string;
    descriptionKey: string;
    version: number;
    schemaVersion: number;
    sections: FormSectionDef[];
    fieldIds: string[];
}

export interface CampaignFormBinding {
    templateId: string;
    templateVersion: number;
    schemaVersion: number;
    schemaHash: string;
    snapshot: FormTemplateSnapshot;
}

export type RubricItemType = 'preset' | 'custom';

export interface EvaluationRubricItem {
    id: string;
    type: RubricItemType;
    key: string;
    label: string;
    expectation: string;
    /**
     * A must-have. A real recruiter screens in two passes — drop whoever misses
     * the essentials, then rank the rest — and until this flag existed the scorer
     * had only the second pass, so a candidate who failed the role outright could
     * still reach "Hire" on the strength of everything else. The Stage 1 scorer
     * caps the recommendation when an essential criterion is not confirmed.
     * Absent means false, so every campaign created before the flag keeps its
     * exact behaviour and its exact snapshot hash.
     */
    essential?: boolean;
}

export type RubricResultValue =
    | 'meets'
    | 'partially_meets'
    | 'does_not_meet'
    | 'insufficient_evidence';

export interface RubricResultItem {
    rubricItemId: string;
    result: RubricResultValue;
    evidence: string[];
    confidence: 'low' | 'medium' | 'high';
}

export interface CandidateEvaluationContext {
    formSchemaVersion: number;
    formSchemaHash: string;
    rubricVersion: number;
    rubricSnapshotHash: string;
    evaluationLanguage?: 'ar' | 'en';
}

export interface RubricDraftItem {
    type: RubricItemType;
    key?: string;
    label: string;
    expectation: string;
    essential?: boolean;
}

export const RUBRIC_LABEL_MAX = 80;
export const RUBRIC_EXPECTATION_MAX = 500;

export const PRESET_RUBRIC_KEYS = new Set([
    'position',
    'location',
    'job',
    'age',
    'gender',
    'educationLevel',
    'experienceYears',
    'salaryMin',
    'salaryMax',
    'salaryCurrency',
    'availability',
    'skills',
    'languages',
    'certifications',
    'industryType',
]);

/**
 * Criteria removed from Stage 1. A job that still carries one keeps the value in
 * `criteria`, but it is never scored, never sent to the evaluator, and never
 * stored on a new job.
 *
 * `company` ("candidates from a specific company") was read as "the hiring
 * company": 3 of 71 production jobs used it (2026-10-03), and two of them held
 * the employer's own name. So the evaluator marked every applicant "missing: no
 * mention of <the employer>". It had zero weight, so no score moved, but the
 * report showed a false unmet criterion.
 *
 * ⚠️ Removing a key from PRESET_RUBRIC_KEYS alone is NOT enough.
 * `deriveLegacyRubricFromCriteria` turns any non-preset key into a CUSTOM criterion,
 * and custom criteria score at the default weight (8). Every derivation must skip
 * these keys explicitly.
 */
export const RETIRED_CRITERION_KEYS = new Set(['company']);

/**
 * Keys that live in a campaign's `criteria` but are NOT hiring criteria: job
 * catalog resolution, and the report language.
 *
 * Each has a real job — `resolveEvaluationLanguage` reads
 * `criteria.evaluationLanguage` and sends it as its own top-level payload field,
 * and the roleKey/labelKey pair resolves the job catalog entry. None of them is
 * something a candidate can "meet", so deriving a rubric must not turn them into
 * criteria the scorer is asked to judge ("does this candidate meet `ar`?").
 *
 * Removing them from the rubric does NOT remove the values: they stay in
 * `criteria`, and every consumer that actually needs them reads them from there.
 */
export const NON_CRITERION_META_KEYS = new Set([
    'roleKey',
    'labelKey',
    'roleMatchSource',
    'evaluationLanguage',
]);

/** Fields always allowed on submit but not part of form schema UI. */
export const SUBMIT_META_FIELDS = new Set([
    'campaignId',
    'website',
    'headHunterContextId',
    'sourceType',
    'entryStage',
    'evaluationLanguage',
    // Evaalo Job Catalog resolution (optional metadata from position combobox)
    'roleKey',
    'careerLevel',
    'managementTrack',
    'labelKey',
    'roleMatchSource',
    // Display title duplicate of position_applied_for + research-domain pick,
    // both injected by the position combobox — not part of any form schema.
    'position',
    'researchDomain',
]);

/** File upload field names mapped to snapshot field ids. */
export const FILE_FIELD_MAP: Record<string, string> = {
    cv: 'cv',
    photo: 'photo',
    certificates: 'certificates',
};

/** Upload cap for the multi-file certificates field (also the multer maxCount).
 * Generous cap so applicants are effectively unlimited in practice; kept finite
 * because multer's maxCount must be a number and to guard against upload abuse.
 * MUST stay in sync with the frontend `CERTIFICATES_MAX_FILES` in
 * apps/frontend/src/constants/certificateUpload.js. */
export const CERTIFICATES_MAX_FILES = 20;

/**
 * CV file types the platform can actually read, and therefore accepts.
 *
 * The single source of truth for the CV upload: `fieldRegistry.cv` publishes it to
 * new form snapshots, and `validateSingleFile` applies it to the `cv` field even
 * when an OLDER snapshot names a narrower list — see the note there.
 *
 * It is bounded by what `cvTextExtractor` can parse (pdf-parse for PDF, mammoth
 * for DOCX, plain read for TXT). Widening this list without teaching the extractor
 * the format means the file uploads and then yields no text.
 *
 * MUST stay in sync with the frontend rule in apps/frontend/src/utils/cvFileTypes.js,
 * which BOTH application forms use. `npm run test:cv-file-types` loads that file and
 * fails if the two disagree on a single case.
 */
export const CV_FILE_TYPES = [
    // `mimeKeyword` keeps the long-standing tolerance for vendor aliases such as
    // application/x-pdf: a type that CONTAINS the keyword is that type.
    { extension: 'pdf', mimeType: 'application/pdf', mimeKeyword: 'pdf' },
    {
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        mimeKeyword: 'vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    { extension: 'txt', mimeType: 'text/plain', mimeKeyword: 'plain' },
] as const;

export const CV_ACCEPTED_MIME_TYPES: string[] = CV_FILE_TYPES.map((t) => t.mimeType);

/**
 * Types that say nothing about the file. Phones and some browsers send a Word CV
 * as application/octet-stream, and a real PDF can arrive with no type at all —
 * for these, and only these, the extension decides.
 */
const GENERIC_UPLOAD_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function cvFileExtension(fileName?: string): string {
    const name = String(fileName ?? '').trim().toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
}

/**
 * Which CV type an upload is — 'pdf' | 'docx' | 'txt' — or null when the platform
 * cannot read it. The one rule for every CV upload (S45, 2026-09-27): the legacy
 * form promised Word and refused it, because each form kept its own list.
 */
export function classifyCvUpload(mimeType?: string, fileName?: string): 'pdf' | 'docx' | 'txt' | null {
    const mime = String(mimeType ?? '').trim().toLowerCase();
    const ext = cvFileExtension(fileName);
    const byExtension = CV_FILE_TYPES.find((t) => t.extension === ext)?.extension ?? null;
    if (GENERIC_UPLOAD_MIME_TYPES.has(mime)) return byExtension;
    const byType = CV_FILE_TYPES.find((t) => mime === t.mimeType || mime.includes(t.mimeKeyword))?.extension ?? null;
    // "text/plain" is also what a multipart parser assumes when a part carries no
    // type at all, so it does not overrule a file that names itself as another CV
    // format: a cv.pdf or cv.docx labelled text/plain is read as PDF / Word, not as
    // text (which would hand the evaluator binary noise).
    if (byType === 'txt' && byExtension && byExtension !== 'txt') return byExtension;
    return byType;
}

/**
 * The type to STORE for an accepted CV: always the canonical one for what it is,
 * so everything downstream (the extractor, the n8n file part, the recruiter's
 * download) sees one name per format — not octet-stream, not an alias such as
 * application/x-pdf that the extractor would not recognise without an extension.
 * A file that is not an accepted CV is kept exactly as received.
 */
export function storedCvMimeType(mimeType?: string, fileName?: string): string {
    const kind = classifyCvUpload(mimeType, fileName);
    return CV_FILE_TYPES.find((t) => t.extension === kind)?.mimeType ?? mimeType ?? '';
}

export const DEFAULT_FORM_TEMPLATE_ID = 'template-remote';
