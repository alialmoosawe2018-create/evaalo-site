/**
 * Criteria context carried into the later comparison reports (no DB).
 * Usage: npx tsx src/scripts/campaign-compare-criteria-context-test.ts
 *
 * Covers the two things that were missing before: the recruiter's criteria (and
 * how Stage 1 judged each candidate against them) reaching stages 2 and 3, and
 * the criterion WORDING travelling with the verdict instead of a bare id.
 */
import assert from 'node:assert';
import {
    buildCriteriaFit,
    buildPriorStages,
    type CompareRow,
    type PoolRubricItem,
    type RubricLookup,
} from '../services/campaignComparePool.js';

function lookup(items: PoolRubricItem[]): RubricLookup {
    return new Map(items.map((r) => [r.id, r]));
}

const RUBRIC = lookup([
    { id: 'preset__skills__a1', label: 'Communication and active listening', expectation: 'Evidence in CV' },
    { id: 'custom__portfolio__b2', label: 'Published portfolio of work', expectation: 'A public link' },
]);

function row(over: Partial<CompareRow> = {}): CompareRow {
    return {
        personId: 'p1',
        applicationId: 'app1',
        applicationMongoId: 'm1',
        full_name: 'Noor',
        ...over,
    } as CompareRow;
}

function withRubricResults(results: unknown): CompareRow {
    return row({ writtenInterviewEvaluation: { rubricResults: results } as never });
}

let failures = 0;
const check = (name: string, fn: () => void) => {
    try {
        fn();
        console.log('  ✔ ' + name);
    } catch (err) {
        failures += 1;
        console.log('  ✘ ' + name + ' — ' + (err as Error).message);
    }
};

console.log('criteriaFit');

check('joins the criterion wording onto the verdict', () => {
    const out = buildCriteriaFit(
        withRubricResults([
            { rubricItemId: 'preset__skills__a1', result: 'meets', confidence: 'high' },
            { rubricItemId: 'custom__portfolio__b2', result: 'does_not_meet', confidence: 'medium' },
        ]),
        RUBRIC
    )!;
    assert.equal(out.length, 2);
    assert.equal(out[0].label, 'Communication and active listening');
    assert.equal(out[0].result, 'meets');
    // The whole point of the fix: a CUSTOM criterion, which `criteria` never
    // carries, now reaches the report by name.
    assert.equal(out[1].label, 'Published portfolio of work');
    assert.equal(out[1].result, 'does_not_meet');
});

check('an id with no rubric entry still passes through, just unlabelled', () => {
    const out = buildCriteriaFit(withRubricResults([{ rubricItemId: 'gone', result: 'meets' }]), RUBRIC)!;
    assert.equal(out.length, 1);
    assert.equal(out[0].rubricItemId, 'gone');
    assert.equal(out[0].label, undefined);
});

check('no Stage 1 results -> undefined, so the payload is unchanged', () => {
    assert.equal(buildCriteriaFit(row(), RUBRIC), undefined);
    assert.equal(buildCriteriaFit(withRubricResults([]), RUBRIC), undefined);
    assert.equal(buildCriteriaFit(withRubricResults('not an array'), RUBRIC), undefined);
});

check('an empty rubric leaves the verdicts intact', () => {
    const out = buildCriteriaFit(
        withRubricResults([{ rubricItemId: 'preset__skills__a1', result: 'meets' }]),
        lookup([])
    )!;
    assert.equal(out[0].result, 'meets');
    assert.equal(out[0].label, undefined);
});

check('caps a runaway list', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ rubricItemId: 'r' + i, result: 'meets' }));
    assert.ok(buildCriteriaFit(withRubricResults(many), RUBRIC)!.length <= 8);
});

console.log('priorStages');

const screened = { overall_score: 82, recommendation: 'Hire' } as never;
const voiced = { overall_score: 68, recommendation: 'Consider' } as never;

check('stage 2 sees screening only — the voice result IS this stage', () => {
    const out = buildPriorStages(
        row({ writtenInterviewEvaluation: screened, voiceInterviewEvaluation: voiced }),
        'stage2'
    )!;
    assert.deepEqual(out.screening, { score: 82, recommendation: 'Hire' });
    assert.equal(out.voice, undefined);
});

check('stage 3 sees both stages behind it', () => {
    const out = buildPriorStages(
        row({ writtenInterviewEvaluation: screened, voiceInterviewEvaluation: voiced }),
        'stage3'
    )!;
    assert.deepEqual(out.screening, { score: 82, recommendation: 'Hire' });
    assert.deepEqual(out.voice, { score: 68, recommendation: 'Consider' });
});

check('stage 1 has nothing behind it', () => {
    assert.equal(buildPriorStages(row({ writtenInterviewEvaluation: screened }), 'stage1'), undefined);
});

check('a candidate who entered at a later stage yields undefined', () => {
    assert.equal(buildPriorStages(row(), 'stage3'), undefined);
});

check('an evaluation with no score is not reported as a prior stage', () => {
    const out = buildPriorStages(
        row({ writtenInterviewEvaluation: { recommendation: 'Hire' } as never }),
        'stage3'
    );
    assert.equal(out, undefined);
});

console.log(failures === 0 ? '\n✅ criteria-context: all passed' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
