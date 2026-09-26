/**
 * The currency assumed for an applicant's expected salary when none was given.
 *
 * It was USD, and nobody chose it: both application forms preselected USD, the
 * schemas stored USD when the field was missing, and the Stage 1 payload filled
 * in USD — so an Iraqi applicant who typed 700000 was sent to the AI screener
 * as asking for 700,000 US dollars. The owner's decision (2026-09-26): dinars.
 *
 * Must equal DEFAULT_SALARY_CURRENCY in apps/frontend/src/utils/applicationFormDefaults.js
 * (npm run test:stage1-form-defaults pins both).
 */
export const DEFAULT_SALARY_CURRENCY = 'IQD';
