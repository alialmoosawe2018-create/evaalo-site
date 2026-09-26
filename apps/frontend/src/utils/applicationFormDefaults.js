/**
 * Defaults and small value rules shared by both applicant forms — the campaign
 * link form (pages/Form.jsx) and the public ?pub= form
 * (components/form/DynamicApplicationForm.jsx).
 *
 * Kept free of JSX and JSON imports on purpose: the backend test suite imports
 * this file from the real frontend source (npm run test:stage1-form-defaults),
 * which is the only way these rules run in CI.
 *
 * Why they matter: once the backend sends the applicant's typed fields to the
 * Stage 1 AI screener, these are the values it reads.
 */

/** The owner's choice (2026-09-26): an Iraqi applicant's salary is in dinars unless they say otherwise. */
export const DEFAULT_SALARY_CURRENCY = 'IQD';

/** Currencies the forms offer, default first. */
export const SALARY_CURRENCIES = ['IQD', 'USD'];

/** A currency the forms accept, or the default for a blank or unknown value. */
export function normalizeSalaryCurrency(value) {
    const c = String(value ?? '').trim().toUpperCase();
    return SALARY_CURRENCIES.includes(c) ? c : DEFAULT_SALARY_CURRENCY;
}

/**
 * A draft saved in the browser before 2026-09-26 carries the old USD default,
 * which the applicant never chose — and Form.jsx wrote it back after every
 * submit, so it came back on the next application from the same browser. With
 * no salary typed the currency means nothing: drop it so today's default
 * applies. A currency next to a typed salary was the applicant's to keep.
 */
export function normalizeRestoredDraft(draft) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return draft;
    const out = { ...draft };
    if (String(out.expectedSalary ?? '').trim() === '') delete out.salaryCurrency;
    else if (out.salaryCurrency != null) out.salaryCurrency = normalizeSalaryCurrency(out.salaryCurrency);
    return out;
}

/** Levels a person can be part-way through. High school and "other" are not offered. */
export const EDUCATION_IN_PROGRESS_ELIGIBLE = new Set(['diploma', 'bachelor', 'master', 'phd']);

/** English on purpose: the stored values and the AI prompts are English. */
export const EDUCATION_IN_PROGRESS_SUFFIX = ' (in progress)';

function stripInProgress(value) {
    const s = String(value ?? '').trim();
    return s.endsWith(EDUCATION_IN_PROGRESS_SUFFIX) ? s.slice(0, -EDUCATION_IN_PROGRESS_SUFFIX.length).trim() : s;
}

/** Whether the "still studying" checkbox applies to this education level. */
export function isEducationInProgressEligible(value) {
    return EDUCATION_IN_PROGRESS_ELIGIBLE.has(stripInProgress(value));
}

/**
 * The education value to SEND. A student used to have to pick "bachelor",
 * which the screener reads as a completed degree — and a CV showing a
 * third-year student then reads as the applicant overstating it (an integrity
 * concern and a forced manual review). "bachelor (in progress)" states it
 * honestly. The dropdown itself keeps its plain values, so campaign
 * requirements that share the list are untouched. Safe to call twice.
 */
export function composeEducationForSubmit(value, inProgress) {
    const base = stripInProgress(value);
    if (!EDUCATION_IN_PROGRESS_ELIGIBLE.has(base)) return value ?? '';
    return inProgress ? base + EDUCATION_IN_PROGRESS_SUFFIX : base;
}
