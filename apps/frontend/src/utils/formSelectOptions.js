import { GENDER_OPTIONS } from '../constants/genderOptions.js';
import { HIGHEST_EDUCATION_OPTIONS } from '../constants/educationLevelOptions.js';
import { YEARS_OF_EXPERIENCE_OPTIONS } from '../constants/yearsOfExperienceOptions.js';
import { AVAILABILITY_OPTIONS } from '../constants/availabilityOptions.js';
import { HEAR_ABOUT_US_OPTIONS } from '../constants/hearAboutUsOptions.js';
import { LANGUAGE_LEVEL_OPTIONS } from '../constants/languageLevels.js';
import { IRAQI_GOVERNORATES } from '../constants/iraqiGovernorates.js';
import { LANGUAGE_SUGGESTIONS } from '../constants/languageSuggestions.js';
import { KEY_SKILL_SUGGESTIONS } from '../constants/keySkillSuggestions.js';
import governorateLabelsAr from '../constants/governorateLabels.ar.json';
import governorateLabelsKu from '../constants/governorateLabels.ku.json';
import comboLanguageLabelsAr from '../constants/comboLanguageLabels.ar.json';
import comboLanguageLabelsKu from '../constants/comboLanguageLabels.ku.json';
import comboSkillLabelsAr from '../constants/comboSkillLabels.ar.json';
import comboSkillLabelsKu from '../constants/comboSkillLabels.ku.json';

const EDU_OPT_KEY = {
    'high-school': 'newCampaign_combo_edu_high_school',
    diploma: 'newCampaign_combo_edu_diploma',
    bachelor: 'newCampaign_combo_edu_bachelor',
    master: 'newCampaign_combo_edu_master',
    phd: 'newCampaign_combo_edu_phd',
    other: 'newCampaign_combo_edu_other',
};

const EXP_OPT_KEY = {
    '0-1': 'newCampaign_combo_exp_0_1',
    '2-3': 'newCampaign_combo_exp_2_3',
    '4-5': 'newCampaign_combo_exp_4_5',
    '6-10': 'newCampaign_combo_exp_6_10',
    '10+': 'newCampaign_combo_exp_10_plus',
};

const AVAILABILITY_OPT_KEY = {
    immediate: 'formOption_availability_immediate',
    '1-week': 'formOption_availability_1_week',
    '2-weeks': 'formOption_availability_2_weeks',
    '1-month': 'formOption_availability_1_month',
    '2-months': 'formOption_availability_2_months',
};

const HEAR_ABOUT_OPT_KEY = {
    linkedin: 'formOption_hearAbout_linkedin',
    'job-board': 'formOption_hearAbout_job_board',
    'company-website': 'formOption_hearAbout_company_website',
    referral: 'formOption_hearAbout_referral',
    'social-media': 'formOption_hearAbout_social_media',
    other: 'formOption_hearAbout_other',
};

const LANGUAGE_LEVEL_OPT_KEY = {
    beginner: 'formOption_languageLevel_beginner',
    intermediate: 'formOption_languageLevel_intermediate',
    advanced: 'formOption_languageLevel_advanced',
    native: 'formOption_languageLevel_native',
};

function mapOptionsWithKeys(options, keyMap, t) {
    return options.map((o) => {
        const key = keyMap[o.value];
        return { value: o.value, label: key ? t(key) : o.label };
    });
}

/** @param {(k: string) => string} t */
export function buildGenderOptions(t) {
    return GENDER_OPTIONS.map((o) => ({
        value: o.value,
        label: t(o.value === 'male' ? 'newCampaign_combo_gender_male' : 'newCampaign_combo_gender_female'),
    }));
}

/** @param {(k: string) => string} t */
export function buildEducationOptions(t) {
    return mapOptionsWithKeys(HIGHEST_EDUCATION_OPTIONS, EDU_OPT_KEY, t);
}

/** @param {(k: string) => string} t */
export function buildExperienceOptions(t) {
    return mapOptionsWithKeys(YEARS_OF_EXPERIENCE_OPTIONS, EXP_OPT_KEY, t);
}

/** @param {(k: string) => string} t */
export function buildAvailabilityOptions(t) {
    return mapOptionsWithKeys(AVAILABILITY_OPTIONS, AVAILABILITY_OPT_KEY, t);
}

/** @param {(k: string) => string} t */
export function buildHearAboutOptions(t) {
    return mapOptionsWithKeys(HEAR_ABOUT_US_OPTIONS, HEAR_ABOUT_OPT_KEY, t);
}

/** @param {(k: string) => string} t */
export function buildLanguageLevelOptions(t) {
    return mapOptionsWithKeys(LANGUAGE_LEVEL_OPTIONS, LANGUAGE_LEVEL_OPT_KEY, t);
}

/** @param {string} currentLang */
export function buildGovernorateSuggestions(currentLang) {
    const catalog =
        currentLang === 'ar' ? governorateLabelsAr : currentLang === 'ku' ? governorateLabelsKu : null;
    return IRAQI_GOVERNORATES.map((en) => catalog?.[en] ?? en);
}

/** @param {string} currentLang */
export function buildSkillSuggestionOptions(currentLang) {
    const catalog =
        currentLang === 'ar' ? comboSkillLabelsAr : currentLang === 'ku' ? comboSkillLabelsKu : null;
    return KEY_SKILL_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
}

/** @param {string} currentLang */
export function buildLanguageSuggestionOptions(currentLang) {
    const catalog =
        currentLang === 'ar' ? comboLanguageLabelsAr : currentLang === 'ku' ? comboLanguageLabelsKu : null;
    return LANGUAGE_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
}

/** @param {(k: string) => string} t @param {string} levelValue */
export function languageLevelLabel(t, levelValue) {
    const key = LANGUAGE_LEVEL_OPT_KEY[levelValue];
    return key ? t(key) : levelValue;
}

export const SALARY_CURRENCY_OPTIONS = [
    { value: 'USD', label: 'USD' },
    { value: 'IQD', label: 'IQD' },
];
