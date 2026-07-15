import type { FormTemplateRegistryEntry } from './types.js';
import { DEFAULT_FORM_TEMPLATE_ID } from './types.js';

/** template-remote — full application form (current Form.jsx parity). */
export const TEMPLATE_REMOTE: FormTemplateRegistryEntry = {
    id: DEFAULT_FORM_TEMPLATE_ID,
    nameKey: 'interviewTemplates_standardName',
    descriptionKey: 'interviewTemplates_standardDesc',
    version: 1,
    schemaVersion: 1,
    sections: [
        {
            id: 'personal',
            titleKey: 'form.section.personal',
            fieldIds: ['full_name', 'email', 'phone', 'location', 'gender', 'photo'],
        },
        {
            id: 'professional',
            titleKey: 'form.section.professional',
            fieldIds: [
                'position_applied_for',
                'company_applied_to',
                'years_of_experience',
                'current_company',
                'highest_education_level',
                'linkedin',
            ],
        },
        {
            id: 'skills',
            titleKey: 'form.section.skills',
            fieldIds: ['skills', 'languages', 'certifications'],
        },
        {
            id: 'additional',
            titleKey: 'form.section.additional',
            fieldIds: ['availability', 'expectedSalary', 'salaryCurrency', 'coverLetter', 'hearAboutUs', 'agreeToTerms'],
        },
        {
            id: 'files',
            titleKey: 'form.section.files',
            fieldIds: ['cv'],
        },
    ],
    fieldIds: [
        'full_name',
        'email',
        'phone',
        'location',
        'gender',
        'photo',
        'position_applied_for',
        'company_applied_to',
        'years_of_experience',
        'current_company',
        'highest_education_level',
        'linkedin',
        'skills',
        'languages',
        'certifications',
        'availability',
        'expectedSalary',
        'salaryCurrency',
        'coverLetter',
        'hearAboutUs',
        'agreeToTerms',
        'cv',
    ],
};

export const FORM_TEMPLATE_REGISTRY: Record<string, FormTemplateRegistryEntry> = {
    [DEFAULT_FORM_TEMPLATE_ID]: TEMPLATE_REMOTE,
};

export function resolveFormTemplate(templateId: string): FormTemplateRegistryEntry {
    const tpl = FORM_TEMPLATE_REGISTRY[templateId];
    if (!tpl) {
        throw new Error(`UNKNOWN_FORM_TEMPLATE:${templateId}`);
    }
    return tpl;
}
