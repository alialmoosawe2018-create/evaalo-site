/**
 * The per-criterion breakdown must survive the trip back from n8n.
 *
 * It did not, for three independent reasons at once, and the failure was
 * silent: a candidate showed a score of 68 with nothing recording which
 * requirements produced it, and campaignComparePool built the compare payload's
 * `eligibility` from the same empty array — so the comparison AI ranked people
 * without ever seeing what they met.
 *
 * Run: npx tsx src/scripts/stage1-rubric-results-test.ts
 */
import assert from 'node:assert';
import { normalizeRubricResultsFromWebhook } from '../services/stage1RubricResults.js';

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

/** Exactly what the Stage 1 scoring node emits today. */
const REAL_N8N_CALLBACK = {
    valid: true,
    evaluation: { overall_score: 73, recommendation: 'Consider' },
    screening_coverage: 0.81,
    status: 'scored',
    criteria_results: [
        { criterionId: 'r_experience', status: 'met', evidence: 'Two years running HR operations.' },
        { criterionId: 'r_certifications', status: 'missing', evidence: 'No HR certification found.' },
        { criterionId: 'r_languages', status: 'partial', evidence: 'Arabic native, English claimed.' },
        { criterionId: 'r_salary', status: 'not_assessed' },
    ],
};

test('the real n8n callback shape is accepted — this is the regression', () => {
    const out = normalizeRubricResultsFromWebhook(REAL_N8N_CALLBACK as never);
    assert.ok(out, 'the breakdown must not be dropped');
    assert.strictEqual(out!.length, 4);
});

test('its vocabulary is translated, not rejected', () => {
    const out = normalizeRubricResultsFromWebhook(REAL_N8N_CALLBACK as never)!;
    const by = Object.fromEntries(out.map((r) => [r.rubricItemId, r.result]));
    assert.strictEqual(by.r_experience, 'meets');
    assert.strictEqual(by.r_certifications, 'does_not_meet');
    assert.strictEqual(by.r_languages, 'partially_meets');
    assert.strictEqual(by.r_salary, 'insufficient_evidence');
});

test('evidence arrives as one sentence and is kept, not discarded', () => {
    const out = normalizeRubricResultsFromWebhook(REAL_N8N_CALLBACK as never)!;
    const cert = out.find((r) => r.rubricItemId === 'r_certifications')!;
    assert.deepStrictEqual(cert.evidence, ['No HR certification found.']);
});

test('the documented shape still works — nothing was traded away', () => {
    const out = normalizeRubricResultsFromWebhook({
        rubricResults: [
            { rubricItemId: 'r1', result: 'meets', evidence: ['a'], confidence: 'high' },
        ],
    } as never)!;
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].result, 'meets');
    assert.strictEqual(out[0].confidence, 'high');
});

test('nested under writtenInterviewEvaluation, either dialect', () => {
    const out = normalizeRubricResultsFromWebhook({
        writtenInterviewEvaluation: {
            criteria_results: [{ criterionId: 'r9', status: 'met' }],
        },
    } as never)!;
    assert.strictEqual(out[0].rubricItemId, 'r9');
    assert.strictEqual(out[0].result, 'meets');
});

test('junk is still refused — a bad status does not become a pass', () => {
    assert.strictEqual(
        normalizeRubricResultsFromWebhook({
            criteria_results: [{ criterionId: 'r1', status: 'excellent' }],
        } as never),
        undefined
    );
    assert.strictEqual(
        normalizeRubricResultsFromWebhook({ criteria_results: [{ status: 'met' }] } as never),
        undefined
    );
    assert.strictEqual(normalizeRubricResultsFromWebhook({} as never), undefined);
});

console.log(`\n[rubric-results] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
