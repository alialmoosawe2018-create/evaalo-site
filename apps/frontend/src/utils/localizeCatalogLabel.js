import { resolveJobRole, getRolePositionLabelKey } from '@evaalo/job-catalog';
import positionLabelsAr from '../constants/positionLabels.ar.json';
import positionLabelsKu from '../constants/positionLabels.ku.json';
import locationLabelsAr from '../constants/locationLabels.ar.json';
import locationLabelsKu from '../constants/locationLabels.ku.json';
import governorateLabelsAr from '../constants/governorateLabels.ar.json';
import governorateLabelsKu from '../constants/governorateLabels.ku.json';

function buildLabelCatalog(currentLang) {
    if (currentLang === 'ar') {
        return { ...positionLabelsAr, ...locationLabelsAr, ...governorateLabelsAr };
    }
    if (currentLang === 'ku') {
        return { ...positionLabelsKu, ...locationLabelsKu, ...governorateLabelsKu };
    }
    return null;
}

function lookupAlternates(catalog, raw) {
    if (catalog[raw]) return catalog[raw];
    const amp = raw.replace(/\s+and\s+/gi, ' & ');
    if (amp !== raw && catalog[amp]) return catalog[amp];
    const and = raw.replace(/\s*&\s*/g, ' and ');
    if (and !== raw && catalog[and]) return catalog[and];
    return null;
}

/**
 * Localize a stored English job title, governorate, or location for UI display.
 * @param {string | null | undefined} storedValue
 * @param {string} currentLang
 */
export function localizeCatalogLabel(storedValue, currentLang) {
    const raw = String(storedValue ?? '').trim();
    if (!raw || currentLang === 'en') return raw;

    const catalog = buildLabelCatalog(currentLang);
    if (!catalog) return raw;

    const direct = lookupAlternates(catalog, raw);
    if (direct) return direct;

    try {
        const resolved = resolveJobRole(raw);
        if (resolved?.roleKey) {
            const positionRoleKey = getRolePositionLabelKey(resolved.roleKey);
            if (catalog[positionRoleKey]) return catalog[positionRoleKey];
            if (resolved?.labelKey && catalog[resolved.labelKey]) {
                return catalog[resolved.labelKey];
            }
            if (resolved?.careerLevel) {
                const lk = `${resolved.roleKey}.${resolved.careerLevel}`;
                if (catalog[lk]) return catalog[lk];
            }
            const midKey = `${resolved.roleKey}.mid`;
            if (catalog[midKey]) return catalog[midKey];
        }
    } catch {
        /* ignore resolution errors */
    }

    return raw;
}
