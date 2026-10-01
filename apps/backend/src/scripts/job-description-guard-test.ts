// ============================================
// scripts/job-description-guard-test.ts
// services/jobDescription.ts — reading the recruiter's «Job description & requirements»
// and the number guard that keeps an AI rewrite from changing what the job asks for.
// Run: npm run test:job-description-guard — pure, no database, no network.
// ============================================

import assert from 'node:assert/strict';
import {
    compareNumbers,
    extractNumbers,
    JOB_DESCRIPTION_MAX_CHARS,
    readJobDescription,
} from '../services/jobDescription.js';

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

console.log('readJobDescription');

test('absent, null, empty and blank mean no description', () => {
    for (const raw of [undefined, null, '', '   ', '\n\r\n\t ']) {
        assert.deepEqual(readJobDescription(raw), { ok: true, value: undefined }, JSON.stringify(raw));
    }
});

test('text is trimmed and Windows line breaks become \\n', () => {
    assert.deepEqual(readJobDescription('  Line one\r\nLine two\rLine three  '), {
        ok: true,
        value: 'Line one\nLine two\nLine three',
    });
});

test('anything that is not text is refused', () => {
    for (const raw of [42, true, {}, ['a'], { text: 'x' }]) {
        const r = readJobDescription(raw);
        assert.equal(r.ok, false, JSON.stringify(raw));
        assert.equal(!r.ok && r.code, 'JOB_DESCRIPTION_NOT_TEXT');
    }
});

test('exactly the limit is accepted; one character over is refused', () => {
    const atLimit = 'a'.repeat(JOB_DESCRIPTION_MAX_CHARS);
    assert.deepEqual(readJobDescription(atLimit), { ok: true, value: atLimit });
    const over = readJobDescription('a'.repeat(JOB_DESCRIPTION_MAX_CHARS + 1));
    assert.equal(over.ok, false);
    assert.equal(!over.ok && over.code, 'JOB_DESCRIPTION_TOO_LONG');
});

test('the limit is measured after trimming (pasted padding does not count)', () => {
    const text = 'a'.repeat(JOB_DESCRIPTION_MAX_CHARS);
    assert.deepEqual(readJobDescription(`\n\n  ${text}  \n`), { ok: true, value: text });
});

test('the limit is 5000, the same as the box in the job form', () => {
    assert.equal(JOB_DESCRIPTION_MAX_CHARS, 5000);
});

console.log('\nextractNumbers');

test('plain numbers, ranges, percentages and plus signs', () => {
    assert.deepEqual(extractNumbers('3-5 years, 20% travel, 5+ engineers'), ['20', '3', '5']);
});

test('Arabic-Indic and Persian digits are the digits they are', () => {
    assert.deepEqual(extractNumbers('خبرة ٣-٥ سنوات و۱۰ أشخاص'), ['10', '3', '5']);
});

test('thousands separators: 1,500,000 = 1500000; Arabic ٬ too', () => {
    assert.deepEqual(extractNumbers('Salary 1,500,000 IQD'), ['1500000']);
    assert.deepEqual(extractNumbers('راتب ١٬٥٠٠٬٠٠٠ دينار'), ['1500000']);
});

test('decimals: 2.5, 2,5 and the Arabic ٫ are one number', () => {
    assert.deepEqual(extractNumbers('2.5 years'), ['2.5']);
    assert.deepEqual(extractNumbers('2,5 years'), ['2.5']);
    assert.deepEqual(extractNumbers('٢٫٥ سنة'), ['2.5']);
});

test('leading zeros do not make a different number', () => {
    assert.deepEqual(extractNumbers('05 years'), ['5']);
});

test('a text without numbers has none', () => {
    assert.deepEqual(extractNumbers('Strong communication skills. خبرة في التوظيف'), []);
});

console.log('\ncompareNumbers');

test('a pure rewording keeps the same numbers → accepted', () => {
    const r = compareNumbers(
        'need 3-5 yrs exp in recruitment, 20% travel',
        'Experience: 3 to 5 years in recruitment.\nTravel: about 20% of the time.'
    );
    assert.deepEqual(r, { invented: [], dropped: [] });
});

test('the same number in another script is not a change', () => {
    assert.deepEqual(compareNumbers('خبرة ٥ سنوات', 'الخبرة: 5 سنوات'), { invented: [], dropped: [] });
    assert.deepEqual(compareNumbers('salary 1500000', 'Salary: 1,500,000'), { invented: [], dropped: [] });
});

test('a raised requirement is caught (3-5 years → 5-7 years)', () => {
    const r = compareNumbers('3-5 years of experience', 'Experience: 5-7 years');
    assert.deepEqual(r.invented, ['7']);
    assert.deepEqual(r.dropped, ['3']);
});

test('an invented number is caught (a salary from nowhere)', () => {
    const r = compareNumbers('HR officer, 2 years experience', 'HR Officer\nExperience: 2 years\nSalary: 900,000 IQD');
    assert.deepEqual(r, { invented: ['900000'], dropped: [] });
});

test('a dropped number is caught (a requirement quietly removed)', () => {
    const r = compareNumbers('2 years experience, team of 6', 'Experience required. Works in a team.');
    assert.deepEqual(r, { invented: [], dropped: ['2', '6'] });
});

test('a number written as a word in the original but as digits in the rewrite counts as added', () => {
    // Deliberately strict: the rewrite was told to keep words as words.
    assert.deepEqual(compareNumbers('three years', '3 years'), { invented: ['3'], dropped: [] });
});

console.log(`\n[job-description-guard] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
