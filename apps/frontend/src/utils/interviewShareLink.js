/** Candidate-facing interview routes (no site nav). */
export const CANDIDATE_INTERVIEW_ROUTES = [
    '/interview',
    '/video-interview-call',
    '/screening-call',
    '/video-screening-call',
];

export function isCandidateInterviewRoute(pathname) {
    return CANDIDATE_INTERVIEW_ROUTES.includes(pathname);
}

/** @returns {'en'|'ar'|'ku'|null} */
export function parseInterviewUrlLanguage(raw) {
    const v = (raw || '').toLowerCase();
    if (v === 'en' || v === 'english') return 'en';
    if (v === 'ku' || v === 'kurdish' || v === 'ckb') return 'ku';
    if (v === 'ar' || v === 'arabic') return 'ar';
    return null;
}

/** @param {URLSearchParams} params @param {string} [lang] */
export function appendInterviewShareLanguage(params, lang) {
    const parsed = parseInterviewUrlLanguage(lang);
    if (parsed) params.set('language', parsed);
    return params;
}

/**
 * @param {{ candidateId: string; campaignId?: string; applicationId?: string; language?: string }} opts
 * @returns {URLSearchParams}
 */
export function buildCandidateInterviewQuery({ candidateId, campaignId, applicationId, language }) {
    const q = new URLSearchParams({ candidateId: String(candidateId) });
    if (campaignId) q.set('campaignId', String(campaignId));
    if (applicationId) q.set('applicationId', String(applicationId));
    appendInterviewShareLanguage(q, language);
    return q;
}

/**
 * من صف Stage (Application أو Candidate legacy): معرّف الشخص للمقابلات.
 * @param {object} row
 * @returns {string}
 */
export function resolveSharePersonId(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.candidateId) return String(row.candidateId);
    return String(row._id || row.id || '');
}

/**
 * @param {object} row
 * @returns {string|undefined}
 */
export function resolveShareApplicationId(row) {
    if (!row || typeof row !== 'object') return undefined;
    if (row.applicationId) return String(row.applicationId);
    if (row.__rowKind === 'application' && (row._id || row.id)) return String(row._id || row.id);
    return undefined;
}
