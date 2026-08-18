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

export const DEFAULT_FORM_TEMPLATE_ID = 'template-remote';
