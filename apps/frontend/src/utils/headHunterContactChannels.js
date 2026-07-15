/**
 * قنوات التواصل لبطاقة/لوحة Head Hunter (هاتف، بريد، LinkedIn).
 *
 * @typedef {{ phone: string; telHref: string; email: string; mailtoHref: string; linkedinHref: string }} HeadHunterContactChannels
 */

/** @param {string} raw */
export function telHrefFromPhone(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const normalized = s.replace(/[\u00A0\u2007\u202F\u2000-\u200B]/g, '').replace(/\s/g, '');
    if (!normalized) return '';
    if (normalized.startsWith('+')) {
        const digits = normalized.slice(1).replace(/\D/g, '');
        return digits ? `tel:+${digits}` : '';
    }
    const digits = normalized.replace(/\D/g, '');
    return digits ? `tel:${digits}` : '';
}

/** @param {string} raw */
export function linkedInHrefFromRaw(raw) {
    const u = typeof raw === 'string' ? raw.trim() : '';
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/\//.test(u)) return `https:${u}`;
    return `https://${u.replace(/^\/+/, '')}`;
}

/**
 * @param {import('./headHunterNormalize.js').HeadHunterCandidate} candidate
 * @returns {HeadHunterContactChannels}
 */
export function buildHeadHunterContactChannels(candidate) {
    const phone = typeof candidate.phone === 'string' ? candidate.phone.trim() : '';
    const email = typeof candidate.email === 'string' ? candidate.email.trim() : '';
    const linkedin_url = typeof candidate.linkedin_url === 'string' ? candidate.linkedin_url.trim() : '';
    return {
        phone,
        telHref: phone ? telHrefFromPhone(phone) : '',
        email,
        mailtoHref: email ? `mailto:${email.replace(/^mailto:/i, '')}` : '',
        linkedinHref: linkedin_url ? linkedInHrefFromRaw(linkedin_url) : '',
    };
}
