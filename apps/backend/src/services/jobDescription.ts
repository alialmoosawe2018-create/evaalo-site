// ============================================
// services/jobDescription.ts
// The recruiter's «Job description & requirements» text: how it is read, and the
// guard that keeps an AI rewrite from changing what the job asks for.
//
// The text is the employer's own words — the duties and requirements of the role. It
// is stored on the campaign (never inside `criteria`, so it is never scored as a
// criterion) and fed to criteria suggestion and ad generation as context. It is NOT
// yet given to any evaluator; that is a separate, tested step.
// ============================================

/** Same limit as the box in the job form. Counted in UTF-16 units, like the browser. */
export const JOB_DESCRIPTION_MAX_CHARS = 5000;

export type JobDescriptionRead =
    | { ok: true; value: string | undefined }
    | { ok: false; code: 'JOB_DESCRIPTION_NOT_TEXT' | 'JOB_DESCRIPTION_TOO_LONG'; message: string };

/** Absent or blank → no description. Not text, or over the limit → an error the caller returns as 400. */
export function readJobDescription(raw: unknown): JobDescriptionRead {
    if (raw === undefined || raw === null) return { ok: true, value: undefined };
    if (typeof raw !== 'string') {
        return { ok: false, code: 'JOB_DESCRIPTION_NOT_TEXT', message: 'The job description must be text.' };
    }
    const value = raw.replace(/\r\n?/g, '\n').trim();
    if (!value) return { ok: true, value: undefined };
    if (value.length > JOB_DESCRIPTION_MAX_CHARS) {
        return {
            ok: false,
            code: 'JOB_DESCRIPTION_TOO_LONG',
            message: `The job description is longer than ${JOB_DESCRIPTION_MAX_CHARS} characters.`,
        };
    }
    return { ok: true, value };
}

// ── Number guard ────────────────────────────────────────────────────────────
// A rewrite may reword, never change what is required. Numbers are where a changed
// requirement is cheapest to catch for certain: "3-5 years" becoming "5+ years", a
// salary or a head-count appearing from nowhere, a "2 years" quietly dropped. So the
// numbers of the rewrite must be exactly the numbers of the original — none new, none
// missing. Arabic-Indic and Persian digits count as the digits they are.

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

function toAsciiDigits(text: string): string {
    return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
        const code = ch.charCodeAt(0);
        const base = code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_INDIC_ZERO;
        return String(code - base);
    });
}

/** "10,000" and "10000" are one number; "2.5", "2٫5" and "2,5" are one number. */
function canonicalNumber(token: string): string {
    // ٬ is the Arabic thousands separator, ٫ the Arabic decimal separator.
    let t = token.replace(/\u066C/g, ',').replace(/\u066B/g, '.');
    // A comma before exactly three digits groups thousands; any other comma is a decimal point.
    t = t.replace(/,(?=\d{3}(?!\d))/g, '').replace(/,/g, '.');
    const n = Number(t);
    return Number.isFinite(n) && t.replace(/\D/g, '').length <= 15 ? String(n) : t;
}

/** The distinct numbers a text mentions, canonicalised and sorted. */
export function extractNumbers(text: string): string[] {
    const tokens = toAsciiDigits(String(text || '')).match(/\d+(?:[.,\u066B\u066C]\d+)*/g) || [];
    return [...new Set(tokens.map(canonicalNumber))].sort();
}

/** Numbers the rewrite added, and numbers it lost. Both must be empty to accept it. */
export function compareNumbers(original: string, rewritten: string): { invented: string[]; dropped: string[] } {
    const before = new Set(extractNumbers(original));
    const after = new Set(extractNumbers(rewritten));
    return {
        invented: [...after].filter((n) => !before.has(n)),
        dropped: [...before].filter((n) => !after.has(n)),
    };
}
