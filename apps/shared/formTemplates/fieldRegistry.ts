import type { FormFieldDef } from './types.js';

/** Canonical field definitions for template-remote (matches current Form.jsx). */
export const FORM_FIELD_REGISTRY: Record<string, FormFieldDef> = {
    full_name: {
        id: 'full_name',
        type: 'text',
        required: true,
        labelKey: 'form.full_name',
        sectionId: 'personal',
        validation: { minLength: 2, maxLength: 120 },
    },
    email: {
        id: 'email',
        type: 'email',
        required: true,
        labelKey: 'form.email',
        sectionId: 'personal',
        validation: { maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
    },
    phone: {
        id: 'phone',
        type: 'tel',
        required: true,
        labelKey: 'form.phone',
        sectionId: 'personal',
        validation: { minLength: 7, maxLength: 32 },
    },
    location: {
        id: 'location',
        type: 'text',
        required: false,
        labelKey: 'form.location',
        sectionId: 'personal',
        validation: { maxLength: 120 },
    },
    gender: {
        id: 'gender',
        type: 'select',
        required: false,
        labelKey: 'form.gender',
        sectionId: 'personal',
        validation: { allowedValues: ['male', 'female', ''] },
    },
    photo: {
        id: 'photo',
        type: 'file',
        required: false,
        labelKey: 'form.photo',
        sectionId: 'personal',
        validation: {
            mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            maxBytes: 2 * 1024 * 1024,
        },
    },
    position_applied_for: {
        id: 'position_applied_for',
        type: 'text',
        required: true,
        labelKey: 'form.position_applied_for',
        sectionId: 'professional',
        validation: { minLength: 1, maxLength: 200 },
    },
    company_applied_to: {
        id: 'company_applied_to',
        type: 'text',
        required: false,
        labelKey: 'form.company_applied_to',
        sectionId: 'professional',
        validation: { maxLength: 200 },
    },
    years_of_experience: {
        id: 'years_of_experience',
        type: 'text',
        required: true,
        labelKey: 'form.years_of_experience',
        sectionId: 'professional',
        validation: { minLength: 1, maxLength: 64 },
    },
    current_company: {
        id: 'current_company',
        type: 'text',
        required: false,
        labelKey: 'form.current_company',
        sectionId: 'professional',
        validation: { maxLength: 200 },
    },
    highest_education_level: {
        id: 'highest_education_level',
        type: 'text',
        required: false,
        labelKey: 'form.highest_education_level',
        sectionId: 'professional',
        validation: { maxLength: 120 },
    },
    linkedin: {
        id: 'linkedin',
        type: 'url',
        required: false,
        labelKey: 'form.linkedin',
        sectionId: 'professional',
        validation: { maxLength: 500 },
    },
    skills: {
        id: 'skills',
        type: 'string_array',
        required: true,
        labelKey: 'form.skills',
        sectionId: 'skills',
        validation: { minItems: 3, maxItems: 50 },
    },
    languages: {
        id: 'languages',
        type: 'language_array',
        required: false,
        labelKey: 'form.languages',
        sectionId: 'skills',
        validation: { maxItems: 20 },
    },
    certifications: {
        id: 'certifications',
        type: 'text',
        required: false,
        labelKey: 'form.certifications',
        sectionId: 'skills',
        validation: { maxLength: 2000 },
    },
    availability: {
        id: 'availability',
        type: 'text',
        required: false,
        labelKey: 'form.availability',
        sectionId: 'additional',
        validation: { maxLength: 120 },
    },
    expectedSalary: {
        id: 'expectedSalary',
        type: 'text',
        required: false,
        labelKey: 'form.expectedSalary',
        sectionId: 'additional',
        validation: { maxLength: 64 },
    },
    salaryCurrency: {
        id: 'salaryCurrency',
        type: 'select',
        required: false,
        labelKey: 'form.salaryCurrency',
        sectionId: 'additional',
        validation: { allowedValues: ['USD', 'IQD', ''] },
    },
    coverLetter: {
        id: 'coverLetter',
        type: 'textarea',
        required: false,
        labelKey: 'form.coverLetter',
        sectionId: 'additional',
        validation: { maxLength: 10000 },
    },
    hearAboutUs: {
        id: 'hearAboutUs',
        type: 'text',
        required: false,
        labelKey: 'form.hearAboutUs',
        sectionId: 'additional',
        validation: { maxLength: 200 },
    },
    agreeToTerms: {
        id: 'agreeToTerms',
        type: 'boolean',
        required: true,
        labelKey: 'form.agreeToTerms',
        sectionId: 'additional',
    },
    cv: {
        id: 'cv',
        type: 'file',
        required: true,
        labelKey: 'form.cv',
        sectionId: 'files',
        validation: {
            mimeTypes: ['application/pdf'],
            maxBytes: 5 * 1024 * 1024,
        },
    },
};

export function getFieldDef(fieldId: string): FormFieldDef | undefined {
    return FORM_FIELD_REGISTRY[fieldId];
}

export function resolveFieldDefs(fieldIds: string[]): FormFieldDef[] {
    const out: FormFieldDef[] = [];
    for (const id of fieldIds) {
        const def = FORM_FIELD_REGISTRY[id];
        if (!def) {
            throw new Error(`UNKNOWN_FORM_FIELD:${id}`);
        }
        out.push({ ...def });
    }
    return out;
}
