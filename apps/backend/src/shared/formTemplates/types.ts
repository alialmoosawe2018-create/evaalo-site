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
    'company',
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
 * MUST stay in sync with the frontend `accept` for the cv field in
 * apps/frontend/src/components/form/DynamicApplicationForm.jsx.
 */
export const CV_ACCEPTED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
];

export const DEFAULT_FORM_TEMPLATE_ID = 'template-remote';
