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
        .map(({ label, expectation, essential }) => ({
            label: String(label || '').trim(),
            expectation: String(expectation || '').trim(),
            // Only ever sent as `true`; the backend tests `=== true`.
            ...(essential === true ? { essential: true } : {}),
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
    essentialCriteria,
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
    // Must-have preset criteria, sent as a list of keys. Only keys the recruiter
    // both selected AND flagged count — a flag left behind on a deselected card
    // must not mark a criterion the campaign does not even have.
    const essentialKeys = Object.keys(essentialCriteria || {}).filter(
        (k) => essentialCriteria[k] && selectedCriteria?.[k]
    );
    if (essentialKeys.length > 0) {
        payload.essentialCriteria = essentialKeys;
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
 * Build a shareable campaign form URL with UI language embedded.
 * @param {(path: string) => string} absoluteAppUrl
 * @param {{ templateId: string; campaignId: string; language?: string }} opts
 */
export function buildCampaignFormShareUrl(absoluteAppUrl, { templateId, campaignId, language }) {
    const path = `/form?template=${encodeURIComponent(templateId)}&campaign=${encodeURIComponent(campaignId)}`;
    return appendFormShareLanguage(absoluteAppUrl(path), language);
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

/**
 * Server refusals the UI already has its own translated wording for.
 *
 * The API answers a validation refusal with an English `message`, and this
 * formatter used to show it verbatim — so an Arabic user got an English
 * paragraph. The frontend runs the same rubric check itself and localizes it,
 * but only when `selectedInterviewType === 'form'`, while the server checks
 * anything that is not audio/video. Any screening flow outside that one type
 * reaches the server and came back in English.
 *
 * Mapping the CODE (not the message text) keeps the two independent: the server
 * can reword its message freely without silently breaking the translation.
 */
const SERVER_ERROR_TRANSLATION_KEYS = {
    rubric_required: 'newCampaign_rubricNeedsScoring',
};

/**
 * @param {object|null} result           the API error body
 * @param {string} [fallback]
 * @param {(key: string) => string} [translate]  pass `t` to localize known codes
 */
export function formatCampaignCreateError(
    result,
    fallback = 'Failed to create campaign. Please try again.',
    translate
) {
    if (!result) return fallback;

    const key = SERVER_ERROR_TRANSLATION_KEYS[result.error];
    if (key && typeof translate === 'function') {
        const localized = translate(key);
        // A missing key returns the key itself in this i18n helper; that would
        // be worse than the server's English sentence, so only take a real hit.
        if (localized && localized !== key) return localized;
    }

    if (Array.isArray(result.details) && result.details.length > 0) {
        const first = result.details[0];
        return first.message || first.code || result.message || result.error || fallback;
    }
    return result.message || result.error || fallback;
}
