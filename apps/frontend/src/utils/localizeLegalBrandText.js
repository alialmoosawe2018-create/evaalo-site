/** Localized product name in Arabic/Kurdish legal copy (Latin Evaalo → ایڤالو). */
export const EVAALO_BRAND_AR_KU = 'ایڤالو';

/** Legal entity — must stay in Latin on all locales. */
export const EVAALO_LEGAL_ENTITY = 'Evaalo, LLC';

/** Must not contain Evaalo/EVAALO — those substrings would be rewritten before restore. */
const LLC_PLACEHOLDER = '<<LEGAL_ENTITY>>';

/**
 * Replace Evaalo/EVAALO (and legacy إيفالو) with ایڤالو for ar/ku legal pages.
 * Preserves the legal company name "Evaalo, LLC" exactly.
 */
export function localizeLegalBrandText(text, locale) {
    if (typeof text !== 'string' || !text) return text;
    if (locale !== 'ar' && locale !== 'ku') return text;

    let out = text.replace(/Evaalo,\s*LLC/gi, LLC_PLACEHOLDER);
    out = out.replace(/EVAALO/g, EVAALO_BRAND_AR_KU);
    out = out.replace(/Evaalo/g, EVAALO_BRAND_AR_KU);
    out = out.replace(/evaalo/g, EVAALO_BRAND_AR_KU);
    out = out.replace(/إيفالو/g, EVAALO_BRAND_AR_KU);
    return out.split(LLC_PLACEHOLDER).join(EVAALO_LEGAL_ENTITY);
}

/** Deep-walk legal doc objects (privacy, terms, security, about). */
export function localizeLegalBrandDeep(value, locale) {
    if (locale !== 'ar' && locale !== 'ku') return value;
    if (typeof value === 'string') return localizeLegalBrandText(value, locale);
    if (Array.isArray(value)) {
        return value.map((item) => localizeLegalBrandDeep(item, locale));
    }
    if (value && typeof value === 'object') {
        const next = {};
        for (const [key, val] of Object.entries(value)) {
            if (key === 'company' && val === EVAALO_LEGAL_ENTITY) {
                next[key] = val;
                continue;
            }
            next[key] = localizeLegalBrandDeep(val, locale);
        }
        return next;
    }
    return value;
}
