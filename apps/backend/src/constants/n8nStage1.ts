/** Honeypot field names checked by n8n Stage 1 Spam Pre-Check — must stay in sync with workflow */
export const N8N_HONEYPOT_FIELD_NAMES = [
    'website',
    'company_url',
    'url',
    'hp',
    'honeypot',
    'bot_field',
    'fax',
] as const;

export type N8nHoneypotFieldName = (typeof N8N_HONEYPOT_FIELD_NAMES)[number];

export const N8N_STAGE1_REJECT_CODES: Record<string, string> = {
    honeypot: 'Bot detected (hidden field filled)',
    invalid_email: 'Invalid email address',
    invalid_phone: 'Invalid phone number',
    invalid_name: 'Invalid name',
    missing_cv: 'CV file is required',
    invalid_cv_type: 'CV must be a PDF',
    cv_too_large: 'CV exceeds size limit',
    duplicate: 'Duplicate application within 24 hours',
    ai_spam: 'Application flagged as spam',
    rejected: 'Application rejected',
};

export function extractHoneypotFields(body: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of N8N_HONEYPOT_FIELD_NAMES) {
        if (body[key] !== undefined && body[key] !== null) {
            out[key] = String(body[key]);
            delete body[key];
        }
    }
    return out;
}

export function isHoneypotTriggered(fields: Record<string, string>): boolean {
    return N8N_HONEYPOT_FIELD_NAMES.some((key) => {
        const val = fields[key];
        return val !== undefined && val !== null && String(val).trim() !== '';
    });
}
