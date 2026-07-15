import { LANGUAGE_SUGGESTIONS } from '../constants/languageSuggestions.js';
import { KEY_SKILL_SUGGESTIONS } from '../constants/keySkillSuggestions.js';
import { GENDER_OPTIONS } from '../constants/genderOptions.js';
import comboLanguageLabelsAr from '../constants/comboLanguageLabels.ar.json';
import comboLanguageLabelsKu from '../constants/comboLanguageLabels.ku.json';
import comboSkillLabelsAr from '../constants/comboSkillLabels.ar.json';
import comboSkillLabelsKu from '../constants/comboSkillLabels.ku.json';

const COMBOBOX_FILTER_KEYS = new Set(['requiredLanguages', 'requiredSkills', 'gender']);

export function optionalFilterUsesCombobox(key) {
    return COMBOBOX_FILTER_KEYS.has(key);
}

function buildLanguageSuggestionOptions(currentLang) {
    const catalog =
        currentLang === 'ar' ? comboLanguageLabelsAr : currentLang === 'ku' ? comboLanguageLabelsKu : null;
    return LANGUAGE_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
}

function buildSkillSuggestionOptions(currentLang) {
    const catalog =
        currentLang === 'ar' ? comboSkillLabelsAr : currentLang === 'ku' ? comboSkillLabelsKu : null;
    return KEY_SKILL_SUGGESTIONS.map((en) => ({ value: en, label: catalog?.[en] ?? en }));
}

function buildGenderSuggestionOptions(t) {
    return GENDER_OPTIONS.map((o) => ({
        value: o.value,
        label: t(o.value === 'male' ? 'newCampaign_combo_gender_male' : 'newCampaign_combo_gender_female'),
    }));
}

/** Same suggestion lists as NewInterviewSidebar / campaign criteria */
export function buildOptionalFilterSuggestionOptions(t, currentLang) {
    return {
        requiredLanguages: buildLanguageSuggestionOptions(currentLang),
        requiredSkills: buildSkillSuggestionOptions(currentLang),
        gender: buildGenderSuggestionOptions(t),
    };
}
