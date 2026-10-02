/**
 * مفتاح مرشح ثابت + حالة كشف الحقول — يجب أن يطابق contactRevealService في الخادم.
 */

/** @typedef {'phone'|'email'|'linkedin'} ContactRevealField */

export const CONTACT_REVEAL_FIELDS = /** @type {const} */ (['phone', 'email', 'linkedin']);

/** @param {unknown} v */
function normalizeRevealKeyPart(v) {
    if (typeof v !== 'string') return '';
    return v.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * @param {import('./headHunterNormalize.js').HeadHunterCandidate} candidate
 * @returns {string}
 */
export function candidateRevealKey(candidate) {
    if (!candidate || typeof candidate !== 'object') return '';

    const linkedin = normalizeRevealKeyPart(candidate.linkedin_url ?? candidate.linkedin);
    if (linkedin) {
        return `li:${linkedin.replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 160)}`;
    }

    const email = normalizeRevealKeyPart(candidate.email);
    if (email) return `em:${email.slice(0, 160)}`;

    const phone = normalizeRevealKeyPart(candidate.phone).replace(/[^\d+]/g, '');
    if (phone) return `ph:${phone.slice(0, 40)}`;

    const id =
        typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : '';
    return id ? `id:${id.slice(0, 160)}` : '';
}

/**
 * @param {import('./headHunterNormalize.js').HeadHunterCandidate} candidate
 * @returns {ContactRevealField[]}
 */
export function availableRevealFieldsForCandidate(candidate) {
    /** @type {ContactRevealField[]} */
    const fields = [];
    if (normalizeRevealKeyPart(candidate?.phone)) fields.push('phone');
    if (normalizeRevealKeyPart(candidate?.email)) fields.push('email');
    if (normalizeRevealKeyPart(candidate?.linkedin_url ?? candidate?.linkedin)) fields.push('linkedin');
    return fields;
}

/**
 * @param {import('./headHunterContactChannels.js').HeadHunterContactChannels} contact
 * @returns {number}
 */
export function countRevealPieces(contact) {
    if (!contact) return 0;
    let n = 0;
    if (contact.telHref) n += 1;
    if (contact.mailtoHref) n += 1;
    if (contact.linkedinHref) n += 1;
    return n;
}

/**
 * @typedef {{ legacyFull?: boolean; fields: Set<string> }} RevealFieldState
 */

/**
 * @param {import('./headHunterNormalize.js').HeadHunterCandidate} candidate
 * @param {Map<string, RevealFieldState>} stateMap
 * @returns {boolean}
 */
export function isContactFullyRevealed(candidate, stateMap) {
    const key = candidateRevealKey(candidate);
    if (!key) return false;
    const state = stateMap.get(key);
    if (!state) return false;
    if (state.legacyFull) return true;
    const needed = availableRevealFieldsForCandidate(candidate);
    if (needed.length === 0) return false;
    return needed.every((f) => state.fields.has(f));
}

/**
 * @param {Map<string, RevealFieldState>} stateMap
 * @param {string} candidateKey
 * @param {{ revealedFields?: string[]; legacyFullReveal?: boolean }} record
 * @returns {Map<string, RevealFieldState>}
 */
export function mergeRevealRecord(stateMap, candidateKey, record) {
    const next = new Map(stateMap);
    next.set(candidateKey, {
        legacyFull: Boolean(record.legacyFullReveal),
        fields: new Set(Array.isArray(record.revealedFields) ? record.revealedFields : []),
    });
    return next;
}
