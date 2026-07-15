/** Map API labelKey / titleKey (form.*) to flat translations.js keys. */
export function resolveFormTranslationKey(labelKey) {
    if (!labelKey) return '';
    if (labelKey.startsWith('form.section.')) {
        return `formSection_${labelKey.slice('form.section.'.length)}`;
    }
    if (labelKey.startsWith('form.')) {
        return `formField_${labelKey.slice('form.'.length)}`;
    }
    return labelKey;
}
