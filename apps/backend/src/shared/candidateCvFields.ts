/**
 * Single source of truth for the candidate fields we extract from an uploaded CV.
 *
 * Mirrors the frontend `AVAILABLE_CRITERIA_AUDIO` ids (snake_case) but adds a
 * `description` used to build the LLM extraction prompt dynamically — so adding a
 * new field here is enough; no prompt rewrite required.
 *
 * Keep `id` values in sync with:
 *   apps/frontend/src/constants/audioJobCriteria.js
 */

export type CvFieldType = 'text' | 'email' | 'tel';

export interface CvField {
    /** snake_case key returned to the client and mapped onto jobDetails. */
    id: string;
    /** Human label (English) — for logs/debugging only. */
    label: string;
    /** Extraction hint given to the LLM so it knows exactly what to pull. */
    description: string;
    type: CvFieldType;
}

export const CANDIDATE_CV_FIELDS: readonly CvField[] = [
    {
        id: 'full_name',
        label: 'Full name',
        description:
            "The candidate's full name. If the CV is in Arabic, transliterate the name into English (Latin letters).",
        type: 'text',
    },
    {
        id: 'position_applied_for',
        label: 'Position applied for',
        description:
            'The job title/role the candidate is targeting or most recently held, e.g. "Software Engineer".',
        type: 'text',
    },
    {
        id: 'job_level',
        label: 'Job level',
        description:
            'Seniority level such as Junior, Mid, Senior, Lead, or Manager. Infer only if clearly stated or strongly implied by titles; otherwise leave empty.',
        type: 'text',
    },
    {
        id: 'email',
        label: 'Email',
        description: 'The candidate\'s email address, exactly as written.',
        type: 'email',
    },
    {
        id: 'phone',
        label: 'Phone',
        description: 'The candidate\'s phone number, including country code if present.',
        type: 'tel',
    },
    {
        id: 'company_applied_to',
        label: 'Company applied to',
        description:
            'The company the candidate is applying to. This is almost never in a CV — leave empty unless explicitly stated.',
        type: 'text',
    },
    {
        id: 'current_company',
        label: 'Current company',
        description: 'The employer of the candidate\'s current or most recent job.',
        type: 'text',
    },
    {
        id: 'highest_education_level',
        label: 'Highest education level',
        description:
            'The highest degree obtained, e.g. High School, Diploma, Bachelor, Master, PhD.',
        type: 'text',
    },
    {
        id: 'years_of_experience',
        label: 'Years of experience',
        description:
            'Total professional years of experience as a number or short range (e.g. "5" or "5-7"). Compute from the work history only if it is unambiguous; otherwise leave empty.',
        type: 'text',
    },
    {
        id: 'skills',
        label: 'Skills',
        description:
            'Key professional/technical skills, as a single comma-separated string (e.g. "React, Node.js, SQL").',
        type: 'text',
    },
    {
        id: 'languages',
        label: 'Languages',
        description:
            'Spoken/written human languages, as a comma-separated string (e.g. "Arabic, English").',
        type: 'text',
    },
    {
        id: 'certifications',
        label: 'Certifications',
        description:
            'Professional certifications, as a comma-separated string (e.g. "PMP, AWS Solutions Architect").',
        type: 'text',
    },
] as const;

const FIELD_IDS = new Set(CANDIDATE_CV_FIELDS.map((f) => f.id));

/** True when `id` is a known extractable field. */
export function isCvFieldId(id: unknown): id is string {
    return typeof id === 'string' && FIELD_IDS.has(id);
}

/**
 * Resolve the fields to extract. When `requestedIds` is provided we keep only the
 * known ones (order preserved from the registry); otherwise we extract all.
 */
export function resolveCvFields(requestedIds?: readonly unknown[]): CvField[] {
    if (!requestedIds || requestedIds.length === 0) {
        return [...CANDIDATE_CV_FIELDS];
    }
    const wanted = new Set(requestedIds.filter(isCvFieldId));
    if (wanted.size === 0) return [...CANDIDATE_CV_FIELDS];
    return CANDIDATE_CV_FIELDS.filter((f) => wanted.has(f.id));
}
