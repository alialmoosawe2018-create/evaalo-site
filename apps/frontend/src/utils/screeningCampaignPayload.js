/** Helpers for AI Screening campaign create payload (S2). */

import { parseInterviewUrlLanguage } from './interviewShareLink.js';

export const DEFAULT_SCREENING_FORM_TEMPLATE_ID = 'template-remote';

/**
 * Preset job criteria only — custom rubric items are sent separately as customCriteria.
 */
export function buildPresetCriteriaPayload({
    jobDetails,
    selectedCriteria,
    certificationRows,
    skillRows,
    languageRows,
    aiCompareEmailRows,
}) {
    const out = { ...jobDetails };
    if (selectedCriteria.certifications) {
        const joined = certificationRows.map((s) => (s || '').trim()).filter(Boolean).join('; ');
        out.certifications = joined;
    }
    if (selectedCriteria.skills) {
        const joined = skillRows.map((s) => (s || '').trim()).filter(Boolean).join('; ');
        out.skills = joined;
    }
    if (selectedCriteria.languages) {
        const joined = languageRows.map((s) => (s || '').trim()).filter(Boolean).join('; ');
        out.languages = joined;
    }
    if (selectedCriteria.aiCompareTop) {
        const emails = aiCompareEmailRows.map((s) => (s || '').trim()).filter(Boolean);
        out.aiCompareTop = emails.join(', ');
        out.aiCompareTopEmails = emails;
    }
    return out;
}

export function buildCustomRubricItems(customCriteria) {
    return (customCriteria || [])
        .map(({ label, expectation }) => ({
            label: String(label || '').trim(),
            expectation: String(expectation || '').trim(),
        }))
        .filter((item) => item.label && item.expectation);
}

export function countFilledCustomRubricItems(customCriteria) {
    return buildCustomRubricItems(customCriteria).length;
}

/**
 * POST /api/recruitment-campaigns body for AI Screening (form) campaigns.
 */
export function buildScreeningCampaignCreateBody({
    jobDetails,
    selectedCriteria,
    certificationRows,
    skillRows,
    languageRows,
    aiCompareEmailRows,
    customCriteria,
    formTemplateId,
    jobAdvertisement,
    language,
}) {
    const payload = {
        ...buildPresetCriteriaPayload({
            jobDetails,
            selectedCriteria,
            certificationRows,
            skillRows,
            languageRows,
            aiCompareEmailRows,
        }),
        interviewType: 'form',
        formTemplateId: formTemplateId || DEFAULT_SCREENING_FORM_TEMPLATE_ID,
    };
    const customItems = buildCustomRubricItems(customCriteria);
    if (customItems.length > 0) {
        payload.customCriteria = customItems;
    }
    if (jobAdvertisement?.trim()) {
        payload.jobAdvertisement = jobAdvertisement.trim();
    }
    if (language) {
        payload.language = language;
    }
    return payload;
}

/**
 * Share language for public form URLs — ar/en only; Kurdish UI maps to Arabic.
 * @param {string} [language]
 * @returns {'en'|'ar'|null}
 */
export function resolveFormShareLanguage(language) {
    const parsed = parseInterviewUrlLanguage(language);
    if (parsed === 'en') return 'en';
    if (parsed === 'ar' || parsed === 'ku') return 'ar';
    return null;
}

/** @param {string} url @param {string} [language] */
export function appendFormShareLanguage(url, language) {
    const shareLang = resolveFormShareLanguage(language);
    if (!shareLang || /[?&]language=/i.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}language=${shareLang}`;
}

/**
 * Resolve public application URL from campaign create API response.
 * @param {object} result
 * @param {(path: string) => string} absoluteAppUrl
 * @param {{ language?: string }} [options]
 */
export function resolvePublicFormUrlFromCampaignResponse(result, absoluteAppUrl, options = {}) {
    if (!result?.success) return null;
    let path;
    if (result.publicFormPath) {
        path = result.publicFormPath;
    } else if (result.publicApplicationToken) {
        path = `/form?pub=${encodeURIComponent(result.publicApplicationToken)}`;
    } else if (result.campaignId) {
        path = `/form?template=${encodeURIComponent(DEFAULT_SCREENING_FORM_TEMPLATE_ID)}&campaign=${encodeURIComponent(result.campaignId)}`;
    } else {
        return null;
    }
    return appendFormShareLanguage(absoluteAppUrl(path), options.language);
}

export function formatCampaignCreateError(result, fallback = 'Failed to create campaign. Please try again.') {
    if (!result) return fallback;
    if (Array.isArray(result.details) && result.details.length > 0) {
        const first = result.details[0];
        return first.message || first.code || result.message || result.error || fallback;
    }
    return result.message || result.error || fallback;
}
