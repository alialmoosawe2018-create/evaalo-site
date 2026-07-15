/**
 * Content-aware script detection for mixed-language UI.
 *
 * Problem: the app applies fonts by *UI language* (html[lang="ar"] -> Cairo,
 * English UI -> Inter). But dynamic content (candidate names, position titles,
 * "fit for role" text) can be in a different language than the UI, so it falls
 * back to a mismatched font. These helpers pick the font from the *text itself*.
 */

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** True when the string contains any Arabic-script character. */
export function isArabicText(text) {
    return ARABIC_SCRIPT_RE.test(String(text ?? ''));
}

/** Font utility class chosen from the text's own script, independent of UI language. */
export function getScriptFontClass(text) {
    return isArabicText(text) ? 'font-ar' : 'font-en';
}

/** Reading direction chosen from the text's own script. */
export function getScriptDir(text) {
    return isArabicText(text) ? 'rtl' : 'ltr';
}

/**
 * Convenience: spread onto a JSX element to render mixed-language content with
 * the correct font and direction regardless of the current UI language.
 * @example <span {...scriptTextProps(name)}>{name}</span>
 */
export function scriptTextProps(text, extraClassName = '') {
    const cls = getScriptFontClass(text);
    return {
        className: extraClassName ? `${extraClassName} ${cls}` : cls,
        dir: getScriptDir(text),
    };
}
