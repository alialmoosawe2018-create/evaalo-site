/**
 * Replace `{placeholder}` tokens in translated strings (e.g. `{name}`, `{url}`).
 * Fallback leaves unknown keys as `{key}`.
 */
export function fillI18nTemplate(template, vars) {
    if (!template) return '';
    return template.replace(/\{(\w+)\}/g, (_, key) =>
        vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{${key}}`
    );
}
