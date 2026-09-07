/**
 * A verdict with no evidence must not be compared as if it had any.
 *
 * An interview that ends early still comes back with a computed `overall_score`
 * and a recommendation. The stage board already refused to show that number, but
 * the rule lived only in the browser — so campaignComparePool copied the score
 * straight into the comparison, and a candidate whose connection dropped after a
 * minute could be ranked against someone who sat through the whole interview.
 *
 * These cases mirror videoInterviewEvalDisplay.js on the frontend. If the two
 * ever disagree, the stage board and the comparison will describe the same
 * candidate differently — which is the bug this is meant to prevent.
 *
 * Run: npx tsx src/scripts/video-evidence-test.ts
 */
import assert from 'node:assert';
import {
    isInsufficientVideoEvaluation,
    videoInterviewEvidence,
} from '../services/videoEvaluationEvidence.js';

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

test('the scorer saying so outright is enough', () => {
    assert.strictEqual(isInsufficientVideoEvaluation({ status: 'insufficient_data' }), true);
    assert.strictEqual(isInsufficientVideoEvaluation({ status: 'INSUFFICIENT' }), true);
});

test('this is the case that reached the comparison: a verdict with nothing behind it', () => {
    // What an interview cut short collapses to once the empty breakdown is
    // dropped on the way into the database.
    assert.strictEqual(
        isInsufficientVideoEvaluation({
            overall_score: 62,
            recommendation: 'Consider',
            summary: 'The candidate left before the interview could cover the role.',
        }),
        true
    );
});

test('one real assessed competency is enough to count as measured', () => {
    assert.strictEqual(
        isInsufficientVideoEvaluation({
            overall_score: 62,
            recommendation: 'Consider',
            competencyScores: [{ competencyKey: 'a', score: 4 }],
        }),
        false
    );
});

test('a competency the scorer could not assess is not evidence', () => {
    // `score: null` coerces to 0 — a naive finite check would read it as a real
    // zero and call an unmeasured interview measured.
    for (const row of [{ score: null }, { score: '' }, { score: 0 }, { assessed: false, score: 5 }]) {
        assert.strictEqual(
            isInsufficientVideoEvaluation({
                overall_score: 62,
                recommendation: 'Consider',
                competencyScores: [row],
            }),
            true,
            JSON.stringify(row)
        );
    }
});

test('a legacy 8-trait record still counts as measured', () => {
    assert.strictEqual(
        isInsufficientVideoEvaluation({
            overall_score: 70,
            recommendation: 'Hire',
            professional_depth: 7,
        }),
        false
    );
    assert.strictEqual(
        isInsufficientVideoEvaluation({ overall_score: 70, recommendation: 'Hire', final_role_fit: 6 }),
        false
    );
});

test('no verdict at all is absent, not insufficient — callers filter those earlier', () => {
    assert.strictEqual(isInsufficientVideoEvaluation({}), false);
    assert.strictEqual(isInsufficientVideoEvaluation(null), false);
    assert.strictEqual(isInsufficientVideoEvaluation(undefined), false);
    assert.strictEqual(isInsufficientVideoEvaluation({ summary: 'notes only' }), false);
});

test('a score alone counts as a verdict, even with no recommendation', () => {
    assert.strictEqual(isInsufficientVideoEvaluation({ overall_score: 0 }), true);
});

test('the flag the comparison receives says one of exactly two things', () => {
    assert.strictEqual(videoInterviewEvidence({ status: 'insufficient_data' }), 'insufficient');
    assert.strictEqual(
        videoInterviewEvidence({ overall_score: 80, competencyScores: [{ score: 5 }] }),
        'complete'
    );
    assert.strictEqual(videoInterviewEvidence(null), 'complete');
});

console.log(`\n[video-evidence] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
