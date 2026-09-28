import { fillI18nTemplate } from './i18nTemplate.js';

/** Optional filters — checkbox enables a value field sent to n8n when filled */
export const OPTIONAL_FILTER_FIELDS = [
    {
        key: 'requiredLanguages',
        labelKey: 'newCampaign_jc_languages_label',
        placeholderKey: 'newCampaign_jc_languages_ph',
    },
    {
        key: 'requiredSkills',
        labelKey: 'newCampaign_jc_skills_label',
        placeholderKey: 'newCampaign_jc_skills_ph',
    },
    {
        key: 'certifications',
        labelKey: 'newCampaign_jc_certifications_label',
        placeholderKey: 'newCampaign_jc_certifications_ph',
    },
    {
        key: 'industryType',
        labelKey: 'newCampaign_jc_industryType_label',
        placeholderKey: 'newCampaign_jc_industryType_ph',
    },
    {
        key: 'gender',
        labelKey: 'newCampaign_jc_gender_label',
        placeholderKey: 'newCampaign_jc_gender_ph',
    },
];

/**
 * AI CV Comparison — languages, skills, certifications, industry type.
 *
 * Only `gender` is excluded now. The `company` filter was removed from the Head
 * Hunter form on 2026-09-28, so it is gone from this derived list too and no
 * longer needs excluding. The backend's `OPTIONAL_CRITERION_LABELS` deliberately
 * keeps its `company` entry: searches already saved with one must still render
 * their label, and an unlisted key is ignored rather than rejected.
 */
export const CV_COMPARISON_OPTIONAL_FILTER_FIELDS = OPTIONAL_FILTER_FIELDS.filter(
    ({ key }) => key !== 'gender'
);

export function createInitialOptionalFilters(fields = OPTIONAL_FILTER_FIELDS) {
    return Object.fromEntries(
        fields.map(({ key }) => [key, { enabled: false, value: '' }])
    );
}

export function buildOptionalFiltersPayload(optionalFilters, fields = OPTIONAL_FILTER_FIELDS) {
    const out = {};
    for (const { key } of fields) {
        const row = optionalFilters[key];
        if (row?.enabled && row.value.trim()) {
            out[key] = row.value.trim();
        }
    }
    return out;
}

export function findEnabledOptionalFilterMissingValue(optionalFilters, t, fields = OPTIONAL_FILTER_FIELDS) {
    for (const { key, labelKey } of fields) {
        const row = optionalFilters[key];
        if (row?.enabled && !row.value.trim()) {
            return fillI18nTemplate(t('aiHeadHunterErrOptionalFilterValue'), {
                label: t(labelKey),
            });
        }
    }
    return null;
}
