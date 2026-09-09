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
    createRubricLookup,
    type CompareRow,
    type PoolRubricItem,
    type RubricLookup,
} from '../services/campaignComparePool.js';

function lookup(items: Array<PoolRubricItem & { key?: string }>): RubricLookup {
    return createRubricLookup(items);
}

const RUBRIC = lookup([
    {
        id: 'preset__skills__a1',
        key: 'skills',
        label: 'Communication and active listening',
        expectation: 'Evidence in CV',
    },
    {
        id: 'custom__portfolio__b2',
        key: 'published-portfolio-of-work',
        label: 'Published portfolio of work',
        expectation: 'A public link',
    },
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
    assert.ok(buildCriteriaFit(withRubricResults(many), RUBRIC)!.length <= 20);
});

check('a real campaign’s criteria all survive the cap', () => {
    // Production campaigns carry 10-14 criteria; the old 8-item cap dropped some.
    const fourteen = Array.from({ length: 14 }, (_, i) => ({
        rubricItemId: 'preset__k' + i + '__aaaa',
        result: 'meets',
    }));
    assert.equal(buildCriteriaFit(withRubricResults(fourteen), RUBRIC)!.length, 14);
});

console.log('joining a stored verdict back to its criterion');

check('THE PRODUCTION CASE: a different random suffix still resolves', () => {
    // `assignRubricId` mints ids with randomBytes, and no campaign stores its
    // rubric, so the id saved in rubricResults NEVER equals a freshly derived
    // one. Measured on prod: 0/20 matched by id, 20/20 by key.
    const out = buildCriteriaFit(
        withRubricResults([{ rubricItemId: 'preset__skills__ZZZZZZZZ', result: 'meets' }]),
        RUBRIC
    )!;
    assert.equal(out[0].label, 'Communication and active listening');
});

check('the separator mismatch between id slug and key does not break the join', () => {
    // assignRubricId slugs with "_", normalizeRubricLabelKey slugs with "-".
    const out = buildCriteriaFit(
        withRubricResults([
            { rubricItemId: 'custom__published_portfolio_of_work__9f9f', result: 'does_not_meet' },
        ]),
        RUBRIC
    )!;
    assert.equal(out[0].label, 'Published portfolio of work');
});

check('catalog plumbing never reaches the report', () => {
    // roleKey/labelKey/roleMatchSource/evaluationLanguage live in `criteria`, so
    // deriving a rubric turns them into "criteria" nobody can meet.
    const out = buildCriteriaFit(
        withRubricResults([
            { rubricItemId: 'custom__rolekey__1111', result: 'meets' },
            { rubricItemId: 'custom__labelkey__2222', result: 'meets' },
            { rubricItemId: 'custom__rolematchsource__3333', result: 'does_not_meet' },
            { rubricItemId: 'custom__evaluationlanguage__4444', result: 'meets' },
            { rubricItemId: 'preset__skills__5555', result: 'meets' },
        ]),
        RUBRIC
    )!;
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'Communication and active listening');
});

check('two criteria sharing a key are left unlabelled rather than mislabelled', () => {
    const ambiguous = lookup([
        { id: 'custom__team__a', key: 'team', label: 'Team leadership', expectation: 'x' },
        { id: 'custom__team__b', key: 'team', label: 'Team collaboration', expectation: 'y' },
    ]);
    const out = buildCriteriaFit(
        withRubricResults([{ rubricItemId: 'custom__team__cccc', result: 'meets' }]),
        ambiguous
    )!;
    assert.equal(out[0].label, undefined);
    assert.equal(out[0].result, 'meets');
});

check('an exact id still wins when a campaign does store its rubric', () => {
    const out = buildCriteriaFit(
        withRubricResults([{ rubricItemId: 'custom__portfolio__b2', result: 'meets' }]),
        RUBRIC
    )!;
    assert.equal(out[0].label, 'Published portfolio of work');
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
