import { stripVacancyGender } from '../services/n8nService.js';

/**
 * Regression for the gender confusion found in voice session 6afff73c.
 *
 * The campaign required `gender: "male"`. That is a property of the vacancy, but
 * it travelled to the evaluator inside the criteria list as "Gender: male" —
 * indistinguishable from the fields that describe the applicant. The evaluation
 * of a candidate named Fatima then swung between masculine and feminine forms
 * inside one paragraph.
 *
 * Run: npm run test:vacancy-gender-strip
 */

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok || !detail ? '' : `\n   ${detail}`}`);
}

// The real criteria object from that session.
const CRITERIA = {
    position: 'Senior HR Specialist',
    roleKey: 'hr_specialist',
    careerLevel: 'senior',
    location: 'Baghdad',
    industryType: 'Oil & Gas',
    age: '25-34',
    gender: 'male',
    educationLevel: 'bachelor',
    languages: 'English; Arabic',
    evaluationLanguage: 'ar',
};

const out = stripVacancyGender(CRITERIA);

check('gender is gone', !('gender' in out));
check('every other criterion survives', Object.keys(out).length === Object.keys(CRITERIA).length - 1);
check('the role is untouched', out.position === 'Senior HR Specialist');
check('so is the language the evaluation must be written in', out.evaluationLanguage === 'ar');
check('and the input object is not mutated', 'gender' in CRITERIA, 'the caller may still need it');

console.log('\n— edge cases —');
check('null', Object.keys(stripVacancyGender(null)).length === 0);
check('undefined', Object.keys(stripVacancyGender(undefined)).length === 0);
check('empty', Object.keys(stripVacancyGender({})).length === 0);
check('no gender key at all', stripVacancyGender({ position: 'x' }).position === 'x');

console.log(`\n${failures === 0 ? '✅ all passed' : `❌ ${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
