// ============================================
// File: utils/publicIntakeForm.js
// Purpose: Shared shape + helpers for the intake step of the public interview
//          links (voice and video). Both pages collect the same fields, may
//          prefill them from an uploaded CV, and submit the same multipart body
//          to /api/candidates.
// ============================================

/** Text fields the public intake collects, beyond the three required ones. */
export const PUBLIC_INTAKE_OPTIONAL_KEYS = [
    'position_applied_for',
    'years_of_experience',
    'highest_education_level',
    'current_company',
    'location',
    'skills',
    'languages',
];

const REQUIRED_KEYS = ['full_name', 'email', 'phone'];

/** Fresh, empty intake state. */
export function createPublicIntakeState() {
    const details = {};
    for (const key of [...REQUIRED_KEYS, ...PUBLIC_INTAKE_OPTIONAL_KEYS]) details[key] = '';
    return { details, cvFile: null, photoFile: null };
}

export const CV_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const CV_ACCEPT = '.pdf,.docx,.txt,application/pdf,text/plain';
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const CV_EXTENSIONS = new Set(['pdf', 'docx', 'txt']);
const PHOTO_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function extensionOf(name) {
    return String(name || '').toLowerCase().split('.').pop() || '';
}

/** Mirrors the backend filter — some browsers send octet-stream, so check the name too. */
export function isSupportedCvFile(file) {
    if (!file) return false;
    const mime = String(file.type || '').toLowerCase();
    if (mime === 'application/pdf' || mime === 'text/plain') return true;
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return true;
    }
    return CV_EXTENSIONS.has(extensionOf(file.name));
}

export function isSupportedPhotoFile(file) {
    if (!file) return false;
    if (PHOTO_MIMES.has(String(file.type || '').toLowerCase())) return true;
    return ['jpg', 'jpeg', 'png', 'webp'].includes(extensionOf(file.name));
}

/**
 * A `data:` URL from the CV parser turned into a File, so an auto-extracted
 * photo uploads through exactly the same path as one the candidate picked.
 * Returns null on anything malformed — the photo is optional either way.
 */
export function dataUrlToFile(dataUrl, baseName = 'cv-photo') {
    try {
        const [head, body] = String(dataUrl || '').split(',');
        if (!head || !body) return null;
        const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return null;
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        return new File([bytes], `${baseName}.${ext}`, { type: mime });
    } catch (_) {
        return null;
    }
}

/**
 * Merge fields parsed from a CV into the form.
 *
 * Only fills blanks: whatever the candidate typed always wins, so re-uploading a
 * CV can never overwrite a correction they just made. Returns the new details
 * plus how many blanks were filled, which drives the confirmation message.
 */
export function mergeParsedCvFields(details, parsed) {
    const next = { ...details };
    let filled = 0;
    for (const [key, raw] of Object.entries(parsed || {})) {
        if (!(key in next)) continue;
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) continue;
        if (String(next[key] || '').trim()) continue;
        next[key] = value;
        filled += 1;
    }
    return { next, filled };
}

/** Which of the three required fields are still empty. */
export function missingRequiredFields(details) {
    return REQUIRED_KEYS.filter((key) => !String(details?.[key] || '').trim());
}

export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/**
 * The multipart body POST /api/candidates expects.
 *
 * multipart rather than JSON because that is the only shape that carries the CV
 * and photo files; the route accepts both, so the text-only case is unchanged.
 */
export function buildPublicIntakeFormData(intake, extras = {}) {
    const details = intake?.details || {};
    const text = (value) => String(value ?? '').trim();
    const form = new FormData();

    form.append('full_name', text(details.full_name));
    form.append('email', text(details.email));
    form.append('phone', text(details.phone));
    // These two have always been sent; keep the historical placeholders so an
    // empty optional field looks the same as it did before this form grew.
    form.append('position_applied_for', text(details.position_applied_for) || 'General');
    form.append('years_of_experience', text(details.years_of_experience) || 'N/A');

    for (const key of PUBLIC_INTAKE_OPTIONAL_KEYS) {
        if (key === 'position_applied_for' || key === 'years_of_experience') continue;
        const value = text(details[key]);
        if (value) form.append(key, value);
    }

    form.append('agreeToTerms', 'true');
    for (const [key, value] of Object.entries(extras)) {
        if (value == null || value === '') continue;
        form.append(key, String(value));
    }

    if (intake?.cvFile) form.append('cv', intake.cvFile);
    if (intake?.photoFile) form.append('photo', intake.photoFile);
    return form;
}
