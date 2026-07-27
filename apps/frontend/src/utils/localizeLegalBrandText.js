/** Localized product name in Arabic/Kurdish legal copy (Latin evaalo → ایڤالو). */
export const EVAALO_BRAND_AR_KU = 'ایڤالو';

/** Product brand in English legal copy — always lowercase. */
export const EVAALO_BRAND = 'evaalo';

/** Legal entity — Latin on all locales; brand stays lowercase. */
export const EVAALO_LEGAL_ENTITY = 'evaalo, LLC';

/** Must not contain Evaalo/EVAALO — those substrings would be rewritten before restore. */
const LLC_PLACEHOLDER = '<<LEGAL_ENTITY>>';

/**
 * Normalize Evaalo/EVAALO brand references in legal copy.
 * English: evaalo (lowercase). Arabic/Kurdish: ایڤالو.
 * Preserves the legal company name "evaalo, LLC" exactly.
 */
export function localizeLegalBrandText(text, locale) {
    if (typeof text !== 'string' || !text) return text;

    let out = text.replace(/Evaalo,\s*LLC/gi, LLC_PLACEHOLDER);
    out = out.replace(/evaalo,\s*LLC/gi, LLC_PLACEHOLDER);

    if (locale === 'ar' || locale === 'ku') {
        out = out.replace(/EVAALO/g, EVAALO_BRAND_AR_KU);
        out = out.replace(/Evaalo/g, EVAALO_BRAND_AR_KU);
        out = out.replace(/evaalo/g, EVAALO_BRAND_AR_KU);
        out = out.replace(/إيفالو/g, EVAALO_BRAND_AR_KU);
    } else {
        out = out.replace(/EVAALO/g, EVAALO_BRAND);
        out = out.replace(/Evaalo/g, EVAALO_BRAND);
    }

    return out.split(LLC_PLACEHOLDER).join(EVAALO_LEGAL_ENTITY);
}

/** Deep-walk legal doc objects (privacy, terms, security, about). */
export function localizeLegalBrandDeep(value, locale) {
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
