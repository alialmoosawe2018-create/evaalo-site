/**
 * The values the two application forms send to Stage 1 (offline, no network, no DB).
 * Run: npm run test:stage1-form-defaults
 *
 * Once the backend sends the applicant's typed fields to the AI screener (S0),
 * these values are what it reads, and two of them misled it:
 *
 *  - Salary currency: both forms preselected USD, the schemas stored USD when it
 *    was missing and the payload filled in USD — nobody chose it. An Iraqi
 *    applicant's "700000" read as 700,000 US dollars. The owner's decision
 *    (2026-09-26): IQD by default, in the forms AND the backend.
 *  - Education: a student could only pick "bachelor", which the screener reads
 *    as a finished degree; a CV showing a third-year student then reads as an
 *    overstatement — an integrity concern and a forced manual review. The forms
 *    now send "bachelor (in progress)" when the applicant ticks "still studying".
 *
 * The frontend rules live in apps/frontend/src/utils/applicationFormDefaults.js
 * and are loaded here from the REAL source (see stage1-parity-test.ts for why the
 * specifier is computed) — frontend test scripts do not run in CI; this one does.
 */
import assert from 'node:assert/strict';
import { DEFAULT_SALARY_CURRENCY as BACKEND_DEFAULT } from '../shared/salaryCurrency.js';
import CandidateApplication from '../models/CandidateApplication.js';
import Candidate from '../models/Candidate.js';

const FRONTEND_SRC = new URL('../../../frontend/src/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaults: any = await import(`${FRONTEND_SRC}utils/applicationFormDefaults.js`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicValidation: any = await import(`${FRONTEND_SRC}components/form/dynamicFormClientValidation.js`);

function testCurrencyDefaultIsIqdEverywhere() {
    assert.equal(defaults.DEFAULT_SALARY_CURRENCY, 'IQD');
    assert.equal(BACKEND_DEFAULT, defaults.DEFAULT_SALARY_CURRENCY, 'backend and forms must agree');
    assert.equal(defaults.SALARY_CURRENCIES[0], 'IQD', 'the default is offered first');

    // The public ?pub= form starts from buildInitialFormValues.
    const initial = dynamicValidation.buildInitialFormValues([
        { id: 'salaryCurrency', type: 'select' },
        { id: 'expectedSalary', type: 'text' },
    ]);
    assert.equal(initial.salaryCurrency, 'IQD');
    assert.equal(initial.expectedSalary, '');

    // Both stored documents fall back to IQD when the field is missing.
    const app = new CandidateApplication({ organizationId: 'org_test', candidateId: '507f1f77bcf86cd799439011', campaignId: 'c1' });
    assert.equal(app.get('salaryCurrency'), 'IQD', 'CandidateApplication default');
    const person = new Candidate({ organizationId: 'org_test', full_name: 'X', email: 'x@example.invalid' });
    assert.equal(person.get('salaryCurrency'), 'IQD', 'Candidate default');
}

function testNormalizeSalaryCurrency() {
    const n = defaults.normalizeSalaryCurrency;
    assert.equal(n('USD'), 'USD');
    assert.equal(n(' usd '), 'USD');
    assert.equal(n('IQD'), 'IQD');
    assert.equal(n(''), 'IQD');
    assert.equal(n(null), 'IQD');
    assert.equal(n(undefined), 'IQD');
    assert.equal(n('EUR'), 'IQD', 'an unknown currency falls back to the default, not to USD');
}

function testRestoredDraftDropsAnUnchosenCurrency() {
    const r = defaults.normalizeRestoredDraft;
    // The old default with no salary typed: nobody chose it — drop it.
    const stale = r({ salaryCurrency: 'USD', expectedSalary: '', full_name: 'A' });
    assert.equal('salaryCurrency' in stale, false);
    assert.equal(stale.full_name, 'A', 'other fields survive');
    const blank = r({ salaryCurrency: 'USD', expectedSalary: '   ' });
    assert.equal('salaryCurrency' in blank, false);
    const missing = r({ salaryCurrency: 'USD' });
    assert.equal('salaryCurrency' in missing, false);
    // Next to a typed salary it was the applicant's choice — keep it.
    assert.equal(r({ salaryCurrency: 'USD', expectedSalary: '900' }).salaryCurrency, 'USD');
    assert.equal(r({ salaryCurrency: 'iqd', expectedSalary: '900000' }).salaryCurrency, 'IQD');
    assert.equal(r({ salaryCurrency: 'EUR', expectedSalary: '900' }).salaryCurrency, 'IQD');
    // No currency at all stays absent (the form's own default then applies).
    assert.equal('salaryCurrency' in r({ expectedSalary: '900' }), false);
    // The input is not mutated, and junk passes through.
    const input = { salaryCurrency: 'USD', expectedSalary: '' };
    r(input);
    assert.equal(input.salaryCurrency, 'USD');
    assert.equal(r(null), null);
    assert.equal(r('x'), 'x');
}

function testComposeEducation() {
    const c = defaults.composeEducationForSubmit;
    for (const level of ['diploma', 'bachelor', 'master', 'phd']) {
        assert.equal(c(level, true), `${level} (in progress)`);
        assert.equal(c(level, false), level);
        assert.equal(defaults.isEducationInProgressEligible(level), true);
    }
    for (const level of ['high-school', 'other', '', 'Some free text']) {
        assert.equal(c(level, true), level, `${level || '(empty)'} is never marked in progress`);
        assert.equal(defaults.isEducationInProgressEligible(level), false);
    }
    assert.equal(c(undefined, true), '');
    assert.equal(c(null, false), '');
    // Safe to call twice, and unticking removes the suffix.
    assert.equal(c(c('bachelor', true), true), 'bachelor (in progress)');
    assert.equal(c('bachelor (in progress)', false), 'bachelor');
    assert.equal(defaults.isEducationInProgressEligible('bachelor (in progress)'), true);
    // The exact text the screener reads — English, like the stored values.
    assert.equal(defaults.EDUCATION_IN_PROGRESS_SUFFIX, ' (in progress)');
}

testCurrencyDefaultIsIqdEverywhere();
console.log('✓ IQD is the salary currency default in both forms, both schemas and the backend constant');
testNormalizeSalaryCurrency();
console.log('✓ a blank or unknown currency becomes IQD, never USD');
testRestoredDraftDropsAnUnchosenCurrency();
console.log('✓ an old browser draft\'s unchosen USD is dropped; a currency next to a typed salary is kept');
testComposeEducation();
console.log('✓ "still studying" sends "<level> (in progress)" for diploma/bachelor/master/phd only, idempotently');
console.log('\nstage1-form-defaults-test: all passed');
