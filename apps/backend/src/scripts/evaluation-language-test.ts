/**
 * One evaluation-language rule, in one order, shared by all three stages.
 *
 * Before this, only Stage 1 consulted the campaign. Stage 2 and Stage 3 read the
 * share link and then defaulted to 'ar', so an English campaign's voice and video
 * reports came back in Arabic — and the same candidate could be written up in two
 * different languages across two stages of one hiring process.
 *
 * Run: npx tsx src/scripts/evaluation-language-test.ts
 */
import assert from 'node:assert';
import {
    campaignCriteriaLanguage,
    normalizeEvaluationLanguage,
    resolveEvaluationLanguage,
} from '../services/evaluationLanguage.js';
import {
    detectStage1TextLanguage,
    inferStage1EvaluationLanguage,
    normalizeStage1EvaluationLanguage,
} from '../services/stage1EvaluationLanguage.js';

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

/* ── the tags ─────────────────────────────────────────────────────────────── */

test('kurdish is evaluated in arabic — the evaluators emit ar/en only', () => {
    for (const tag of ['ku', 'kurdish', 'ckb', 'ku-IQ']) {
        assert.strictEqual(normalizeEvaluationLanguage(tag), 'ar', tag);
    }
});

test('an unknown tag answers "nothing here", not a guess', () => {
    for (const tag of ['auto', '', null, undefined, 'fr', {}]) {
        assert.strictEqual(normalizeEvaluationLanguage(tag), null, String(tag));
    }
});

test('regional tags resolve to their base language', () => {
    assert.strictEqual(normalizeEvaluationLanguage('en-GB'), 'en');
    assert.strictEqual(normalizeEvaluationLanguage('ar-IQ'), 'ar');
    assert.strictEqual(normalizeEvaluationLanguage('English'), 'en');
});

/* ── the order ────────────────────────────────────────────────────────────── */

test('the campaign wins over everything — the report is read by the employer', () => {
    assert.strictEqual(
        resolveEvaluationLanguage({
            campaignCriteria: { evaluationLanguage: 'en' },
            shareLanguage: 'ar',
            evaluationContext: { evaluationLanguage: 'ar' },
            detected: 'ar',
        }),
        'en'
    );
});

test('this is the regression: an english campaign no longer gets an arabic report', () => {
    // Stage 2/3 used to ignore the campaign entirely and fall to 'ar'.
    assert.strictEqual(
        resolveEvaluationLanguage({
            campaignCriteria: { evaluationLanguage: 'en' },
            shareLanguage: 'auto',
        }),
        'en'
    );
});

test('and the mirror case: an arabic campaign is not overridden by an english link', () => {
    assert.strictEqual(
        resolveEvaluationLanguage({
            campaignCriteria: { evaluationLanguage: 'ar' },
            shareLanguage: 'en',
        }),
        'ar'
    );
});

test('the share link decides only when the campaign said nothing', () => {
    assert.strictEqual(
        resolveEvaluationLanguage({
            campaignCriteria: {},
            shareLanguage: 'en',
            evaluationContext: { evaluationLanguage: 'ar' },
            detected: 'ar',
        }),
        'en'
    );
    assert.strictEqual(resolveEvaluationLanguage({ shareLanguage: 'ku' }), 'ar');
});

test('then the application context, then detection, then arabic', () => {
    assert.strictEqual(
        resolveEvaluationLanguage({
            shareLanguage: 'auto',
            evaluationContext: { evaluationLanguage: 'en' },
            detected: 'ar',
        }),
        'en'
    );
    assert.strictEqual(resolveEvaluationLanguage({ shareLanguage: 'auto', detected: 'en' }), 'en');
    assert.strictEqual(resolveEvaluationLanguage({}), 'ar');
});

test('a campaign that stores plain `language` counts as a campaign setting', () => {
    assert.strictEqual(campaignCriteriaLanguage({ language: 'en' }), 'en');
    assert.strictEqual(campaignCriteriaLanguage({ evaluationLanguage: 'ku' }), 'ar');
    assert.strictEqual(campaignCriteriaLanguage({ position: 'HR Specialist' }), null);
    assert.strictEqual(campaignCriteriaLanguage(null), null);
});

/* ── stage 1 keeps its own text detector ──────────────────────────────────── */

test('an arabic CV is detected from a single arabic letter, not a ratio', () => {
    // An Arabic application routinely names English tools and employers; a ratio
    // test read those as an English application.
    assert.strictEqual(
        detectStage1TextLanguage({ full_name: 'علي محمود', location: 'Baghdad, Iraq' }),
        'ar'
    );
    assert.strictEqual(detectStage1TextLanguage({ full_name: 'Ali Mahmood' }), 'en');
});

test('no text at all means no verdict — not a silent "en"', () => {
    assert.strictEqual(detectStage1TextLanguage({}), null);
    assert.strictEqual(detectStage1TextLanguage({ full_name: '   ' }), null);
});

test('stage 1 still prefers the campaign over the candidate\'s own script', () => {
    assert.strictEqual(inferStage1EvaluationLanguage({ full_name: 'علي' }, { language: 'en' }), 'en');
    assert.strictEqual(inferStage1EvaluationLanguage({ full_name: 'Ali' }, {}), 'en');
    assert.strictEqual(inferStage1EvaluationLanguage({ full_name: 'علي' }, {}), 'ar');
    assert.strictEqual(inferStage1EvaluationLanguage({}, null), 'ar');
});

test('the stage 1 normalizer never returns null — it has always defaulted to ar', () => {
    assert.strictEqual(normalizeStage1EvaluationLanguage('auto'), 'ar');
    assert.strictEqual(normalizeStage1EvaluationLanguage('en'), 'en');
    assert.strictEqual(normalizeStage1EvaluationLanguage(undefined), 'ar');
});

/* ── the two comparisons, which used to answer this question their own way ─── */

test('candidate comparison takes the campaign language, where it used to take none', () => {
    // The compare dispatch sent no language at all; the prompt guessed "Arabic
    // unless the evaluations are clearly English-only".
    assert.strictEqual(
        resolveEvaluationLanguage({ campaignCriteria: { evaluationLanguage: 'en' } }),
        'en'
    );
    assert.strictEqual(
        resolveEvaluationLanguage({ campaignCriteria: { evaluationLanguage: 'ku' } }),
        'ar'
    );
    // A campaign that names none still yields a language, so the field is never blank.
    assert.strictEqual(resolveEvaluationLanguage({ campaignCriteria: {} }), 'ar');
});

test('CV comparison maps ku to ar — a raw ku used to reach the prompt', () => {
    assert.strictEqual(normalizeEvaluationLanguage('ku'), 'ar');
    assert.strictEqual(normalizeEvaluationLanguage('ckb'), 'ar');
});

test('CV comparison still omits the field when the caller sent no locale', () => {
    // null here means "field omitted", which leaves n8n's content detection in
    // place — the behaviour that endpoint has always had. Using the full
    // resolver would have imposed Arabic on a request that never asked.
    assert.strictEqual(normalizeEvaluationLanguage(''), null);
    assert.strictEqual(normalizeEvaluationLanguage(undefined), null);
    assert.strictEqual(normalizeEvaluationLanguage('   '), null);
});

test('whatever the CV comparison forwards is one of two safe values', () => {
    for (const raw of ['ar', 'AR', 'en-GB', 'kurdish', 'Arabic', 'ku']) {
        const out = normalizeEvaluationLanguage(raw);
        assert.ok(out === 'ar' || out === 'en', `${raw} → ${out}`);
    }
});

console.log(`\n[evaluation-language] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
