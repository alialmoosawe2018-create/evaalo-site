/**
 * معايير Job Criteria لمسار Audio Interview فقط — مفاتيح API بصيغة snake_case.
 * العناوين ونصوص placeholder تُعرَض مترجمة في NewInterviewSidebar (`newCampaign_ac_*`).
 */
export const AVAILABLE_CRITERIA_AUDIO = [
    { id: 'full_name', label: 'Full name', placeholder: 'Full name (English)', type: 'text' },
    { id: 'position_applied_for', label: 'Position applied for', placeholder: 'Type or pick from list (▼)', type: 'text' },
    { id: 'job_level', label: 'Job level', placeholder: 'Pick job level (▼)', type: 'text' },
    { id: 'email', label: 'Email', placeholder: 'email@example.com', type: 'email' },
    { id: 'phone', label: 'Phone', placeholder: 'Phone (required for voice interview record)', type: 'tel' },
    { id: 'company_applied_to', label: 'Company applied to', placeholder: 'Company name', type: 'text' },
    { id: 'current_company', label: 'Current company', placeholder: 'Current employer (if any)', type: 'text' },
    { id: 'highest_education_level', label: 'Highest education level', placeholder: 'Pick level or type (▼)', type: 'text' },
    { id: 'years_of_experience', label: 'Years of experience', placeholder: 'Pick range or type (▼)', type: 'text' },
    { id: 'skills', label: 'Skills', placeholder: 'Pick a skill or type your own (▼)', type: 'text' },
    { id: 'languages', label: 'Languages', placeholder: 'Pick languages or type (comma-separated) (▼)', type: 'text' },
    { id: 'certifications', label: 'Certifications', placeholder: 'Required certifications', type: 'text' },
];
